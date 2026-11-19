const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');
const m = require('../tg-materiais-partilhados.js');

test('painel de Obra preserva isolamento por empresa e apresenta saldos', () => {
  const dom = new JSDOM('<div id="modalGenericoCampos"><p>Existente</p></div>');
  try {
    const root = dom.window.document.querySelector('#modalGenericoCampos');
    assert.equal(m.atualizarPainelObra(root,{
      obraId:'o1',adminId:'a',
      artigos:[{id:'c1',adminId:'a',nome:'Cabo Cat6',referencia:'C6',unidade:'m'}],
      obraMateriais:[{adminId:'a',obraId:'o1',artigoId:'c1',qtdPrevista:10,qtdConsumida:4},
        {adminId:'b',obraId:'o1',artigoId:'foreign',qtdPrevista:25,qtdConsumida:0}]
    }),true);
    assert.match(root.textContent,/Previsto: 10 m/);
    assert.match(root.textContent,/Consumido: 4 m/);
    assert.match(root.textContent,/Falta consumir: 6 m/);
    assert.equal(root.querySelectorAll('.tg-material-item').length,1);
    assert.match(root.textContent,/Existente/);
  } finally { dom.window.close(); }
});
test('painel atualiza sem criar secções duplicadas', () => {
  const dom = new JSDOM('<div id="m"></div>');
  try {
    const root = dom.window.document.querySelector('#m');
    const ctx = {obraId:'o1',adminId:'a',artigos:[],obraMateriais:[]};
    m.atualizarPainelObra(root,ctx);
    m.atualizarPainelObra(root,ctx);
    assert.equal(root.querySelectorAll('#tg-materiais-saldo-obra').length,1);
  } finally { dom.window.close(); }
});
test('módulo está carregado antes do app e dentro do modal das Obras', () => {
  const html=fs.readFileSync('index.html','utf8');
  const js=fs.readFileSync('app-principal.js','utf8');
  assert(html.indexOf('tg-materiais-partilhados.js')>=0);
  assert(html.indexOf('tg-materiais-partilhados.js')<html.indexOf('app-principal.js'));
  const start=js.indexOf('function abrirPlanoMateriais(');
  const end=js.indexOf('function omAddItem(',start);
  assert(start>0 && end>start);
  const body=js.slice(start,end);
  assert.match(body,/TGMateriaisPartilhados\.atualizarPainelObra/);
  assert.match(body,/salvarPlanoMateriais/);
});
