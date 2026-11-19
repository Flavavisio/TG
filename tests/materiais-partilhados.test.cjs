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
