const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {JSDOM}=require('jsdom');
const src=fs.readFileSync('tg-technician.js','utf8');
const instrumented=src.replace(
  'window.TGTechnician={refresh,jobs,todayJobs,weekJobs,enabled};refresh();',
  'window.TGTechnician={refresh,jobs,todayJobs,weekJobs,enabled,home,focusHTML,pauseWork,handleGeneralClock,pendingPersonalOS};refresh();'
);
assert.notEqual(src,instrumented);
function setup({attendance=false,two=true,person='t1'}={}){
  const html='<div id="cardsGrid"><div id="omeudia"></div><div class="card-principal" data-card="servicos"></div><div class="card-principal" data-card="obras-longa"></div></div><div id="tgHome"></div><nav id="menuInferiorMobile"></nav><div id="painelGrupoMobile"><div id="painelGrupoMobileConteudo"></div></div><div id="modalSimNaoOverlay"><button id="modalSimNaoAlmocoBtn">Almoço</button></div><div id="modalOverlay"></div>';
  const w=new JSDOM(html,{url:'https://prod-simulation.invalid',runScripts:'outside-only',pretendToBeVisual:true}).window;
  w.innerWidth=390;
  w.usuarioLogado={id:person,adminId:'a',role:'funcionario',nome:person};
  w.dados={
    administradores:[{id:'a'}],funcionarios:[{id:'t1',adminId:'a'},{id:'t2',adminId:'a'}],
    clientes:[{id:'c',adminId:'a',nome:'Cliente XPTO'}],obras:[],obraPontoLonga:[],relatoriosEspecialidade:[],folhasObra:[],
    servicos:[
      {id:'os1',numeroRegisto:'125',adminId:'a',data:'2026-11-12',hora:'09:00',clienteId:'c',descricao:'OS 1',funcionariosIds:['t1','t2'],status:'pendente'},
      ...(two?[{id:'os2',numeroRegisto:'128',adminId:'a',data:'2026-11-12',hora:'11:00',clienteId:'c',descricao:'OS 2',funcionariosIds:['t1'],status:'pendente'}]:[])
    ],
    ponto:[...(attendance?[{id:'general',adminId:'a',funcionarioId:person,data:'2026-11-12',entrada:'08:00',saida:null}]:[])]
  };
  const messages=[],events=[];
  Object.assign(w,{
    getDataHoje:()=> '2026-11-12',adminDoUtilizador:()=>({id:'a'}),expressAtivo:()=>false,_licencaValidaTenant:()=>true,
    pontoAssiduidadeAtivo:()=>attendance,_pausaAlmocoPendente:()=>null,_fecharSecaoAbertaMobile(){},scrollTo(){},
    _osConcluidaParaFuncionario:()=>false,mostrarErro:x=>messages.push(x),alert:x=>messages.push(x),
    guardarDados:async()=>{events.push('save')},renderizarTudo(){events.push('render')},_modalSimNaoResponder:()=>{},
    abrirSliderConfirmacao:(title,body,cb)=>{events.push('slider');w.confirm=cb},
    picarPonto:()=>events.push('generalExit'),
    picarPontoOS:(id,act)=>{events.push(act+':'+id);if(act==='entrada'){const n=w.dados.ponto.length+1;w.dados.ponto.push({id:'p'+n,adminId:'a',funcionarioId:person,servicoId:id,data:'2026-11-12',entrada:'09:00',saida:null});w.dados.servicos.find(x=>x.id===id).status='em andamento'}},
    obraLongaPicarEntrada:(id)=>events.push('work:'+id),_mostrarInicioConteudo(){},_montarMenuInferiorMobile(){},
    setInterval:()=>1
  });
  w.eval(instrumented);
  function enter(id){w.TGTechnician.refresh();let b=w.document.querySelector('[data-tgt-action="start"][data-tgt-id="'+id+'"]');if(!b){const item=w.document.querySelector('[data-tgt-action="choose"][data-tgt-id="'+id+'"]');if(item)item.click();b=w.document.querySelector('[data-tgt-action="start"][data-tgt-id="'+id+'"]')}if(!b){b=w.document.createElement('button');b.dataset.tgtAction='start';b.dataset.tgtKind='os';b.dataset.tgtId=id;w.document.body.append(b)}b.click();}
  function close(id,reason='hoje'){let p=[...w.dados.ponto].reverse().find(p=>p.servicoId===id&&p.funcionarioId===person&&!p.saida);assert(p);p.saida='10:00';p.motivoSaida=reason;w.TGTechnician.refresh();}
  return {w,messages,events,enter,close,finish:()=>w.close()};
}
test('sem ponto: uma OS entra e termina por hoje; sem botões almoço/pausa',()=>{
 const t=setup({two:false});try{t.enter('os1');assert(t.events.includes('entrada:os1'));assert(!t.w.document.getElementById('omeudia').textContent.includes('Sair para almoço'));assert.equal(t.w.document.querySelector('[data-tgt-action="pause"]'),null);t.close('os1');assert.deepEqual(Array.from(t.w.TGTechnician.pendingPersonalOS()),[]);}finally{t.finish()}
});
test('sem ponto: duas OS - segunda bloqueada até terminar por hoje',()=>{
 const t=setup();try{t.enter('os1');t.enter('os2');assert(!t.events.includes('entrada:os2'));assert.match(t.messages.join(' '),/Termina por hoje/);t.close('os1');t.enter('os2');assert(t.events.includes('entrada:os2'));}finally{t.finish()}
});
test('sem ponto: uma OS em pausa é pendência e bloqueia segunda',()=>{
 const t=setup();try{t.enter('os1');t.close('os1','pausa');assert.deepEqual(Array.from(t.w.TGTechnician.pendingPersonalOS()),['OS 125']);t.enter('os2');assert(!t.events.includes('entrada:os2'));assert.match(t.messages.join(' '),/regularizar/);}finally{t.finish()}
});
test('sem ponto: tentativa de pausar OS não modifica picagem',async()=>{
 const t=setup();try{t.enter('os1');const before=JSON.stringify(t.w.dados.ponto);await t.w.TGTechnician.pauseWork(t.w.TGTechnician.jobs().find(x=>x.id==='os1'));assert.equal(JSON.stringify(t.w.dados.ponto),before);assert(!t.events.includes('save'));}finally{t.finish()}
});
test('com ponto: uma OS pausa, preserva hora anterior, e segunda pode entrar',async()=>{
 const t=setup({attendance:true});try{t.enter('os1');const job=t.w.TGTechnician.jobs().find(x=>x.id==='os1');await t.w.TGTechnician.pauseWork(job);const p=t.w.dados.ponto.find(x=>x.servicoId==='os1');assert.equal(p.motivoSaida,'pausa');assert(p.saida);t.enter('os2');assert(t.events.includes('entrada:os2'));assert.equal(t.w.dados.ponto.filter(x=>x.servicoId==='os1').length,1);}finally{t.finish()}
});
test('com ponto: saída com duas pendências lista ambas e bloqueia',async()=>{
 const t=setup({attendance:true});try{t.enter('os1');await t.w.TGTechnician.pauseWork(t.w.TGTechnician.jobs().find(x=>x.id==='os1'));t.enter('os2');t.w.TGTechnician.handleGeneralClock();assert(!t.events.includes('slider'));assert.match(t.messages.join(' '),/OS 125/);assert.match(t.messages.join(' '),/OS 128/);t.close('os2');t.w.TGTechnician.handleGeneralClock();assert(!t.events.includes('slider'));assert.match(t.messages.at(-1),/OS 125/);}finally{t.finish()}
});
test('com ponto: regularizadas duas OS, saída pode ser confirmada',async()=>{
 const t=setup({attendance:true});try{t.enter('os1');await t.w.TGTechnician.pauseWork(t.w.TGTechnician.jobs().find(x=>x.id==='os1'));t.enter('os2');t.close('os2');t.w.dados.ponto.find(x=>x.servicoId==='os1').motivoSaida='hoje';t.w.TGTechnician.handleGeneralClock();assert(t.events.includes('slider'));t.w.confirm();assert(t.events.includes('generalExit'));}finally{t.finish()}
});
test('dois técnicos: estado de um não altera a intervenção do outro',()=>{
 const t=setup({two:false});try{t.enter('os1');t.w.dados.ponto.push({id:'colleague',adminId:'a',funcionarioId:'t2',servicoId:'os1',data:'2026-11-12',entrada:'09:30',saida:null});t.close('os1');assert.deepEqual(Array.from(t.w.TGTechnician.pendingPersonalOS()),[]);assert.equal(t.w.dados.ponto.find(x=>x.id==='colleague').saida,null);}finally{t.finish()}
});
