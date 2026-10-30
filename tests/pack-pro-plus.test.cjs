// Testes de contrato comercial do Pack Pro+.
// Executar: node --test tests/pack-pro-plus.test.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const landing = fs.readFileSync(path.join(root, 'landing-calculadora.js'), 'utf8');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const planos = fs.readFileSync(path.join(root, 'planos.html'), 'utf8');

const base = [72.49, 77.49, 92.49, 132.49];
const expected = [82.48, 87.48, 102.48, 142.48];

test('Pro+ custa Pro + 9,99 euros em cada escalão', () => {
    assert.deepEqual(base.map(v => Math.round((v + 9.99) * 100) / 100), expected);
    assert.match(landing, /PACK_PRECOS_SITE\.pro_plus\s*=\s*Object\.fromEntries/);
});
test('site exibe o pack Pro+ mas não permite contratar sem backend', () => {
    assert.match(index, /data-pack="pro_plus"/);
    assert.match(index, /data-pack-details="pro_plus"/);
    assert.doesNotMatch(index, /data-pack-start="pro_plus"/);
    assert.match(planos, /id="pro-plus"/);
});
test('o Pro+ mostra CRM incluído na tabela comparativa', () => {
    assert.match(landing, /p === 'pro_plus' && l\[0\] === 'CRM Comercial'/);
});
test('preços do Pro+ presentes na tabela pública', () => {
    for (const price of expected) assert.ok(planos.includes(price.toFixed(2).replace('.', ',') + ' €'));
});

test('calculadora recomenda Pro+ para CRM e evita ativação sem backend', () => {
    assert.match(landing, /necessidades\.includes\('crm'\) && nivel <= 3 \? 'pro_plus'/);
    assert.match(landing, /anual \|\| r\.pack === 'pro_plus'/);
});
test('FAQ e SEO identificam CRM no Pro+ e Supreme', () => {
    assert.match(planos, /O CRM Comercial está incluído nos packs Pro\+ e Supreme\./);
    assert.match(planos, /"name": "Pro\+ — até 5 funcionários"/);
});

test('aprovação de pack respeita mensal/anual nos módulos incluídos', () => {
    const app = fs.readFileSync(path.join(root, 'app-principal.js'), 'utf8');
    assert.match(app, /function aplicarPackAoAdmin\(admin, nomePack, validadeMs, periodo = 'mensal'\)/);
    assert.match(app, /admin\[planoKey\] = periodo === 'anual' \? 'anual' : 'mensal'/);
    assert.match(app, /aplicarPackAoAdmin\(admin, pedido\.packPedido, novaValidade, pedido\.periodoPedido\)/);
});
