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

test('OS associada à Obra consulta plano sem criar movimentos', () => {
  const dom = new JSDOM('<div id="modalCampos"><div class="ff-wrap"></div></div>');
  try {
    const parent = dom.window.document.querySelector('#modalCampos');
    const data={
      obraId:'o1',adminId:'a',
      obraMateriais:[{adminId:'a',obraId:'o1',artigoId:'a1',qtdPrevista:8,qtdConsumida:3}],
      artigos:[{adminId:'a',id:'a1',nome:'Câmara',referencia:'CAM',unidade:'un.'}]
    };
    assert.equal(m.atualizarPainelOS(parent,data),true);
    assert.match(parent.textContent,/Materiais da obra associada/);
    assert.match(parent.textContent,/Falta consumir: 5 un\./);
    assert.equal(parent.querySelectorAll('.ff-wrap > .ff-secao').length,0);
    assert.equal(data.obraMateriais[0].qtdConsumida,3);
  } finally {dom.window.close();}
});
test('não inventa plano para OS sem Obra associada',()=>{
  const dom=new JSDOM('<div id="root"></div>');
  try {
    assert.equal(m.atualizarPainelOS(dom.window.document.querySelector('#root'),{obraId:null}),false);
    assert.equal(dom.window.document.querySelector('#tg-materiais-saldo-os'),null);
  } finally {dom.window.close();}
});
test('edição da OS está ligada à consulta de materiais da Obra',()=>{
  const js=fs.readFileSync('app-principal.js','utf8');
  assert.match(js,/entidade === 'servico' && item\?\.obraId && window\.TGMateriaisPartilhados/);
  assert.match(js,/TGMateriaisPartilhados\.atualizarPainelOS/);
});
