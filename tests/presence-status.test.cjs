const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const src = fs.readFileSync('app-principal.js', 'utf8');
const hoje = '2026-10-21';
const fn = name => {
  const match = src.match(new RegExp('        function ' + name + '\\([^]*?\\n        \\}'));
  assert(match, name);
  return match[0];
};
function setup(ponto = [], obraPontoLonga = []) {
  const dados = { ponto, obraPontoLonga, servicos: [{ id: 'os', obraId: 'obra', clienteId: 'cliente' }], obras: [{ id: 'obra', nome: 'Obra teste' }] };
  const ctx = vm.createContext({ dados, obterNomeCliente: () => 'Cliente teste' });
  vm.runInContext(fn('_funcionarioAusenteEm') + '\n' + fn('_estadoPresencaPessoa'), ctx);
  return { dados, estado: () => ctx._estadoPresencaPessoa('f', hoje) };
}
const geral = (entrada, saida, extra = {}) => ({ funcionarioId: 'f', data: hoje, entrada, saida, ...extra });
const ausencia = extra => ({ funcionarioId: 'f', adminId: 'a', tipo: 'ferias', status: 'aprovado', dataInicio: hoje, dataFim: hoje, ...extra });

test('approved holidays and medical leave explain inactivity on both interval boundaries', () => {
  for (const status of ['aprovado', 'aprovado_ped']) for (const tipo of ['ferias', 'baixa']) {
    const { dados, estado } = setup();
    dados.pedidos = [ausencia({ status, dataInicio: '2026-10-20', dataFim: hoje, ...(tipo === 'baixa' ? {tipo:'falta', classificacaoFalta:'baixa'} : {}) })];
    assert.equal(estado().label, tipo === 'ferias' ? 'De férias até dia 21/10/2026' : 'De baixa médica até dia 21/10/2026');
    assert.equal(estado().ativo, false);
    dados.pedidos[0].dataInicio = hoje; dados.pedidos[0].dataFim = '2026-10-22';
    assert.equal(estado().ausente, true);
  }
});
test('pending, rejected, unrelated and out-of-range requests do not report an absence', () => {
  for (const extra of [{status:'pendente_aprov'}, {status:'rejeitado'}, {funcionarioId:'other'}, {dataInicio:'2026-10-22',dataFim:'2026-10-23'}, {dataInicio:'2026-10-19',dataFim:'2026-10-20'}, {tipo:'falta',classificacaoFalta:'injustificada'}]) {
    const { dados, estado } = setup(); dados.pedidos = [ausencia(extra)];
    assert.equal(estado().label, 'Ainda não começou');
  }
});
test('actual open attendance takes priority over a recorded absence', () => {
  for (const rows of [[geral('08:00', '')], [geral('08:00', '', {servicoId:'os'})]]) {
    const { dados, estado } = setup(rows); dados.pedidos = [ausencia()];
    assert.equal(estado().ativo, true);
    assert(!estado().ausente);
  }
});
test('scoped presence reads the supplied requests and never falls back to another tenant', () => {
  const dados = {pedidos:[ausencia()]};
  const ctx = vm.createContext({dados,obterNomeCliente:()=>''});
  vm.runInContext(fn('_funcionarioAusenteEm') + '\n' + fn('_estadoPresencaPessoa'), ctx);
  assert.equal(ctx._estadoPresencaPessoa('f',hoje,{pedidos:[]}).label,'Ainda não começou');
  assert.equal(ctx._estadoPresencaPessoa('f',hoje,{pedidos:[ausencia({tipo:'falta',classificacaoFalta:'baixa'})]}).label,'De baixa médica até dia 21/10/2026');
});
test('approved absences appear in the admin panel without a missing clock-in alert', () => {
  const dados = {administradores:[{id:'a'}],funcionarios:[{id:'f',adminId:'a',nome:'Ana'}],pedidos:[ausencia()]};
  class Afternoon extends Date { constructor(...args) { super(...(args.length ? args : [hoje+'T15:00:00'])); } }
  const ctx = vm.createContext({dados,Date:Afternoon,obterNomeCliente:()=>'',pontoAssiduidadeAtivo:()=>true,escapeHtmlSimples:s=>s});
  vm.runInContext(['_funcionarioAusenteEm','_estadoPresencaPessoa','_htmlPainelAdminHoje'].map(fn).join('\n'),ctx);
  const html = ctx._htmlPainelAdminHoje('a',hoje);
  assert.match(html,/De férias/);
  assert.doesNotMatch(html,/ainda não picou|Ainda não começou/);
  dados.pedidos=[];
  assert.match(ctx._htmlPainelAdminHoje('a',hoje),/ainda não picou/);
});

test('closed OS after lunch does not leave the person in service', () => {
  const { estado } = setup([geral('08:00', '12:00'), geral('13:00', '17:00', { servicoId: 'os' })]);
  assert.equal(estado().label, 'Terminou o dia');
  assert.equal(estado().ativo, false);
});
test('closed worksite after lunch does not leave the person in service', () => {
  const { estado } = setup([geral('08:00', '12:00')], [geral('13:00', '17:00', { obraId: 'obra' })]);
  assert.equal(estado().ativo, false);
});
test('latest general entry determines status regardless of storage order', () => {
  for (const reverse of [false, true]) {
    const rows = [geral('08:00', ''), geral('13:00', '17:00')];
    const { estado } = setup(reverse ? rows.reverse() : rows);
    assert.equal(estado().label, 'Terminou o dia');
    assert.equal(estado().ativo, false);
  }
  assert.equal(setup([geral('08:00', '12:00'), geral('13:00', '')]).estado().ativo, true);
});
test('open OS and worksite remain active after general lunch exit', () => {
  const rows = [geral('08:00', '12:00')];
  const os = setup([...rows, geral('13:00', '', { servicoId: 'os' })]).estado();
  assert.equal(os.label, 'Em OS — Cliente teste');
  assert.equal(os.ativo, true);
  const obra = setup(rows, [geral('13:00', '', { obraId: 'obra' })]).estado();
  assert.equal(obra.label, 'Em Obra — Obra teste');
  assert.equal(obra.ativo, true);
});
test('other people and dates do not affect presence', () => {
  const { estado } = setup([geral('08:00', '', { funcionarioId: 'other' }), geral('08:00', '', { data: '2026-10-20' })]);
  assert.equal(estado().label, 'Ainda não começou');
  assert.equal(estado().ativo, false);
});
test('rendering repeatedly preserves records, hours and ordering', () => {
  const { dados, estado } = setup([geral('08:00', '12:00'), geral('13:00', '17:00')]);
  const before = JSON.stringify(dados);
  for (let i = 0; i < 10; i++) estado();
  assert.equal(JSON.stringify(dados), before);
});
test('both dashboard panels consume the same presence result', () => {
  const calls = [...src.matchAll(/const estadoPessoa = p => ([^;]+);/g)];
  assert.equal(calls.length, 2);
  for (const [, expression] of calls) {
    const { dados } = setup([geral('08:00', '12:00'), geral('13:00', '17:00', { servicoId: 'os' })]);
    const ctx = vm.createContext({ dados, obterNomeCliente: () => 'Cliente teste', hoje, p: { id: 'f' } });
    vm.runInContext(fn('_funcionarioAusenteEm') + '\n' + fn('_estadoPresencaPessoa'), ctx);
    const state = vm.runInContext(expression, ctx);
    assert.equal(state.label, 'Terminou o dia');
    assert.equal(state.ativo, false);
  }
});
test('Admin sheet linked through OS counts once in worksite hours', () => {
  const ctx = vm.createContext({
    dados: {
      servicos: [{ id: 'os', obraId: 'obra' }],
      folhasObra: [{ funcionarioId: 'admin', servicoId: 'os', obraId: 'obra', descricao: 'Trabalho', horasTrabalhadas: 4 }],
      ponto: [{ funcionarioId: 'admin', servicoId: 'os', entrada: '08:00', saida: '12:00' }],
      obraPontoLonga: [{ funcionarioId: 'admin', obraId: 'obra', entrada: '08:00', saida: '12:00' }]
    },
    calcularHoras: (a, b) => { const h = t => Number(t.slice(0, 2)) + Number(t.slice(3)) / 60; return h(b) - h(a); }
  });
  vm.runInContext(fn('_horasObraPorFuncionario') + '\n' + fn('_horasContabilizadasObraPorPessoa') + '\n' + fn('totalHorasObra'), ctx);
  assert.equal(ctx.totalHorasObra('obra'), 4);
  delete ctx.dados.folhasObra[0].obraId;
  assert.equal(ctx.totalHorasObra('obra'), 4);
});
