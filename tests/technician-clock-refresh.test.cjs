const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),{JSDOM}=require('jsdom');
const source=fs.readFileSync('tg-technician.js','utf8');
const main=fs.readFileSync('app-principal.js','utf8');
const native=name=>main.match(new RegExp('        (?:async )?function '+name+'\\([^]*?\\n        \\}'))[0];
function setup({attendance=false}={}){
 const exitModal=fs.readFileSync('index.html','utf8').match(/<div class="modal-overlay" id="modalSimNaoOverlay"[^]*?(?=    <div class="modal-overlay" id="modalScannerQROverlay")/)[0];
 const w=new JSDOM('<div id="cardsGrid"><div id="omeudia"></div><div class="card-principal" data-card="servicos"></div><div class="card-principal" data-card="obras-longa"></div></div><nav id="menuInferiorMobile"></nav><div id="painelGrupoMobile"><div id="painelGrupoMobileConteudo"></div></div>'+exitModal,{url:'https://example.invalid',runScripts:'outside-only',pretendToBeVisual:true}).window;
 w.usuarioLogado={id:'e',adminId:'a',role:'funcionario',nome:'Técnico de exemplo'};
 w.dados={administradores:[{id:'a'}],funcionarios:[{id:'e',adminId:'a',nome:'Técnico de exemplo'}],clientes:[{id:'c',adminId:'a',nome:'Cliente de demonstração'}],servicos:[{id:'os',adminId:'a',clienteId:'c',funcionariosIds:['e'],data:'2026-11-06',hora:'09:40',numeroRegisto:'125',descricao:'Manutenção',status:'pendente'}],ponto:[],obras:[{id:'obra',adminId:'a',responsaveisIds:['e'],nome:'Obra de demonstração',estado:'ativa'}],obraPontoLonga:[]};
 Object.assign(w,{getDataHoje:()=> '2026-11-06',expressAtivo:()=>false,adminDoUtilizador:()=>({id:'a'}),_licencaValidaTenant:()=>true,pontoAssiduidadeAtivo:()=>attendance,_pausaAlmocoPendente:()=>null,_montarMenuInferiorMobile(){},_mostrarInicioConteudo(){},_fecharSecaoAbertaMobile(){},scrollTo(){},escapeHtmlSimples:s=>String(s),_tenantId:()=>w.usuarioLogado.adminId,_gpsPontoAtivo:()=>false,_osConcluidaParaFuncionario:()=>false,gerarId:()=> 'p'+(w.dados.ponto.length+1),_checklistEntradaVerificar:(a,fn)=>fn(),abrirSliderConfirmacao:(title,label,fn)=>{w.confirmEntry=fn;},renderizarTudo(){},alert(){},mostrarToast(text,type){w.toasts.push({text,type});}});
 w._snap={ponto:new Map(),servicos:new Map()};w.toasts=[];
 w.saveCalls=0;w.savePromise=new Promise((resolve,reject)=>{w.resolveSave=resolve;w.rejectSave=reject;});w.guardarDados=()=>{w.saveCalls++;return w.savePromise;};
 w.intervals=[];w.setInterval=fn=>{w.intervals.push(fn);return w.intervals.length;};
 w.eval('var _modalSimNaoResolve = null, _picandoEntradaObraLonga = false;');
 w.eval(['_obraLongaPontoAberto','_obraLongaPontoAbertoQualquer','obraLongaPicarEntrada','obraLongaPicarSaida','_intervalosSaidaObra','_pedirSaidaObraAnterior','_obraLongaRegistarSaida','perguntarSaidaObra','_modalSimNaoResponder','_inicioTempoServico','_formatarTempoServico','_tempoServicoHTML','_entradaOSPendenteSincronizacao','picarPontoOS'].map(native).join('\n'));
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
 const w=setup();try{w.dados.ponto=[{id:'other',adminId:'a',funcionarioId:'other',servicoId:'os',data:'2026-11-06',entrada:'09:40'},{id:'foreign',adminId:'b',funcionarioId:'e',servicoId:'os',data:'2026-11-06',entrada:'09:40'}];w.intervals.forEach(fn=>fn());assert(w.document.querySelector('[data-tgt-action=start]'));w.document.body.insertAdjacentHTML('beforeend','<form><textarea id="draft">Trabalho por terminar</textarea></form>');const draft=w.document.getElementById('draft');w.document.querySelector('[data-tgt-nav=works]').click();w.dados.obraPontoLonga=[{id:'work-clock',adminId:'a',funcionarioId:'e',obraId:'obra',data:'2026-11-06',entrada:'09:40',saida:null}];w.intervals.forEach(fn=>fn());const activeWork=w.document.querySelector('#painelGrupoMobileConteudo [data-tgt-action=exit][data-tgt-kind=obra]');assert(activeWork,'A obra ativa deve mostrar Registar saída');assert.match(activeWork.textContent,/Registar saída/);assert(w.document.querySelector('#painelGrupoMobileConteudo [data-tempo-servico]'),'Contador pessoal da obra deve atualizar');assert.equal(w.document.getElementById('draft'),draft);assert.equal(draft.value,'Trabalho por terminar');assert.equal(w.saveCalls,0);}finally{w.close();}
});
test('entry from Obras ativas shows the full personal work card in Hoje and both screens use the native exit',async()=>{
 for (const [attendance, response] of [[true,'almoco'],[false,'hoje'],[true,true]]) {
  const w=setup({attendance});
  try {
   w.dados.servicos=[];
   const work=w.dados.obras[0];
   Object.assign(work,{clienteId:'c',morada:'Rua de teste',observacoes:'Montagem',localId:'local'});
   if(attendance)w.dados.ponto.push({id:'general',adminId:'a',funcionarioId:'e',data:w.getDataHoje(),entrada:'08:00'});
   w.TGPassport={scope:()=>true};
   w.eval(fs.readFileSync('tg-os-exit-grid.js','utf8'));
   w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
   Object.assign(w,{
    pontoAbertoHoje:()=>attendance,_tenantIdAtual:()=> 'a',
    _mostrarCarregando(){},_esconderCarregando(){},_refrescarModalObraLongaSeAberto(){},
    calcularHoras:()=>1,_osMapaInfo:()=>({url:'https://maps.example.invalid/'}),
    criarFolhaDaObra:(id,finished)=>{w.sheet={id,finished};}
   });
   w.resolveSave();
   const doc=w.document, find=selector=>doc.querySelector(selector);
   find('[data-tgt-nav=works]').click();
   find('[data-tgt-action=choose][data-tgt-kind=obra]').click();
   find('[data-tgt-action=start][data-tgt-kind=obra]').click();
   await w.confirmEntry();
   const worksCard=find('#painelGrupoMobileConteudo .tgt-focus');
   find('[data-tgt-nav=home]').click();
   const homeCard=find('#omeudia .tgt-focus');
   assert(homeCard);
   for(const label of ['Obra de demonstração','Cliente de demonstração','Rua de teste','Montagem','Entrada registada','Fotografias','Materiais','Passaporte','Ver obra','Navegar'])assert(homeCard.textContent.includes(label),label);
   assert(homeCard.querySelector('[data-tempo-servico]'));
   assert.equal(homeCard.querySelector('[data-tgt-action=exit]').textContent,worksCard.querySelector('[data-tgt-action=exit]').textContent);
   const overlay=find('#modalSimNaoOverlay'), pause=find('#modalSimNaoAlmocoBtn'), today=find('#modalSimNaoHojeBtn'), finish=find('#modalSimNaoSimTexto');
   homeCard.querySelector('[data-tgt-action=exit]').click();
   await new Promise(resolve=>setTimeout(resolve,0));
   assert(overlay.classList.contains('open'));
   assert(overlay.classList.contains('tg-os-exit-grid'));
   assert(overlay.hasAttribute('data-tgt-work-exit'));
   assert.equal(pause.hidden,!attendance);
   if(attendance){
    assert.match(pause.textContent,/Pausar obra/);
    assert(pause.querySelector('.fa-pause-circle'));
   }
   assert.match(today.textContent,/Finalizar por hoje/);
   assert(today.querySelector('.fa-calendar-check'));
   assert.equal(finish.textContent,'Finalizar obra');
   assert(finish.parentElement.querySelector('.fa-check-circle'));
   assert.equal(find('#modalSimNaoVisitaBtn').style.display,'none');
   assert.equal(w.dados.obraPontoLonga[0].saida,null);
   w._modalSimNaoResponder(null);
   await new Promise(resolve=>setTimeout(resolve,0));
   assert.equal(w.dados.obraPontoLonga[0].saida,null);
   assert.equal(w.saveCalls,1);
   assert(!overlay.hasAttribute('data-tgt-work-exit'));
   find('[data-tgt-nav=works]').click();
   find('#painelGrupoMobileConteudo [data-tgt-action=exit]').click();
   if(response==='almoco')pause.click();else w._modalSimNaoResponder(response);
   await new Promise(resolve=>setTimeout(resolve,0));
   const [point]=w.dados.obraPontoLonga;
   assert(point.saida);
   assert.equal(w.saveCalls,2);
   if(response==='almoco'){
    assert.equal(point.motivoSaida,'pausa');
    assert.equal(w.dados.ponto[0].saida,undefined);
    assert.equal(w.sheet,undefined);
    find('#painelGrupoMobileConteudo [data-tgt-action=choose][data-tgt-kind=obra]').click();
    assert.match(find('#painelGrupoMobileConteudo [data-tgt-action=start]').textContent,/Retomar intervenção/);
   }else{
    assert.deepEqual(w.sheet,{id:'obra',finished:response===true});
   }
   find('[data-tgt-nav=home]').click();
   assert.equal(find('#omeudia [data-tgt-action=exit][data-tgt-kind=obra]'),null);
  }finally{w.close();}
 }
});
test('both entry points and offline precache use the same employee refresh asset',()=>{
 const asset=fs.readFileSync('index.html','utf8').match(/tg-technician\.js\?v=[\w.-]+/)?.[0];assert(asset);for(const path of ['index.html','login.html','sw.js'])assert(fs.readFileSync(path,'utf8').includes(asset),path);const sw=fs.readFileSync('sw.js','utf8');assert.match(sw,/const CACHE = 'totalgest-release-\d{8}-[a-z0-9-]+'/);
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

test('mobile technician can recover their own overnight entry after work is reassigned and completed',async()=>{
 const w=setup({attendance:true});
 try {
  const [work]=w.dados.obras;
  work.responsaveisIds=['other'];
  work.estado='concluida';
  w.dados.servicos=[];
  w.dados.obraPontoLonga=[{id:'night',adminId:'a',funcionarioId:'e',obraId:work.id,data:'2026-11-05',entrada:'23:30',saida:null}];
  w._mostrarCarregando=()=>{};
  w._esconderCarregando=()=>{};
  w._refrescarModalObraLongaSeAberto=()=>{};
  w.resolveSave();
  w.TGTechnician.refresh();
  w.document.querySelector('#omeudia [data-tgt-action=exit][data-tgt-kind=obra]').click();
  const input=w.document.getElementById('saidaAnteriorMomento');
  assert(input);
  input.value='2026-11-06T00:12';
  input.form.dispatchEvent(new w.Event('submit',{cancelable:true}));
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(w.dados.obraPontoLonga.length,2);
  assert.equal(w.dados.obraPontoLonga[0].saida,'24:00');
  assert.equal(w.dados.obraPontoLonga[1].saida,'00:12');
  assert.equal(w.saveCalls,1);
  assert.equal(work.estado,'concluida');
 }finally{w.close();}
});
