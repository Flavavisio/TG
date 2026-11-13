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

test('com ponto: botão de almoço só aparece quando há picagem geral e inicia fluxo de almoço',()=>{
 const t=setup({attendance:true,two:false});try{
  const lunch=t.w.document.querySelector('[data-tgt-action="lunch"]');
  assert(lunch,'botão de almoço ativo');
  lunch.click();
  assert(t.events.includes('slider'),'deve pedir gesto de arrastar');
  assert(!t.events.includes('generalExit'),'sem arrastar não grava');
  t.w.confirm();
  assert(t.events.includes('generalExit'),'após arrastar inicia o fluxo de almoço');
 }finally{t.finish()}
});
test('sem ponto: depois de concluir definitivamente OS 1, pode iniciar OS 2',()=>{
 const t=setup();try{
  t.enter('os1');t.close('os1','concluida');
  t.w.dados.servicos.find(os=>os.id==='os1').status='concluído';
  t.enter('os2');
  assert(t.events.includes('entrada:os2'));
 }finally{t.finish()}
});
test('com ponto: OS ativa continua identificada quando tenta aceder à segunda',()=>{
 const t=setup({attendance:true});try{
  t.enter('os1');
  assert.equal(t.w.TGTechnician.jobs().filter(x=>x.open).length,1);
  const second=t.w.document.querySelector('[data-tgt-action="choose"][data-tgt-id="os2"]');
  assert(second);
  second.click();
  assert(!t.events.includes('entrada:os2'));
 }finally{t.finish()}
});

test('três técnicos: se responsável termina primeiro, os outros dois continuam independentes',()=>{
 const t=setup({attendance:true,two:false});try{
   const os=t.w.dados.servicos[0];
   os.funcionariosIds=['t1','t2','t3'];os.relatorioResponsavelId='t1';
   t.enter('os1');
   t.w.dados.ponto.push({id:'t2',adminId:'a',funcionarioId:'t2',servicoId:'os1',data:'2026-11-12',entrada:'09:15',saida:null});
   t.w.dados.ponto.push({id:'t3',adminId:'a',funcionarioId:'t3',servicoId:'os1',data:'2026-11-12',entrada:'09:30',saida:null});
   t.close('os1','hoje');
   assert.equal(os.relatorioResponsavelId,'t1');
   assert.equal(os.status,'em andamento');
   assert.equal(t.w.dados.ponto.filter(p=>p.funcionarioId!=='t1'&&!p.saida).length,2);
   assert.deepEqual(Array.from(t.w.TGTechnician.pendingPersonalOS()),[]);
 }finally{t.finish()}
});
test('responsável de outra empresa não ganha acesso nem horas no tenant atual',()=>{
 const t=setup({attendance:true});try{
  t.w.dados.ponto.push({id:'foreign',adminId:'b',funcionarioId:'t1',servicoId:'os2',data:'2026-11-12',entrada:'11:30',saida:null});
  assert.deepEqual(Array.from(t.w.TGTechnician.pendingPersonalOS()),[]);
  t.w.TGTechnician.handleGeneralClock();
  assert(t.events.includes('slider'));
 }finally{t.finish()}
});
test('picagem de outro técnico não impede saída do funcionário atual',()=>{
 const t=setup({attendance:true});try{
  t.w.dados.ponto.push({id:'colleague',adminId:'a',funcionarioId:'t2',servicoId:'os1',data:'2026-11-12',entrada:'09:00',saida:null});
  t.w.TGTechnician.handleGeneralClock();
  assert(t.events.includes('slider'));
 }finally{t.finish()}
});
test('múltiplas pausas do mesmo técnico na OS não duplicam a lista de pendências',()=>{
 const t=setup({attendance:true,two:false});try{
  for(let i=0;i<4;i++)t.w.dados.ponto.push({id:'pause'+i,adminId:'a',funcionarioId:'t1',servicoId:'os1',data:'2026-11-12',entrada:'0'+(8+i)+':00',saida:'0'+(8+i)+':40',motivoSaida:'pausa'});
  assert.deepEqual(Array.from(t.w.TGTechnician.pendingPersonalOS()),['OS 125']);
  t.w.dados.ponto.push({id:'end',adminId:'a',funcionarioId:'t1',servicoId:'os1',data:'2026-11-12',entrada:'14:00',saida:'15:00',motivoSaida:'hoje'});
  assert.deepEqual(Array.from(t.w.TGTechnician.pendingPersonalOS()),[]);
 }finally{t.finish()}
});
test('pausa com falha de guardar: registo continua aberto, erro claro e sem confirmação falsa',async()=>{
 const t=setup({attendance:true,two:false});try{
  t.enter('os1');
  t.w.guardarDados=async()=>{throw new Error('Sem ligação')};
  const job=t.w.TGTechnician.jobs().find(x=>x.id==='os1');
  const p=job.open;
  await t.w.TGTechnician.pauseWork(job);
  assert.equal(p.saida,null);
  assert.equal(p.motivoSaida,undefined);
  assert.match(t.messages.at(-1),/Não foi possível confirmar a pausa/);
 }finally{t.finish()}
});
test('duas OS: pausa uma e termina segunda; a primeira continua por regularizar',async()=>{
 const t=setup({attendance:true});try{
  t.enter('os1');
  await t.w.TGTechnician.pauseWork(t.w.TGTechnician.jobs().find(x=>x.id==='os1'));
  t.enter('os2');t.close('os2','hoje');
  assert.deepEqual(Array.from(t.w.TGTechnician.pendingPersonalOS()),['OS 125']);
  t.w.TGTechnician.handleGeneralClock();
  assert(!t.events.includes('slider'));
 }finally{t.finish()}
});
test('tentativa de sair sem registo de ponto: relógio geral não regista nada',()=>{
 const t=setup({attendance:false});try{
  t.w.TGTechnician.handleGeneralClock();
  assert(!t.events.includes('generalExit'));
  assert(!t.events.includes('slider'));
 }finally{t.finish()}
});
test('referências de OS concluídas não criam pendências em novo dia',()=>{
 const t=setup({attendance:true});try{
  t.w.dados.servicos.find(x=>x.id==='os1').status='concluído';
  t.w.dados.ponto.push({id:'historic',adminId:'a',funcionarioId:'t1',servicoId:'os1',data:'2026-11-11',entrada:'23:00',saida:'23:50',motivoSaida:'pausa'});
  assert.deepEqual(Array.from(t.w.TGTechnician.pendingPersonalOS()),[]);
 }finally{t.finish()}
});
test('três técnicos e OS diferente: cada funcionário só vê as próprias pendências',()=>{
 const t=setup({attendance:true});try{
  t.w.dados.servicos[0].funcionariosIds=['t1','t2','t3'];t.w.dados.servicos[1].funcionariosIds=['t1','t2'];
  t.w.dados.ponto.push({id:'self',adminId:'a',funcionarioId:'t1',servicoId:'os1',data:'2026-11-12',entrada:'09:00',saida:null});
  t.w.dados.ponto.push({id:'other',adminId:'a',funcionarioId:'t2',servicoId:'os2',data:'2026-11-12',entrada:'10:00',saida:null});
  assert.deepEqual(Array.from(t.w.TGTechnician.pendingPersonalOS()),['OS 125']);
  t.w.usuarioLogado.id='t2';
  assert.deepEqual(Array.from(t.w.TGTechnician.pendingPersonalOS()),['OS 128']);
 }finally{t.finish()}
});

test('almoço: cancelar o gesto não regista qualquer saída',()=>{
 const t=setup({attendance:true,two:false});try{
  t.w.document.querySelector('[data-tgt-action="lunch"]').click();
  assert(t.events.includes('slider'));
  assert(!t.events.includes('generalExit'));
  assert.equal(t.w.dados.ponto.length,1);
 }finally{t.finish()}
});
test('almoço: ao confirmar verifica novamente OS em curso',()=>{
 const t=setup({attendance:true,two:false});try{
  t.w.document.querySelector('[data-tgt-action="lunch"]').click();
  t.enter('os1');
  t.w.confirm();
  assert(!t.events.includes('generalExit'));
  assert.match(t.messages.at(-1),/Não é possível confirmar o almoço/);
 }finally{t.finish()}
});
test('almoço: sem confirmação por arrastar não regista picagem',()=>{
 const t=setup({attendance:true,two:false});try{
  t.w.abrirSliderConfirmacao=undefined;
  t.w.document.querySelector('[data-tgt-action="lunch"]').click();
  assert(!t.events.includes('generalExit'));
  assert.match(t.messages.at(-1),/indisponível/);
 }finally{t.finish()}
});
test('almoço: sem ponto geral não apresenta ação',()=>{
 const t=setup({attendance:false,two:false});try{
  assert.equal(t.w.document.querySelector('[data-tgt-action="lunch"]'),null);
 }finally{t.finish()}
});
test('erros em telemóvel centrados e cache da PWA sincronizada',()=>{
 const css=fs.readFileSync('tg-technician.css','utf8');
 assert.match(css,/#tgToastContainer:has\(\.tg-toast\.tg-erro\)/);
 assert.match(css,/translate\(-50%,-50%\)/);
 assert.match(css,/#modalGenericoOverlay/);
 const js='tg-technician.js?v=1.11.4-work-photos',style='tg-technician.css?v=1.9.2-lunch-entry-lock';
 for(const path of ['index.html','login.html','sw.js']){
   const html=fs.readFileSync(path,'utf8');
   assert(html.includes(js),path);
   assert(html.includes(style),path);
 }
 assert(fs.readFileSync('sw.js','utf8').includes('totalgest-release-20261113-modal-erro-center'));
});

test('almoço: só Regresso de almoço ativo, dar entrada e intervenção esbatidos',()=>{
 const t=setup({attendance:true});try{
  t.w.dados.ponto[0].saida='12:00:00';
  t.w.dados.ponto[0].pausaAlmoco=true;
  t.w.TGTechnician.refresh();
  const lunch=t.w.document.querySelector('[data-tgt-action="lunch"]');
  const clock=t.w.document.querySelector('[data-tgt-action="clock"]');
  const entry=t.w.document.querySelector('[data-tgt-action="start"]');
  assert(lunch&&/Regresso de almoço/.test(lunch.textContent));
  assert.equal(lunch.disabled,false);
  assert(clock&&entry);
  for(const b of [clock,entry]){
    assert.equal(b.disabled,true);
    assert.equal(b.getAttribute('aria-disabled'),'true');
    assert(b.classList.contains('tgt-lunch-disabled'));
  }
  entry.click();clock.click();
  assert(!t.events.includes('entrada:os1'));
  assert(!t.events.includes('generalExit'));
 }finally{t.finish()}
});
test('almoço: entrada direta numa OS e obra são recusadas sem gravar picagem',()=>{
 const t=setup({attendance:true});try{
  const rec=t.w.dados.ponto[0];rec.saida='12:00:00';rec.pausaAlmoco=true;
  const before=JSON.stringify(t.w.dados.ponto);
  t.w.picarPontoOS('os1','entrada');
  t.w.obraLongaPicarEntrada('obra', 'entrada');
  t.w.TGTechnician.handleGeneralClock();
  assert.equal(JSON.stringify(t.w.dados.ponto),before);
  assert(!t.events.some(x=>x==='entrada:os1'||x==='work:obra'||x==='generalExit'));
  assert(t.messages.some(x=>x.includes('Regresso de almoço')));
 }finally{t.finish()}
});
test('almoço: depois de regressar, botões são desbloqueados e OS inicia',()=>{
 const t=setup({attendance:true});try{
  const rec=t.w.dados.ponto[0];rec.saida='12:00:00';rec.pausaAlmoco=true;
  t.w.TGTechnician.refresh();
  assert(t.w.document.querySelector('[data-tgt-action="start"]').disabled);
  const lunch=t.w.document.querySelector('[data-tgt-action="lunch"]');
  lunch.click();
  assert(t.events.includes('generalExit'));
  t.w.dados.ponto.push({id:'post-lunch',adminId:'a',funcionarioId:'t1',data:'2026-11-12',entrada:'13:00:00',saida:null});
  t.w.TGTechnician.refresh();
  const entry=t.w.document.querySelector('[data-tgt-action="start"]');
  const clock=t.w.document.querySelector('[data-tgt-action="clock"]');
  assert(entry&&!entry.disabled);
  assert(clock&&!clock.disabled);
  entry.click();
  assert(t.events.includes('entrada:os1'));
 }finally{t.finish()}
});
test('almoço: se registo pertence a outro técnico ou empresa, não bloqueia',()=>{
 const t=setup({attendance:true});try{
  t.w.dados.ponto.push({id:'other-tenant',adminId:'b',funcionarioId:'t1',data:'2026-11-12',entrada:'08:00',saida:'12:00',pausaAlmoco:true});
  t.w.dados.ponto.push({id:'colleague',adminId:'a',funcionarioId:'t2',data:'2026-11-12',entrada:'08:00',saida:'12:00',pausaAlmoco:true});
  t.w.TGTechnician.refresh();
  const entry=t.w.document.querySelector('[data-tgt-action="start"]');
  assert(entry&&!entry.disabled);
 }finally{t.finish()}
});
test('almoço: CSS apresenta botões bloqueados esbatidos com cursor indisponível',()=>{
 const css=fs.readFileSync('tg-technician.css','utf8');
 assert.match(css,/\.tgt-button\.tgt-lunch-disabled/);
 assert.match(css,/opacity:\.43/);
 assert.match(css,/cursor:not-allowed/);
});
