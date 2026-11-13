const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),{JSDOM}=require('jsdom');
const source=fs.readFileSync('tg-technician.js','utf8');
const main=fs.readFileSync('app-principal.js','utf8');
const native=name=>main.match(new RegExp('        (?:async )?function '+name+'\\([^]*?\\n        \\}'))[0];
function setup(){
 const w=new JSDOM('<div id="cardsGrid"><div id="omeudia"></div><div class="card-principal" data-card="servicos"></div><div class="card-principal" data-card="obras-longa"></div></div><nav id="menuInferiorMobile"></nav><div id="painelGrupoMobile"><div id="painelGrupoMobileConteudo"></div></div>',{url:'https://example.invalid',runScripts:'outside-only',pretendToBeVisual:true}).window;
 w.usuarioLogado={id:'e',adminId:'a',role:'funcionario',nome:'Técnico de exemplo'};
 w.dados={administradores:[{id:'a'}],funcionarios:[{id:'e',adminId:'a',nome:'Técnico de exemplo'}],clientes:[{id:'c',adminId:'a',nome:'Cliente de demonstração'}],servicos:[{id:'os',adminId:'a',clienteId:'c',funcionariosIds:['e'],data:'2026-11-06',hora:'09:40',numeroRegisto:'125',descricao:'Manutenção',status:'pendente'}],ponto:[],obras:[{id:'obra',adminId:'a',responsaveisIds:['e'],nome:'Obra de demonstração',estado:'ativa'}],obraPontoLonga:[]};
 Object.assign(w,{getDataHoje:()=> '2026-11-06',expressAtivo:()=>false,adminDoUtilizador:()=>({id:'a'}),_licencaValidaTenant:()=>true,pontoAssiduidadeAtivo:()=>false,_pausaAlmocoPendente:()=>null,_montarMenuInferiorMobile(){},_mostrarInicioConteudo(){},_fecharSecaoAbertaMobile(){},scrollTo(){},escapeHtmlSimples:s=>String(s),_tenantId:()=>w.usuarioLogado.adminId,_gpsPontoAtivo:()=>false,_osConcluidaParaFuncionario:()=>false,gerarId:()=> 'p'+(w.dados.ponto.length+1),_checklistEntradaVerificar:(a,fn)=>fn(),abrirSliderConfirmacao:(title,label,fn)=>{w.confirmEntry=fn;},renderizarTudo(){},alert(){},mostrarToast(text,type){w.toasts.push({text,type});}});
 w._snap={ponto:new Map(),servicos:new Map()};w.toasts=[];
 w.saveCalls=0;w.savePromise=new Promise((resolve,reject)=>{w.resolveSave=resolve;w.rejectSave=reject;});w.guardarDados=()=>{w.saveCalls++;return w.savePromise;};
 w.intervals=[];w.setInterval=fn=>{w.intervals.push(fn);return w.intervals.length;};
 w.eval(['_inicioTempoServico','_formatarTempoServico','_tempoServicoHTML','_entradaOSPendenteSincronizacao','picarPontoOS'].map(native).join('\n'));
 w.eval(source);return w;
}
function enter(w){w.dados.ponto.push({id:'p',adminId:'a',funcionarioId:'e',servicoId:'os',data:'2026-11-06',entrada:'09:40:00',saida:null});w.dados.servicos[0].status='em andamento';}
function live(w){assert(w.document.querySelector('[data-tgt-action=exit]'));assert.equal(w.document.querySelector('[data-tgt-action=start]'),null);assert.match(w.document.querySelector('.tgt-job-state').textContent,/Em curso/);assert(w.document.querySelector('[data-tempo-servico]'));}
test('real OS entry updates employee immediately without the bulk render event or waiting for sync',async()=>{
 const w=setup();try{
  assert(w.document.querySelector('[data-tgt-action=start]'));await w.picarPontoOS('os','entrada');assert.equal(w.dados.ponto.length,0);const confirmation=w.confirmEntry();live(w);assert.equal(w.saveCalls,1);assert.equal(w.dados.ponto.length,1);
  assert.match(w.document.querySelector('.tgt-focus-info').textContent,/A aguardar sincronização/);
  assert.equal(w.toasts.length,0);
  // A second action on the same OS cannot create another personal clock.
  await w.picarPontoOS('os','entrada');assert.equal(w.dados.ponto.length,1);
  const [point]=w.dados.ponto;
  w._snap.ponto.set(point.id,'{}');
  assert.equal(w._entradaOSPendenteSincronizacao(w.dados.servicos[0],point),true);
  w._snap.servicos.set('os',JSON.stringify({status:'em andamento'}));
  w.resolveSave();await confirmation;live(w);
  assert.doesNotMatch(w.document.querySelector('.tgt-focus-info').textContent,/A aguardar sincronização/);
  assert.equal(w.toasts.at(-1).type,'sucesso');
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
 const w=setup();try{w.dados.ponto=[{id:'other',adminId:'a',funcionarioId:'other',servicoId:'os',data:'2026-11-06',entrada:'09:40'},{id:'foreign',adminId:'b',funcionarioId:'e',servicoId:'os',data:'2026-11-06',entrada:'09:40'}];w.intervals.forEach(fn=>fn());assert(w.document.querySelector('[data-tgt-action=start]'));w.document.body.insertAdjacentHTML('beforeend','<form><textarea id="draft">Trabalho por terminar</textarea></form>');const draft=w.document.getElementById('draft');w.document.querySelector('[data-tgt-nav=works]').click();w.dados.obraPontoLonga=[{id:'work-clock',adminId:'a',funcionarioId:'e',obraId:'obra',data:'2026-11-06',entrada:'09:40',saida:null}];w.intervals.forEach(fn=>fn());const activeWork=w.document.querySelector('#painelGrupoMobileConteudo [data-tgt-action=pause][data-tgt-kind=obra]');assert(activeWork,'A obra ativa deve mostrar Pausar obra');assert.match(activeWork.textContent,/Pausar obra/);assert(w.document.querySelector('#painelGrupoMobileConteudo [data-tempo-servico]'),'Contador pessoal da obra deve atualizar');assert.equal(w.document.getElementById('draft'),draft);assert.equal(draft.value,'Trabalho por terminar');assert.equal(w.saveCalls,0);}finally{w.close();}
});
test('both entry points and offline precache use the same employee refresh asset',()=>{
 const asset='tg-technician.js?v=1.11.4-work-photos';for(const path of ['index.html','login.html','sw.js'])assert(fs.readFileSync(path,'utf8').includes(asset),path);const sw=fs.readFileSync('sw.js','utf8');assert.match(sw,/const CACHE = 'totalgest-release-20261113-os-exit-grid-native-pause'/);
});


test('lunch return keeps the local clock and indicates pending sync on offline or failed saves',async()=>{
 for(const failed of [false,true]){
  const w=setup();try{
   w._pausaAlmocoPendente=()=>({tipo:'os',servicoId:'os'});
   w.dados.servicos[0].status='pausa para almoço';
   await w.picarPontoOS('os','entrada');
   const confirmation=w.confirmEntry();
   if(failed){
    w._snap.ponto.set(w.dados.ponto[0].id,'{}');
    w.rejectSave(Error('Falha ao gravar o estado da OS'));
   } else w.resolveSave();
   await confirmation;live(w);
   assert.match(w.document.querySelector('.tgt-focus-info').textContent,/A aguardar sincronização/);
   assert.equal(w.toasts.at(-1).type,'aviso');
   assert.equal(w.dados.ponto.length,1);
  }finally{w.close();}
 }
});

test('an unconfirmed general clock from the same return also keeps the entry pending',()=>{
 const w=setup();try{
  enter(w);
  const os=w.dados.servicos[0], point=w.dados.ponto[0];
  const geral={...point,id:'geral',servicoId:null};
  w.dados.ponto.push(geral);
  w._snap.ponto.set(point.id,'{}');
  w._snap.servicos.set('os',JSON.stringify({status:'em andamento'}));
  assert(w._entradaOSPendenteSincronizacao(os,point));
  w._snap.ponto.set(geral.id,'{}');
  assert(!w._entradaOSPendenteSincronizacao(os,point));
 }finally{w.close();}
});
