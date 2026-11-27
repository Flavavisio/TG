const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { stripTypeScriptTypes } = require('node:module');
const path = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..', 'supabase', 'functions');
const source = file => readFileSync(path.join(root, file), 'utf8');
const profiles = {
    global: { papel: 'superadmin', admin_id: null, registo_id: 'superadmin' },
    admin: { papel: 'admin', admin_id: null, registo_id: 'empresa-a' },
    deputy: { papel: 'subadmin', admin_id: 'empresa-a', registo_id: 'sub-a' },
    worker: { papel: 'funcionario', admin_id: 'empresa-a', registo_id: 'tec-a' },
    portal: { papel: 'cliente', admin_id: 'empresa-a', registo_id: 'cli-a' },
    foreign: { papel: 'admin', admin_id: null, registo_id: 'empresa-b' },
};
const subscriptions = [
    { id: 'a', admin_id: 'empresa-a', utilizador_id: 'tec-a', endpoint: 'https://fcm.googleapis.com/a' },
    { id: 'b', admin_id: 'empresa-b', utilizador_id: 'tec-b', endpoint: 'https://fcm.googleapis.com/b' },
    { id: 'c', admin_id: 'empresa-a', utilizador_id: 'tec-c', endpoint: 'https://example.invalid/c' },
];

function serve(slug) {
    const queries = [];
    const pushes = [];
    const client = {
        auth: { getUser: async token => ({ data: { user: profiles[token] ? { id: token } : null } }) },
        from(table) {
            queries.push(table);
            const filters = new Map();
            return {
                select() { return this; },
                eq(column, value) { filters.set(column, value); return this; },
                neq() { return this; },
                async maybeSingle() {
                    const data = table === 'perfis' ? profiles[filters.get('id')]
                        : { integracao_faturacao: { provider: 'toconline', simulacao: true } };
                    return { data };
                },
                then(resolve) {
                    const data = table === 'push_subscriptions'
                        ? subscriptions.filter(row => [...filters].every(([key, value]) => row[key] === value))
                        : [];
                    resolve({ data });
                },
            };
        },
    };
    let handler;
    const context = vm.createContext({
        Request, Response, URL, console,
        createClient: () => client,
        Deno: { env: { get: () => 'chave-interna-ficticia' }, serve: fn => { handler = fn; } },
        webpush: { setVapidDetails() {}, async sendNotification(sub) { pushes.push(sub.endpoint); } },
        fetch: () => assert.fail('O teste não deve contactar sistemas externos.'),
    });
    const helper = source('_shared/acesso-servidor.ts').replace(/^export /gm, '');
    const main = source(slug + '/index.ts').replace(/^import .*;?$/gm, '');
    vm.runInContext(stripTypeScriptTypes(helper + '\n' + main), context);
    return { queries, pushes, async request(token, body) {
        return handler(new Request('https://fixture.example.invalid', {
            method: 'POST',
            headers: token ? { authorization: 'Bearer ' + token } : {},
            body: JSON.stringify(body),
        }));
    } };
}

test('as notificações em massa exigem Super Admin antes de consultar destinatários', async () => {
    const app = serve('notificar-massa');
    const body = { grupos: ['admins'], titulo: 'Ensaio', mensagem: 'Fixture' };
    assert.equal((await app.request(undefined, body)).status, 401);
    assert.equal((await app.request('admin', body)).status, 403);
    assert.equal((await app.request('deputy', body)).status, 403);
    assert.deepEqual(app.queries, ['perfis', 'perfis']);
    assert.equal((await app.request('global', body)).status, 200);
    assert.equal(app.queries.at(-1), 'administradores');
});

test('o push preserva envios internos e limita os destinatários ao âmbito da empresa', async () => {
    const app = serve('enviar-push');
    const body = { titulo: 'Ensaio', utilizador_id: 'tec-a' };
    assert.equal((await app.request(undefined, body)).status, 401);
    assert.equal((await app.request('portal', body)).status, 403);
    assert.equal((await app.request('worker', body)).status, 200);
    assert.equal((await app.request('foreign', body)).status, 200);
    assert.equal((await app.request('admin', { ...body, utilizador_id: 'tec-c' })).status, 200);
    assert.equal((await app.request('chave-interna-ficticia', { ...body, utilizador_id: 'tec-b' })).status, 200);
    assert.deepEqual(app.pushes, ['https://fcm.googleapis.com/a', 'https://fcm.googleapis.com/b']);
});

test('a TOConline valida empresa e papel antes de consultar as credenciais', async () => {
    const app = serve('faturar-toconline');
    const body = { admin_id: 'empresa-a', acao: 'emitir_fatura', cliente: { nome: 'Exemplo' }, valor: 1 };
    assert.equal((await app.request(undefined, body)).status, 401);
    assert.equal((await app.request('foreign', body)).status, 403);
    assert.equal((await app.request('worker', body)).status, 403);
    assert.deepEqual(app.queries, ['perfis', 'perfis']);
    for (const token of ['admin', 'deputy']) {
        const response = await app.request(token, body);
        assert.equal(response.status, 200);
        assert.equal((await response.json()).ok, true);
    }
});
