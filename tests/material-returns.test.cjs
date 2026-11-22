const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');
const materiais = require('../tg-materiais-partilhados.js');
const source = fs.readFileSync('app-principal.js', 'utf8');

function setup() {
  const dom = new JSDOM('<h3 id="modalGenericoTitulo"></h3><form id="modalGenericoForm"><div id="modalGenericoCampos"></div></form><div id="modalGenericoOverlay"></div><div id="verObraConteudo"></div>');
  let id = 0;
  const ctx = {
    window: { TGMateriaisPartilhados: materiais }, document: dom.window.document, usuarioLogado: { id: 'admin' },
    dados: {
      obras: [{ id: 'obra', adminId: 'a', nome: 'Obra' }],
      servicos: [{ id: 'os', adminId: 'a' }, { id: 'linked', adminId: 'a', obraId: 'obra' }],
      artigos: [{ id: 'disco', adminId: 'a', nome: 'Disco', unidade: 'un' }],
      obraMateriais: [{ obraId: 'obra', adminId: 'a', artigoId: 'disco', qtdPrevista: 5, qtdConsumida: 6 }],
      movimentosStock: [{ adminId: 'a', artigoId: 'disco', tipo: 'saida', origemTipo: 'os', origemId: 'os', quantidade: 6 }],
      devolucoesObra: [], devolucaoObraItens: []
    },
    _tenantId: () => 'a', escapeHtmlSimples: s => s, alerts: [],
    alert: text => ctx.alerts.push(text), gerarId: () => 'id-' + (++id), getDataHoje: () => '2026-11-22',
    guardarDados: async () => {}, _fecharGenerico() {}, renderizarArmazemTudo() {}, renderizarTudo() {}
  };
  const names = ['_jaDevolvidoOuPendente', '_disponivelParaDevolver', '_recebidoObraArtigo', '_itensDisponiveisDevolucaoObra', '_verObraMostrar', 'abrirDevolverMaterialObra', 'abrirDevolverMaterialOS', '_devAbrirModalComum', '_devRenderLista', 'salvarDevolucaoObra', 'confirmarDevolucaoObra'];
  const functions = names.map(name => source.match(new RegExp('        (?:async )?function ' + name + '\\([^]*?\\n        \\}'))[0]).join('\n');
  const api = new Function('ctx', 'with(ctx){let _devObraId=null,_devServicoId=null,_devConfId=null,_devConfArmazemId=null,_devObraItens=[];' + functions + ';return {' + names.join(',') + ',itens:()=>_devObraItens,confirmar:id=>{_devConfId=id;return confirmarDevolucaoObra();}};}')(ctx);
  return { ctx, api, close: () => dom.window.close() };
}

test('consumo de OS não permite criar nem confirmar devoluções de stock', async () => {
  const t = setup();
  try {
    t.api.abrirDevolverMaterialOS('os');
    assert.deepEqual(t.api.itens(), []);
    assert.match(t.ctx.alerts[0], /ainda por consumir/);
    await t.api.salvarDevolucaoObra();
    assert.equal(t.ctx.dados.devolucoesObra.length, 0);
    t.ctx.dados.devolucoesObra.push({ id: 'old', adminId: 'a', servicoId: 'os', estado: 'pendente' });
    t.ctx.dados.devolucaoObraItens.push({ devolucaoId: 'old', artigoId: 'disco', quantidadeDeclarada: 6, quantidadeConfirmada: 6 });
    await t.api.confirmar('old');
    assert.equal(t.ctx.dados.movimentosStock.length, 1);
    assert.equal(t.ctx.dados.devolucoesObra[0].estado, 'pendente');
  } finally { t.close(); }
});

test('OS de obra devolve apenas recebido menos consumido e desconta devoluções pendentes', async () => {
  const t = setup();
  try {
    t.ctx.dados.movimentosStock.push({ adminId: 'a', obraId: 'obra', artigoId: 'disco', tipo: 'entrada', quantidade: 10 });
    t.api.abrirDevolverMaterialOS('linked');
    assert.equal(t.api.itens()[0].disponivel, 4);
    t.api.itens()[0].qtd = 3;
    await t.api.salvarDevolucaoObra();
    const d = t.ctx.dados.devolucoesObra[0];
    assert.equal(d.obraId, 'obra');
    assert.equal(d.servicoId, null);
    assert.equal(t.api._disponivelParaDevolver('obra', 'disco'), 1);
    const item = t.ctx.dados.devolucaoObraItens[0];
    item.quantidadeConfirmada = 3;
    t.ctx.dados.obraMateriais[0].qtdConsumida = 9;
    await t.api.confirmar(d.id);
    assert.equal(d.estado, 'pendente');
    assert.equal(t.ctx.dados.movimentosStock.length, 2);
    item.quantidadeConfirmada = 1;
    await t.api.confirmar(d.id);
    assert.equal(d.estado, 'confirmada');
    assert.equal(t.ctx.dados.movimentosStock.at(-1).quantidade, 1);
    await t.api.confirmar(d.id);
    assert.equal(t.ctx.dados.movimentosStock.length, 3);
  } finally { t.close(); }
});


test('aba Materiais da obra mostra excedente e só oferece a devolução com saldo recebido', () => {
  const t = setup();
  try {
    const root = t.ctx.document.getElementById('verObraConteudo');
    t.api._verObraMostrar('obra', 'materiais');
    const excedente = root.querySelector('.tg-material-excedente');
    assert.equal(excedente.textContent, 'Excedente: 1 un');
    assert.equal(excedente.previousElementSibling.textContent, 'Falta consumir: 0 un');
    const temBotao = () => [...root.querySelectorAll('button')].some(b => b.textContent.includes('Devolver material ao armazém'));
    assert.equal(temBotao(), false);
    t.api.abrirDevolverMaterialObra('obra');
    assert.match(t.ctx.alerts.at(-1), /Não há material recebido/);

    t.ctx.dados.movimentosStock.push(
      { adminId: 'a', obraId: 'obra', artigoId: 'disco', tipo: 'entrada', quantidade: 6 },
      { adminId: 'a', obraId: 'obra', artigoId: 'cabo', tipo: 'entrada', quantidade: 2.5 },
      { adminId: 'outra', obraId: 'obra', artigoId: 'disco', tipo: 'entrada', quantidade: 9 }
    );
    t.ctx.dados.artigos.push({ id: 'cabo', adminId: 'a', nome: 'Cabo', unidade: 'm' });
    t.api._verObraMostrar('obra', 'materiais');
    assert.equal(temBotao(), true);
    t.api.abrirDevolverMaterialObra('obra');
    assert.deepEqual(t.api.itens().map(it => [it.artigoId, it.disponivel]), [['cabo', 2.5]]);
    assert.equal(t.ctx.document.querySelector('#dev_itens_lista input').step, 'any');
  } finally { t.close(); }
});

test('editar a quantidade a confirmar mantém o saldo reservado até o armazém confirmar', () => {
  const t = setup();
  try {
    t.ctx.dados.movimentosStock.push({ adminId: 'a', obraId: 'obra', artigoId: 'disco', tipo: 'entrada', quantidade: 10 });
    const devolucao = { id: 'pendente', adminId: 'a', obraId: 'obra', estado: 'pendente' };
    t.ctx.dados.devolucoesObra.push(devolucao);
    t.ctx.dados.devolucaoObraItens.push({ devolucaoId: devolucao.id, artigoId: 'disco', quantidadeDeclarada: 3, quantidadeConfirmada: 1 });
    assert.equal(t.api._disponivelParaDevolver('obra', 'disco'), 1);
    devolucao.estado = 'confirmada';
    assert.equal(t.api._disponivelParaDevolver('obra', 'disco'), 3);
  } finally { t.close(); }
});
