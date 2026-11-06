const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),{JSDOM}=require('jsdom');
const source=fs.readFileSync('tg-technician.js','utf8');
const main=fs.readFileSync('app-principal.js','utf8');
const native=name=>main.match(new RegExp('        (?:async )?function '+name+'\\([^]*?\\n        \\}'))[0];
function setup(){
 const w=new JSDOM('<div id="cardsGrid"><div id="omeudia"></div><div class="card-principal" data-card="servicos"></div><div class="card-principal" data-card="obras-longa"></div></div><nav id="menuInferiorMobile"></nav><div id="painelGrupoMobile"><div id="painelGrupoMobileConteudo"></div></div>',{url:'https://example.invalid',runScripts:'outside-only',pretendToBeVisual:true}).window;
 w.usuarioLogado={id:'e',adminId:'a',role:'funcionario',nome:'Técnico de exemplo'};
 w.dados={administradores:[{id:'a'}],funcionarios:[{id:'e',adminId:'a',nome:'Técnico de exemplo'}],clientes:[{id:'c',adminId:'a',nome:'Cliente de demonstração'}],servicos:[{id:'os',adminId:'a',clienteId:'c',funcionariosIds:['e'],data:'2026-11-06',hora:'09:40',numeroRegisto:'125',descricao:'Manutenção',status:'pendente'}],ponto:[],obras:[{id:'obra',adminId:'a',responsaveisIds:['e'],nome:'Obra de demonstração',estado:'ativa'}],obraPontoLonga:[]};
 Object.assign(w,{getDataHoje:()=> '2026-11-06',expressAtivo:()=>false,adminDoUtilizador:()=>({id:'a'}),_licencaValidaTenant:()=>true,pontoAssiduidadeAtivo:()=>false,_pausaAlmocoPendente:()=>null,_montarMenuInferiorMobile(){},_mostrarInicioConteudo(){},_fecharSecaoAbertaMobile(){},scrollTo(){},escapeHtmlSimples:s=>String(s),_tenantId:()=>w.usuarioLogado.adminId,_gpsPontoAtivo:()=>false,_osConcluidaParaFuncionario:()=>false,gerarId:()=> 'p'+(w.dados.ponto.length+1),_checklistEntradaVerificar:(a,fn)=>fn(),abrirSliderConfirmacao:(title,label,fn)=>{w.confirmEntry=fn;},renderizarTudo(){},alert(){}});
 w.saveCalls=0;w.savePromise=new Promise((resolve,reject)=>{w.resolveSave=resolve;w.rejectSave=reject;});w.guardarDados=()=>{w.saveCalls++;return w.savePromise;};
 w.intervals=[];w.setInterval=fn=>{w.intervals.push(fn);return w.intervals.length;};
 w.eval(['_inicioTempoServico','_formatarTempoServico','_tempoServicoHTML','picarPontoOS'].map(native).join('\n'));
 w.eval(source);return w;
}
function enter(w){w.dados.ponto.push({id:'p',adminId:'a',funcionarioId:'e',servicoId:'os',data:'2026-11-06',entrada:'09:40:00',saida:null});w.dados.servicos[0].status='em andamento';}
function live(w){assert(w.document.querySelector('[data-tgt-action=exit]'));assert.equal(w.document.querySelector('[data-tgt-action=start]'),null);assert.match(w.document.querySelector('.tgt-job-state').textContent,/Em curso/);assert(w.document.querySelector('[data-tempo-servico]'));}
test('real OS entry updates employee immediately without the bulk render event or waiting for sync',async()=>{
 const w=setup();try{
  assert(w.document.querySelector('[data-tgt-action=start]'));await w.picarPontoOS('os','entrada');assert.equal(w.dados.ponto.length,0);w.confirmEntry();live(w);assert.equal(w.saveCalls,1);assert.equal(w.dados.ponto.length,1);
  // A second action on the same OS cannot create another personal clock.
  await w.picarPontoOS('os','entrada');assert.equal(w.dados.ponto.length,1);
  w.resolveSave();await Promise.resolve();live(w);
 }finally{w.close();}
});
test('save wrapper preserves promise identity and a failure keeps the local clock visible for native retry',async()=>{
 const w=setup();try{enter(w);const result=w.guardarDados();assert.equal(result,w.savePromise);live(w);const failure=assert.rejects(result,/Sem rede/);w.rejectSave(Error('Sem rede'));await failure;live(w);assert.equal(w.saveCalls,1);assert.equal(w.dados.ponto.length,1);}finally{w.close();}
});
test('a missed update recovers from local data on focus, foreground or the lightweight watcher',()=>{
 for(const trigger of ['focus','foreground','watcher']){const w=setup();try{enter(w);assert(w.document.querySelector('[data-tgt-action=start]'));if(trigger==='focus')w.dispatchEvent(new w.Event('focus'));if(trigger==='foreground')w.document.dispatchEvent(new w.Event('visibilitychange'));if(trigger==='watcher')w.intervals.forEach(fn=>fn());live(w);assert.equal(w.saveCalls,0);assert.equal(w.dados.ponto.length,1);
  const node=w.document.querySelector('.tgt-home');w.intervals.forEach(fn=>fn());w.intervals.forEach(fn=>fn());assert.equal(w.document.querySelector('.tgt-home'),node);
 }finally{w.close();}}
});
test('home cache recovers replaced markup and completion removes the entry counter without a new login',()=>{
 const w=setup();try{enter(w);w.TGTechnician.refresh();const host=w.document.getElementById('omeudia');host.innerHTML='<p>Ecrã antigo</p>';w.TGTechnician.refresh();live(w);w.dados.ponto[0].saida='10:10:00';w.dados.servicos[0].status='concluído';w.intervals.forEach(fn=>fn());assert.equal(w.document.querySelector('[data-tgt-action=exit]'),null);assert.equal(w.document.querySelector('[data-tempo-servico]'),null);assert.match(w.document.querySelector('.tgt-job-state').textContent,/Concluído/);}finally{w.close();}
});
test('watcher ignores other people and tenants, and refreshes work clocks without changing an open form',()=>{
 const w=setup();try{w.dados.ponto=[{id:'other',adminId:'a',funcionarioId:'other',servicoId:'os',data:'2026-11-06',entrada:'09:40'},{id:'foreign',adminId:'b',funcionarioId:'e',servicoId:'os',data:'2026-11-06',entrada:'09:40'}];w.intervals.forEach(fn=>fn());assert(w.document.querySelector('[data-tgt-action=start]'));w.document.body.insertAdjacentHTML('beforeend','<form><textarea id="draft">Trabalho por terminar</textarea></form>');const draft=w.document.getElementById('draft');w.document.querySelector('[data-tgt-nav=works]').click();w.dados.obraPontoLonga=[{id:'work-clock',adminId:'a',funcionarioId:'e',obraId:'obra',data:'2026-11-06',entrada:'09:40',saida:null}];w.intervals.forEach(fn=>fn());assert(w.document.querySelector('#painelGrupoMobileConteudo [data-tgt-action=exit]'));assert.equal(w.document.getElementById('draft'),draft);assert.equal(draft.value,'Trabalho por terminar');assert.equal(w.saveCalls,0);}finally{w.close();}
});
test('both entry points and offline precache use the same employee refresh asset',()=>{
 const asset='tg-technician.js?v=1.10.0-clock-refresh';for(const path of ['index.html','login.html','sw.js'])assert(fs.readFileSync(path,'utf8').includes(asset),path);
});
