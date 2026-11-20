const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {JSDOM}=require('jsdom');
const src=fs.readFileSync('app-principal.js','utf8');
const materials=['_movimentosConsumoPorOS','_saldosPlanoOS'].map(name=>src.slice(src.indexOf('        function '+name+'(')).split('\n        }')[0]+'\n        }').join('\n');
const helpers=materials+src.slice(src.indexOf('        function _acaoPendenciasAlerta('),src.indexOf('        // ==================== ARMAZÉM / STOCK',src.indexOf('        function _acaoPendenciasAlerta(')));
const browserTest=fs.readFileSync('tests/alert-destinations-browser.cjs','utf8');
const fixture=browserTest.split('await page.addScriptTag({content:`')[1].split('`+helpers')[0];
function setup(){const dom=new JSDOM('<div id="alertasPendencias"></div>',{runScripts:'dangerously'});dom.window.eval(fixture+src.match(/        function _osComRelatoriosPorTerminar\([^]*?\n        \}/)[0]+helpers);return dom.window;}
const json=x=>JSON.parse(JSON.stringify(x));
test('clicking a grouped pending alert includes exactly those OS and opens the chosen OS',()=>{
 const w=setup();w.renderizarAlertas();w.document.querySelector('.alerta-linha').click();
 const buttons=w.document.querySelectorAll('#tgPendenciasOverlay button');assert.equal(buttons.length,3);
 assert.match(buttons[1].textContent,/OS um/);assert.match(buttons[2].textContent,/OS dois/);
 buttons[2].click();assert.deepEqual(json(w.calls),[['os','two']]);assert(!w.document.getElementById('tgPendenciasOverlay'));w.close();
});
test('a single OS opens directly and old/missing/foreign IDs never open another record',()=>{
 const w=setup();w._abrirPendenciasAlerta('servico',['one']);assert.deepEqual(json(w.calls),[['os','one']]);
 for(const user of [{role:'admin',id:'tenant'},{role:'subadmin',id:'sub',adminId:'tenant'},{role:'funcionario',id:'f',adminId:'tenant'}]){
  w.usuarioLogado=user;w.calls=[];w._abrirPendenciasAlerta('servico',['foreign','missing']);assert.equal(w.calls[0][0],'erro');
 }
 w.close();
});
test('opening a request is read-only and approval applies only to the selected request',()=>{
 const w=setup();w.dados.pedidos=[{id:'p',adminId:'tenant',tipo:'ferias',funcionarioId:'f',dataInicio:'2026-11-01',dataFim:'2026-11-02',status:'pendente_aprov'}];
 w._abrirPendenciasAlerta('pedido',['p']);assert.deepEqual(json(w.calls),[]);
 [...w.document.querySelectorAll('#tgPendenciasOverlay button')].find(b=>b.textContent==='Aprovar').click();
 assert.deepEqual(json(w.calls),[['aprovar','p']]);w.close();
});
test('portal assistance shows that request without creating an OS merely by opening it',()=>{
 const w=setup();w.dados.assistencias=[{id:'a',adminId:'tenant',assunto:'Alarme',descricao:'Verificar sensor'}];
 w._abrirPendenciasAlerta('assistencia',['a']);assert.deepEqual(json(w.calls),[]);
 assert.match(w.document.getElementById('tgPendenciasOverlay').textContent,/Verificar sensor/);w.close();
});
test('mobile accordion and keyboard activation lead to the same filtered group; Escape closes it',()=>{
 const w=setup();w.mobile=true;w.renderizarAlertas();w.document.querySelector('.alertas-h').click();
 assert(w.document.querySelector('.alertas-card').classList.contains('aberto'));
 w.document.querySelector('.alerta-linha').dispatchEvent(new w.KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
 const overlay=w.document.getElementById('tgPendenciasOverlay');assert(overlay);
 overlay.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));assert(!w.document.getElementById('tgPendenciasOverlay'));w.close();
});
test('draft report alert survives OS completion, opens that OS reports, then disappears after completion',()=>{
 const w=setup();w._tiposEspecialidadePendentes=()=>[];w._verOsMostrar=(id,tab)=>w.calls.push(['tab',id,tab]);
 const os=w.dados.servicos.find(s=>s.id==='one');os.status='concluído';w.dados.relatoriosEspecialidade=[{id:'r',adminId:'tenant',servicoId:'one',tipo:'RIN',rascunho:true}];
 w.renderizarAlertas();const alert=[...w.document.querySelectorAll('.alerta-linha')].find(a=>a.textContent.includes('relatórios por terminar'));assert(alert);alert.click();assert.deepEqual(json(w.calls),[['os','one'],['tab','one','relatorios']]);
 w.dados.relatoriosEspecialidade[0].rascunho=false;w.renderizarAlertas();assert(!w.document.getElementById('alertasPendencias').textContent.includes('relatórios por terminar'));assert.equal(os.status,'concluído');w.close();
});

test('OS material alerts use recorded direct and sheet consumption, and open Materials',()=>{
 const w=setup();
 try {
  w._verOsMostrar=(id,tab)=>w.calls.push(['tab',id,tab]);
  const [one,two,done,foreign]=w.dados.servicos;
  const plan=(artigoId,qtdPrevista)=>({artigoId,qtdPrevista});
  one.materiaisPlano=[plan('cable',5)];
  two.obraId='shared';
  done.materiaisPlano=[plan('cable',0.3)];
  w.dados.obraMateriais=[{...plan('cable',10),obraId:'shared',adminId:'tenant',qtdConsumida:11}];
  w.dados.folhasObra=[{id:'sheet',servicoId:one.id,adminId:'tenant'}];
  const use=(id,origemId,artigoId,quantidade,origemTipo='os',adminId='tenant')=>(
   {id,adminId,origemId,artigoId,quantidade,origemTipo,tipo:'saida'}
  );
  const sheet=use('s','sheet','cable',3,'folha');
  w.dados.movimentosStock=[
   use('a',one.id,'cable',2),sheet,sheet,use('b',one.id,'plug',1),
   use('c',two.id,'cable',1),use('d',done.id,'cable',0.1),use('e',done.id,'cable',0.2),
   use('f',foreign.id,'plug',1,'os','other'),use('g',one.id,'foreign',1,'os','other')
  ];
  const alertFor=text=>[...w.document.querySelectorAll('.alerta-linha')].find(row=>row.textContent.includes(text));
  w.renderizarAlertas();
  alertFor('1 OS com materiais não previstos').click();
  alertFor('1 OS com excedente de materiais').click();
  assert.deepEqual(json(w.calls),[['os','one'],['tab','one','materiais'],['os','two'],['tab','two','materiais']]);
  one.materiaisPlano.push(plan('plug',1));
  w.dados.obraMateriais[0].qtdPrevista=11;
  w.renderizarAlertas();
  assert(!alertFor('com materiais não previstos'));
  assert(!alertFor('com excedente de materiais'));
 } finally { w.close(); }
});
