const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('app-principal.js', 'utf8');
const sections = [
  ['ponto', '            ponto: {', '            pedidos: {'],
  ['obraPontoLonga', '            obraPontoLonga: {', '            autosMedicao: {']
];
function mapFunctions(start, end) {
  const a = source.indexOf(start), b = source.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, 'Mapper present');
  const section = source.slice(a, b);
  const f = 'from: r => (', t = 'to:   o => (';
  const fi = section.indexOf(f), ti = section.indexOf(t);
  assert.ok(fi >= 0 && ti > fi, 'Both mapper directions present');
  const from = section.slice(fi + f.length, section.indexOf('),\n                to:', fi));
  const to = section.slice(ti + t.length, section.lastIndexOf(')\n            }'));
  const read = new Function('r','hhmm','isoToMs','return ('+from+')');
  const write = new Function('o','nn','msToISO','return ('+to+')');
  return {
    read: r => read(r, x => x, x => x),
    write: o => write(o, x => x, x => x)
  };
}
for (const [key, start, end] of sections) {
  test(key + ' persists pause reason and does not turn it into lunch', () => {
    const mapper = mapFunctions(start, end);
    const original = {
      id: 'test-clock-1', adminId: 'test-tenant', funcionarioId: 'test-user',
      data: '2026-11-12', entrada: '09:00:00', saida: '09:30:00',
      servicoId: key === 'ponto' ? 'test-os' : undefined,
      obraId: key === 'obraPontoLonga' ? 'test-work' : undefined,
      motivoSaida: 'pausa', pausaAlmoco: false
    };
    const stored = mapper.write(original);
    assert.equal(stored.motivo_saida, 'pausa');
    assert.equal(stored.pausa_almoco, false);
    const restored = mapper.read(stored);
    assert.equal(restored.motivoSaida, 'pausa');
    assert.equal(restored.pausaAlmoco, false);
    assert.equal(restored.entrada, original.entrada);
    assert.equal(restored.saida, original.saida);
  });
}
