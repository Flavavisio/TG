const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const src = fs.readFileSync('app-principal.js', 'utf8');
const fn = name => {
  const match = src.match(new RegExp('        (?:async )?function ' + name + '\\([^]*?\\n        \\}'));
  assert(match, name);
  return match[0];
};
const today = '2026-10-24';
const row = extra => ({ funcionarioId: 'vanda', data: today, entrada: '08:00', saida: null, ...extra });
async function run({ ponto = [], obras = [], pausa = null } = {}) {
  const calls = [];
  const dados = { ponto, obraPontoLonga: obras, obras: [{ id: 'obra', nome: 'OBRA DE TESTE' }], servicos: [] };
  const before = JSON.stringify(dados);
  const ctx = vm.createContext({
    dados, usuarioLogado: { id: 'vanda', role: 'funcionario' },
    getDataHoje: () => today, abrirModalEntradaPonto: () => calls.push('entrada'),
    alert: text => calls.push(text), _pausaAlmocoPendente: () => pausa,
    perguntarSaidaOuAlmoco: async () => { calls.push('saida'); return null; }
  });
  vm.runInContext('let _picandoEntrada = false;\n' + fn('pontoAbertoHoje') + '\n' + fn('picarPonto'), ctx);
  await ctx.picarPonto();
  assert.equal(JSON.stringify(dados), before, 'must not rewrite times or close historical entries');
  return calls;
}
test('new day entry succeeds with an old open worksite', async () => {
  assert.deepEqual(await run({ ponto: [row({ data: '2026-10-23', saida: '00:11' })], obras: [row({ data: '2026-10-23', obraId: 'obra' })] }), ['entrada']);
});
test('entry succeeds with current worksite or unresolved lunch when general is closed', async () => {
  assert.deepEqual(await run({ obras: [row({ obraId: 'obra' })] }), ['entrada']);
  assert.deepEqual(await run({ pausa: { tipo: 'obra', nome: 'Obra' } }), ['entrada']);
});
test('general exit ignores historical open worksites', async () => {
  assert.deepEqual(await run({ ponto: [row({})], obras: [row({ data: '2026-10-23', obraId: 'obra' })] }), ['saida']);
});
test('general exit still blocks current open worksite and OS', async () => {
  assert.match((await run({ ponto: [row({})], obras: [row({ obraId: 'obra' })] }))[0], /Tens uma entrada aberta na obra/);
  assert.match((await run({ ponto: [row({}), row({ servicoId: 'os' })] }))[0], /Tens uma entrada aberta na OS/);
});
test('general exit still blocks unresolved lunch and ignores other people', async () => {
  assert.match((await run({ ponto: [row({})], pausa: { tipo: 'obra', nome: 'Obra' } }))[0], /pausa para almoço/);
  assert.deepEqual(await run({ ponto: [row({})], obras: [row({ obraId: 'obra', funcionarioId: 'other' })] }), ['saida']);
});

function midnightSetup({ rows = [], confirm = { data: today, hora: '00:12' }, fail = false } = {}) {
  const calls = [];
  const dados = { obraPontoLonga: rows };
  class Clock extends Date {
    constructor(...args) { super(...(args.length ? args : ['2026-10-24T00:12:00Z'])); }
    toTimeString() { return '00:12:00 GMT+0000'; }
  }
  let nextId = 0;
  const ctx = vm.createContext({
    Date: Clock, dados, usuarioLogado: { id: 'vanda', role: 'funcionario' },
    getDataHoje: () => today, escapeHtmlSimples: x => x,
    gerarId: () => 'split-' + ++nextId, alert: x => calls.push(x),
    _pedirSaidaObraAnterior: async () => confirm,
    _mostrarCarregando() {}, _esconderCarregando() {}, renderizarTudo() {},
    _refrescarModalObraLongaSeAberto() {},
    guardarDados: async () => { calls.push('save'); if (fail) throw new Error('offline'); }
  });
  for (const name of ['_obraLongaPontoAberto', '_obraLongaPontoAbertoQualquer', '_botaoPontoObraHTML', '_intervalosSaidaObra', '_obraLongaRegistarSaida', 'calcularHoras']) vm.runInContext(fn(name), ctx);
  return { ctx, dados, calls };
}
const night = extra => row({ id: 'old', obraId: 'obra', data: '2026-10-23', entrada: '23:30', ...extra });
test('exit remains visible after midnight, even if worksite is concluded or reassigned', () => {
  const { ctx } = midnightSetup({ rows: [night()] });
  assert.equal(ctx._obraLongaPontoAberto('obra').id, 'old');
  assert.equal(ctx._obraLongaPontoAbertoQualquer().id, 'old');
  assert.match(ctx._botaoPontoObraHTML({ id: 'obra', estado: 'concluida', responsaveisIds: ['other'] }), /obraLongaPicarSaida/);
  assert.equal(ctx._obraLongaPontoAberto('different'), null);
});
test('other peoples historical entries do not create an exit button', () => {
  const { ctx } = midnightSetup({ rows: [night({ funcionarioId: 'other' })] });
  assert.equal(ctx._obraLongaPontoAberto('obra'), null);
  assert.match(ctx._botaoPontoObraHTML({ id: 'obra' }), /obraLongaPicarEntrada/);
});
test('confirmed overnight exit splits precisely by civil day: 23:30 to 00:12 = 42 minutes', async () => {
  const { ctx, dados, calls } = midnightSetup({ rows: [night()] });
  assert.equal(await ctx._obraLongaRegistarSaida('obra'), true);
  assert.deepEqual(dados.obraPontoLonga.map(x => [x.data, x.entrada, x.saida]), [
    ['2026-10-23', '23:30', '24:00'], ['2026-10-24', '00:00', '00:12']
  ]);
  const total = dados.obraPontoLonga.reduce((n, x) => n + ctx.calcularHoras(x.entrada, x.saida), 0);
  assert.equal(total, 0.7);
  assert.equal(ctx._obraLongaPontoAberto('obra'), null);
  assert.equal(calls.filter(x => x === 'save').length, 1);
  await ctx._obraLongaRegistarSaida('obra');
  assert.equal(dados.obraPontoLonga.length, 2, 'repeated exit must not duplicate segments');
});
test('forgotten exit accepts actual previous-day time rather than counting until now', async () => {
  const { ctx, dados } = midnightSetup({ rows: [night({ entrada: '08:00' })], confirm: { data: '2026-10-23', hora: '17:00' } });
  assert.equal(await ctx._obraLongaRegistarSaida('obra'), true);
  assert.equal(dados.obraPontoLonga.length, 1);
  assert.equal(ctx.calcularHoras(dados.obraPontoLonga[0].entrada, dados.obraPontoLonga[0].saida), 9);
});
test('cancelled recovery leaves all original times untouched', async () => {
  const { ctx, dados, calls } = midnightSetup({ rows: [night()], confirm: null });
  const before = JSON.stringify(dados);
  assert.equal(await ctx._obraLongaRegistarSaida('obra'), false);
  assert.equal(JSON.stringify(dados), before);
  assert.equal(calls.length, 0);
});
test('exit before entry, future time and invalid dates are rejected', () => {
  const { ctx } = midnightSetup();
  for (const [day, time] of [['2026-10-23','22:00'], ['2026-10-24','00:13'], ['2026-02-30','12:00'], ['bad','12:00'], ['2026-10-24','24:00']]) {
    assert.throws(() => ctx._intervalosSaidaObra(night(), day, time));
  }
});
test('midnight boundary produces no extra zero-length segment', () => {
  const { ctx } = midnightSetup();
  const parts = ctx._intervalosSaidaObra(night(), today, '00:00');
  assert.equal(parts.length, 1);
  assert.equal(parts[0].saida, '24:00');
});
test('month and year boundaries are split without losing minutes', () => {
  const { ctx } = midnightSetup();
  const parts = ctx._intervalosSaidaObra(night({ data: '2025-12-31' }), '2026-01-01', '00:12');
  assert.equal(parts[1].data, '2026-01-01');
  assert.equal(parts.reduce((sum, x) => sum + ctx.calcularHoras(x.entrada, x.saida), 0), 0.7);
});
test('save failure never reports a confirmed exit', async () => {
  const { ctx, calls } = midnightSetup({ rows: [night()], fail: true });
  assert.equal(await ctx._obraLongaRegistarSaida('obra'), false);
  assert(calls.some(x => x.includes('NÃO foi confirmada')));
  assert(!calls.some(x => x.includes('registada e confirmada')));
});
