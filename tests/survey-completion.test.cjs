const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');

function setup() {
    const { window } = new JSDOM('<main><div id="detalhe"></div><div id="outro"></div></main>', {
        runScripts: 'outside-only', url: 'https://example.invalid/login.html'
    });
    window.usuarioLogado = { id: 'empresa', role: 'admin' };
    window.dados = {
        servicos: [
            { id: 'mesmo-id', adminId: 'empresa', clienteId: 'cliente', status: 'pendente' },
            { id: 'cancelada', adminId: 'empresa', clienteId: 'cliente', status: 'cancelado' },
            { id: 'alheia', adminId: 'outra', clienteId: 'cliente', status: 'concluído' }
        ],
        obras: [{ id: 'mesmo-id', adminId: 'empresa', clienteId: 'cliente', estado: 'ativa' }]
    };
    const rows = [];
    const writes = [];
    window.TGSurveyConfig = { snapshot: async () => ({ perguntas: [] }) };
    window.supa = { from: () => ({
        select: () => ({ eq: () => ({ order: () => ({ limit: async () => ({ data: rows }) }) }) }),
        insert: payload => ({ select: () => ({ single: async () => {
            writes.push(payload);
            const row = { ...payload, expira_em: '2099-12-31' };
            rows.push(row);
            return { data: row };
        } }) })
    }) };
    window.eval(fs.readFileSync('tg-os-surveys.js', 'utf8'));
    return { window, api:window.TGOSSurveys, detail:window.document.getElementById('detalhe'), writes };
}

test('surveys only appear in completed OS and work details and respect the company and role', () => {
    const { window, api, detail } = setup();
    try {
        for (const [kind, id] of [['os', 'mesmo-id'], ['os', 'cancelada'], ['os', 'alheia'], ['obra', 'mesmo-id']]) {
            detail.replaceChildren();
            api.mount(kind, id, detail);
            assert.equal(detail.querySelector('[data-sat-os-button]'), null);
        }
        window.dados.servicos[0].status = 'concluído';
        detail.replaceChildren();
        api.mount('os', 'mesmo-id', detail);
        assert(detail.querySelector('[data-sat-os-button]'));
        assert.equal(window.document.querySelector('#outro [data-sat-os-button]'), null);
        detail.replaceChildren();
        window.dados.obras[0].estado = 'concluida';
        api.mount('obra', 'mesmo-id', detail);
        assert(detail.querySelector('[data-sat-os-button]'));
        detail.replaceChildren();
        window.usuarioLogado.role = 'funcionario';
        api.mount('obra', 'mesmo-id', detail);
        assert.equal(detail.querySelector('[data-sat-os-button]'), null);
    } finally { window.close(); }
});

test('a reopened OS cannot generate a link even when the previous survey is cached', async () => {
    const { window, api, writes } = setup();
    try {
        await assert.rejects(api.linkForOS('mesmo-id'), /após concluir/);
        assert.equal(writes.length, 0);
        window.dados.servicos[0].status = 'concluído';
        await api.linkForOS('mesmo-id');
        assert.equal(writes[0].servico_id, 'mesmo-id');
        window.dados.servicos[0].status = 'em andamento';
        await assert.rejects(api.linkForOS('mesmo-id'), /após concluir/);
        assert.equal(writes.length, 1);
    } finally { window.close(); }
});

test('a completed work creates a link distinct from the OS with the same identifier', async () => {
    const { window, api, detail, writes } = setup();
    try {
        window.dados.servicos[0].status = 'concluído';
        await api.linkForOS('mesmo-id');
        window.dados.obras[0].estado = 'concluida';
        api.mount('obra', 'mesmo-id', detail);
        const button = detail.querySelector('[data-sat-os-button]');
        button.getClientRects = () => [1];
        button.click();
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(writes.length, 2);
        assert.equal(writes[1].obra_id, 'mesmo-id');
        assert.equal(writes[1].servico_id, undefined);
        assert.notEqual(writes[0].token, writes[1].token);
        assert(window.document.querySelector('#tgSurveyShare'));
    } finally { window.close(); }
});
