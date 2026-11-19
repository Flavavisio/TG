const test = require('node:test');
const assert = require('node:assert/strict');
const m = require('../tg-materiais-partilhados.js');

test('materiais previstos, consumo parcial e saldo', () => {
  const result = m.resumo([{ referencia: 'CAT6', descricao: 'Cabo Cat6', quantidade: 100, unidade: 'm' }], [
    { id: 'm1', referencia: 'CAT6', quantidade: 20 },
    { id: 'm2', referencia: 'CAT6', quantidade: 40 }
  ]);
  assert.deepEqual(result.map(x => [x.previsto, x.consumido, x.faltaConsumir]), [[100, 60, 40]]);
});
test('o mesmo movimento não conta duas vezes', () => {
  const p = [{ referencia: 'CAM', descricao: 'Câmara', quantidade: 8 }];
  assert.equal(m.resumo(p, [{ id: 'm1', referencia: 'CAM', quantidade: 3 }, { id: 'm1', referencia: 'CAM', quantidade: 3 }])[0].consumido, 3);
});
test('material não previsto fica sinalizado', () => {
  const r = m.resumo([], [{ id: 'x', referencia: 'EXTRA', descricao: 'Conector', quantidade: 2 }])[0];
  assert.equal(r.extraNaoPrevisto, true);
  assert.equal(r.excedente, 2);
});
test('importação bloqueia quantidades inválidas e indica linha', () => {
  const r = m.importarLinhas([{ referencia: 'C1', descricao: 'Cabo', quantidade: 5 }, { referencia: 'C2', quantidade: -3 }]);
  assert.equal(r.podeConfirmar, false);
  assert.equal(r.erros[0].linha, 3);
});
test('aceita vírgula decimal', () => {
  assert.equal(m.normalizarPlano({ referencia: 'A', quantidade: '2,5' }).quantidade, 2.5);
});
test('OS ligada a obra preserva origem OS', () => {
  assert.deepEqual(m.destinoMovimento({ tipo: 'os', osId: 's1', obraId: 'o1' }), { tipo: 'os', origemId: 's1', obraId: 'o1' });
});
test('agregação da obra usa OS associadas, sem dupla contagem do mesmo ID', () => {
  const movimentos = [
    { id: 'm1', tipo: 'os', origemId: 's1', referencia: 'A', quantidade: 2 },
    { id: 'm1', tipo: 'os', origemId: 's1', referencia: 'A', quantidade: 2 },
    { id: 'm2', tipo: 'obra', origemId: 'o1', referencia: 'A', quantidade: 3 },
    { id: 'm3', tipo: 'os', origemId: 's2', referencia: 'A', quantidade: 4 }
  ];
  assert.deepEqual(m.movimentosDaObra(movimentos, 'o1', ['s1']).map(x => x.id), ['m1', 'm2']);
});

test('importação em matriz Excel aceita cabeçalhos equivalentes e vírgulas', () => {
  const x = m.importarMatriz(['Referência','Descrição','Qtd Prevista','Unidade'], [['C-1','Cabo','12,5','m']]);
  assert.equal(x.podeConfirmar, true);
  assert.equal(x.materiais[0].quantidade, 12.5);
});
test('Excel sem coluna quantidade fica bloqueado', () => {
  const x = m.importarMatriz(['Ref','Artigo'], [['A','Produto']]);
  assert.equal(x.podeConfirmar, false);
  assert.equal(x.erros[0].linha, 1);
});
test('adapta primeira folha do leitor XLSX', () => {
  const sheet = { content: [['Código','Nome','Quantidade'],['A','Equipamento',2]] };
  const book = { SheetNames:['Folha1'], Sheets:{ Folha1: sheet } };
  const xlsx = { utils: { sheet_to_json: s => s.content } };
  assert.equal(m.importarFolhaXlsx(book,xlsx).materiais[0].referencia, 'A');
});
test('HTML de saldos escapa valores externos', () => {
  const html = m.renderizarSaldos(m.resumo([{referencia:'C',descricao:'<img src=x>',quantidade:3}],[]));
  assert.match(html,/&lt;img src=x&gt;/);
  assert.doesNotMatch(html,/<img/);
  assert.match(html,/Falta consumir: 3 un\./);
});
