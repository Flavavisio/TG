const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');
const XLSX = require('xlsx');
const materiais = require('../tg-materiais-partilhados.js');
const source = fs.readFileSync('app-principal.js', 'utf8');
const names = ['_saldosPlanoOS', '_podeGerirPlanoOS', 'abrirPlanoMateriaisOS',
  '_artigoCorrespondePesquisa', '_parseCsvLine', '_contextoMateriaisFolha', '_quiosqueAgendaPlanoMateriais',
  '_quiosqueAgendaValidarMateriais', '_abrirSelecaoMateriais', '_materializarConsumo',
  '_textoMateriaisSelecionados', '_somarConsumoObra', '_aplicarConsumoFolha', 'renderizarMateriaisDetalheOS'];

function setup() {
  const dom = new JSDOM('<div id="root"></div>');
  const w = dom.window;
  w.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  w.HTMLDialogElement.prototype.close = function () { this.open = false; this.dispatchEvent(new w.Event('close')); };
  let id = 0;
  const os = { id: 'os', adminId: 'a', obraId: null, materiaisPlano: [], numeroRegisto: 'OS 1' };
  const ctx = {
    window: w, document: w.document, Option: w.Option,
    dados: { servicos: [os], artigos: [
      { id: 'cabo', adminId: 'a', nome: 'Cabo', referencia: 'C6', unidade: 'm' },
      { id: 'extra', adminId: 'a', nome: 'Conector', referencia: 'RJ', unidade: 'un' },
      { id: 'foreign', adminId: 'b', nome: 'Outro', referencia: 'OUT', unidade: 'un' }
    ], obras: [{ id: 'obra', adminId: 'a' }, { id: 'obra2', adminId: 'a' }],
    obraMateriais: [], folhasObra: [], movimentosStock: [], notificacoes: [] },
    usuarioLogado: { id: 'admin', role: 'admin', adminId: 'a' },
    _tenantId: () => 'a', _armazemPrincipalId: () => 'armazem',
    gerarId: () => 'id-' + (++id), getDataHoje: () => '2026-11-20',
    _guardarCacheLocal: () => {}, _verOsMostrar: () => {}, _armazemAtualizarAvisoStock: () => {},
    guardarDados: async () => {}, calls: [], response: null, error: null
  };
  ctx.supa = { from(table) {
    ctx.calls.push(['from', table]);
    const query = {};
    for (const method of ['update', 'eq', 'is', 'select']) query[method] = (...args) => {
      ctx.calls.push([method, ...args]);
      return query;
    };
    query.maybeSingle = async () => ({ data: ctx.response, error: ctx.error });
    return query;
  } };
  w.TGMateriaisPartilhados = materiais;
  w.XLSX = XLSX;
  const functions = names.map(name => {
    const found = source.match(new RegExp('        (?:async )?function ' + name + '\\([^]*?\\n        \\}'));
    assert(found, name);
    return found[0];
  }).join('\n');
  const api = new Function('ctx', 'with(ctx){' + functions + ';return {' + names.join(',') + '};}')(ctx);
  return { ctx, os, api, w, close: () => w.close() };
}
async function importFile(t, file) {
  const input = t.w.document.getElementById('tg-plano-os-ficheiro');
  Object.defineProperty(input, 'files', { configurable: true, value: [file] });
  await input.onchange({ currentTarget: input });
}
function quantities(t) {
  return [...t.w.document.querySelectorAll('#tg-plano-os-lista input')].map(input => Number(input.value));
}

test('Excel real: pré-visualiza, agrega referências repetidas e só grava após confirmação', async () => {
  const t = setup();
  try {
    t.api.abrirPlanoMateriaisOS('os');
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
      ['Referência', 'Artigo', 'Quantidade'], ['C6', 'Cabo', 2.5], ['C6', 'Cabo', 1.25]
    ]), 'Materiais');
    const bytes = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    await importFile(t, { name: 'plano.xlsx', arrayBuffer: async () => bytes });
    assert.deepEqual(quantities(t), [3.75]);
    assert.deepEqual(t.os.materiaisPlano, []);
    assert.deepEqual(t.ctx.dados.movimentosStock, []);
    t.ctx.response = { materiais_previstos: [{ artigoId: 'cabo', qtdPrevista: 3.75 }] };
    await t.w.document.querySelector('#tg-plano-os form').onsubmit({ preventDefault() {} });
    assert.deepEqual(t.os.materiaisPlano, t.ctx.response.materiais_previstos);
    assert(t.ctx.calls.some(c => c[0] === 'eq' && c[1] === 'admin_id' && c[2] === 'a'));
    assert(t.ctx.calls.some(c => c[0] === 'eq' && c[1] === 'materiais_previstos' && c[2] === '[]'));
    assert(!t.w.document.getElementById('tg-plano-os'));
  } finally { t.close(); }
});

test('CSV: vírgula decimal e erros bloqueiam todo o ficheiro sem alterar a pré-visualização', async () => {
  const t = setup();
  try {
    t.api.abrirPlanoMateriaisOS('os');
    await importFile(t, { name: 'plano.csv', text: async () => 'Artigo;Quantidade\nC6;2,5' });
    assert.deepEqual(quantities(t), [2.5]);
    for (const text of ['Artigo;Quantidade\nC6;3\nOUT;2', 'Artigo;Quantidade\nC6;-1', 'Artigo;Quantidade\nC6;abc']) {
      await importFile(t, { name: 'invalido.csv', text: async () => text });
      assert.deepEqual(quantities(t), [2.5]);
      assert.match(t.w.document.getElementById('tg-plano-os-estado').textContent, /Linha/);
    }
    assert.deepEqual(t.os.materiaisPlano, []);
    assert.deepEqual(t.ctx.calls, []);
  } finally { t.close(); }
});

test('plano: seleciona artigo por referência e mantém o nome completo visível', () => {
  const t = setup();
  try {
    const artigo = t.ctx.dados.artigos[0];
    artigo.nome = 'Cabo para instalação exterior com isolamento e proteção adicionais';
    t.api.abrirPlanoMateriaisOS('os');
    const el = id => t.w.document.getElementById('tg-plano-os-' + id);
    const pesquisa = el('artigos');
    pesquisa.value = 'c6';
    pesquisa.dispatchEvent(new t.w.Event('input'));
    assert.equal(el('resultados').childElementCount, 1);
    el('resultados').querySelector('button').click();
    assert.equal(el('escolhido').textContent, artigo.nome + ' — C6');
    assert.equal(el('escolhido').hidden, false);
    assert.deepEqual(quantities(t), []);
    el('adicionar').click();
    assert.deepEqual(quantities(t), [1]);
    assert.equal(el('lista').querySelector('strong').textContent, artigo.nome + ' — C6');
    assert.equal(t.w.document.activeElement, el('lista').querySelector('input'));
    pesquisa.value = 'c6';
    pesquisa.dispatchEvent(new t.w.Event('input'));
    assert.equal(el('resultados').querySelector('button'), null);
    assert(el('adicionar').disabled);
  } finally { t.close(); }
});

test('plano: conflito no servidor preserva o rascunho e cancelar não grava', async () => {
  const t = setup();
  try {
    t.api.abrirPlanoMateriaisOS('os');
    await importFile(t, { name: 'plano.csv', text: async () => 'Artigo;Quantidade\nC6;2' });
    await t.w.document.querySelector('#tg-plano-os form').onsubmit({ preventDefault() {} });
    assert.match(t.w.document.getElementById('tg-plano-os-estado').textContent, /mudou no servidor/);
    assert.deepEqual(t.os.materiaisPlano, []);
    assert.deepEqual(quantities(t), [2]);
    t.w.document.getElementById('tg-plano-os-cancelar').click();
    assert(!t.w.document.getElementById('tg-plano-os'));
  } finally { t.close(); }
});

test('só a gestão da própria empresa altera planos de OS independentes', () => {
  const t = setup();
  try {
    for (const change of [{ role: 'funcionario' }, { role: 'cliente' }]) {
      Object.assign(t.ctx.usuarioLogado, change);
      t.api.abrirPlanoMateriaisOS('os');
      assert(!t.w.document.getElementById('tg-plano-os'));
    }
    t.ctx.usuarioLogado.role = 'subadmin';
    t.os.adminId = 'b';
    t.api.abrirPlanoMateriaisOS('os');
    assert(!t.w.document.getElementById('tg-plano-os'));
    t.os.adminId = 'a'; t.os.obraId = 'obra';
    t.api.abrirPlanoMateriaisOS('os');
    assert(!t.w.document.getElementById('tg-plano-os'));
    t.os.obraId = null;
    t.api.abrirPlanoMateriaisOS('os');
    assert(t.w.document.getElementById('tg-plano-os'));
  } finally { t.close(); }
});

test('consumo: regravar a mesma folha conserva IDs, stock e total da obra', () => {
  const t = setup();
  try {
    const consumos = [{ artigoId: 'cabo', consumido: 2.5 }];
    t.api._aplicarConsumoFolha('f', 'obra', consumos);
    const id = t.ctx.dados.movimentosStock[0].id;
    t.api._aplicarConsumoFolha('f', 'obra', consumos);
    assert.equal(t.ctx.dados.movimentosStock.length, 1);
    assert.equal(t.ctx.dados.movimentosStock[0].id, id);
    assert.equal(t.ctx.dados.obraMateriais[0].qtdConsumida, 2.5);
    t.api._aplicarConsumoFolha('f', 'obra2', [{ artigoId: 'cabo', consumido: 1.5 }]);
    assert.equal(t.ctx.dados.obraMateriais[0].qtdConsumida, 0);
    assert.equal(t.ctx.dados.obraMateriais[1].qtdConsumida, 1.5);
  } finally { t.close(); }
});

test('OS independente: modal usa plano próprio, soma folha e consumo direto uma única vez', () => {
  const t = setup();
  try {
    t.os.materiaisPlano = [{ artigoId: 'cabo', qtdPrevista: 10 }];
    t.ctx.dados.folhasObra.push({ id: 'f', adminId: 'a', servicoId: 'os' });
    t.api._aplicarConsumoFolha('f', null, [{ artigoId: 'cabo', consumido: 2 }]);
    t.ctx.dados.movimentosStock.push({ ...t.ctx.dados.movimentosStock[0] });
    const root = t.w.document.getElementById('root');
    t.api.renderizarMateriaisDetalheOS(root, t.os);
    assert.match(root.textContent, /Consumido: 2 m/);
    [...root.querySelectorAll('button')].find(b => b.textContent === 'Registar consumo direto').click();
    assert.match(t.w.document.getElementById('qsa_planeados').textContent, /Falta consumir: 8 m/);
    const checkbox = t.w.document.querySelector('#qsa_planeados input[type=checkbox]');
    checkbox.checked = true; checkbox.dispatchEvent(new t.w.Event('change'));
    const quantity = t.w.document.querySelector('#qsa_planeados input[type=number]');
    quantity.value = '1.5'; quantity.dispatchEvent(new t.w.Event('input'));
    const confirm = t.w.document.getElementById('qsa_mat_confirmar');
    confirm.click(); confirm.click();
    assert.equal(t.api._saldosPlanoOS(t.os)[0].qtdConsumida, 3.5);
    assert.equal(t.ctx.dados.movimentosStock.filter(m => m.origemTipo === 'os').length, 1);
    assert.equal(t.ctx.dados.obraMateriais.length, 0);
  } finally { t.close(); }
});
