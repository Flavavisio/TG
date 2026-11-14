'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const file = fs.readFileSync(path.join(__dirname,
  '../supabase/functions/super-function/enviar-email.ts'), 'utf8');
const begin = file.indexOf('const TG_EMAIL_ADMIN_TIPOS');
const end = file.indexOf('Deno.serve(async', begin);
assert(begin >= 0 && end > begin, 'Email authorization helpers missing');

const env = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service-secret',
  SUPABASE_ANON_KEY: 'public-key',
};
const tokenUsers = {
  'admin-token': { id: 'u-admin' },
  'employee-token': { id: 'u-employee' },
  'super-token': { id: 'u-super' },
};
const rows = {
  perfis: [
    { id: 'u-admin', papel: 'admin', registo_id: 't-a', admin_id: null },
    { id: 'u-employee', papel: 'funcionario', registo_id: 'f1', admin_id: 't-a' },
    { id: 'u-super', papel: 'superadmin', registo_id: 'superadmin', admin_id: null },
  ],
  administradores: [{ id: 't-a', email: 'admin@a.test' }],
  funcionarios: [
    { id: 'f1', email: 'colaborador@a.test', admin_id: 't-a' },
    { id: 'f2', email: 'colaborador@b.test', admin_id: 't-b' },
  ],
  encarregados: [],
  clientes: [{ id: 'c1', email: 'cliente@a.test', admin_id: 't-a' }],
};
function mockClient(_url, key) {
  if (key === 'public-key') {
    return { auth: {
      async getUser(token) {
        return { data: { user: tokenUsers[token] || null },
          error: tokenUsers[token] ? null : { message: 'invalid' } };
      },
    } };
  }
  assert.equal(key, 'service-secret');
  return { from(table) {
    const filters = [];
    let ilike = null;
    const q = {
      select() { return this; },
      eq(k, v) { filters.push([k,v]); return this; },
      ilike(k, v) { ilike = [k,v]; return this; },
      limit() { return this; },
      items() {
        return (rows[table] || []).filter(row =>
          filters.every(([k,v]) => row[k] === v)
          && (!ilike || String(row[ilike[0]] || '').toLowerCase()
                 === ilike[1].replace(/\\/g,'').toLowerCase()));
      },
      maybeSingle() {
        return Promise.resolve({ data: this.items()[0] || null, error: null });
      },
      then(resolve, reject) {
        return Promise.resolve({ data: this.items(), error: null }).then(resolve, reject);
      },
    };
    return q;
  } };
}
const sandbox = {
  Deno: { env: { get(name) { return env[name]; } } },
  createClient: mockClient,
  URL, Set,
};
vm.runInNewContext(file.slice(begin, end) + '\n' +
  'globalThis.tgTest = { autorizarEnvio, linkTotalGestSeguro, validarEndereco };',
  sandbox);
const { autorizarEnvio, linkTotalGestSeguro, validarEndereco } = sandbox.tgTest;
const request = token => ({ headers: { get(name) {
  return name === 'authorization' && token ? 'Bearer ' + token : '';
} } });

test('must reject missing, anonymous and invalid user credentials', async () => {
  const body = { tipo:'boas_vindas_equipa', to_email:'colaborador@a.test' };
  assert.equal((await autorizarEnvio(request(), body)).status, 401);
  assert.equal((await autorizarEnvio(request('public-key'), body)).status, 401);
  assert.equal((await autorizarEnvio(request('fake-token'), body)).status, 401);
});

test('non-manager and cross-tenant contacts cannot send emails', async () => {
  const body = { tipo:'boas_vindas_equipa', to_email:'colaborador@a.test' };
  assert.equal((await autorizarEnvio(request('employee-token'), body)).status, 403);
  assert.equal((await autorizarEnvio(request('admin-token'),
    { ...body, to_email:'colaborador@b.test' })).status, 403);
});

test('manager can send approved operational email only within tenant', async () => {
  assert.equal((await autorizarEnvio(request('admin-token'),
    { tipo:'boas_vindas_equipa', to_email:'colaborador@a.test' })).ok, true);
  assert.equal((await autorizarEnvio(request('admin-token'),
    { tipo:'recuperar_password', to_email:'colaborador@a.test' })).status, 403);
});

test('trusted backend and authenticated superadmin can dispatch', async () => {
  const body = { tipo:'recuperar_password', to_email:'contato@exemplo.test' };
  assert.equal((await autorizarEnvio(request('service-secret'), body)).ok, true);
  assert.equal((await autorizarEnvio(request('super-token'), body)).ok, true);
});

test('only trusted HTTPS action links and valid email formats accepted', () => {
  assert.equal(linkTotalGestSeguro('https://www.totalgest.pt/redefinir-password.html'), true);
  assert.equal(linkTotalGestSeguro('https://example.supabase.co/auth/v1/verify?token=a'), true);
  assert.equal(linkTotalGestSeguro('https://evil.example/verify'), false);
  assert.equal(linkTotalGestSeguro('javascript:alert(1)'), false);
  assert.equal(validarEndereco('pessoa@empresa.pt'), true);
  assert.equal(validarEndereco('pessoa@empresa.pt\nBcc:other@empresa.pt'), false);
});
