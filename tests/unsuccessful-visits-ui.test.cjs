const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),{JSDOM}=require('jsdom');
const source=fs.readFileSync('tg-unsuccessful-visits.js','utf8');
function setup(){
 const w=new JSDOM('<button id="origin">Origem</button>',{runScripts:'outside-only',url:'https://example.invalid'}).window;
 w.usuarioLogado={id:'e',adminId:'a',role:'funcionario',nome:'Técnico'};
 w.dados={servicos:[{id:'os',adminId:'a',numeroRegisto:'125',status:'em andamento',data:'2026-11-05',hora:'10:00',descricao:'Manutenção',funcionariosIds:['e'],checklist:{check:true}}],ponto:[{id:'p',adminId:'a',servicoId:'os',funcionarioId:'e',data:'2026-11-05',entrada:'09:00:00',saida:null}],funcionarios:[{id:'e',adminId:'a',nome:'Técnico'}],encarregados:[],administradores:[{id:'a',nome:'Admin'}]};
 w.alerts=[];w.alert=s=>w.alerts.push(s);w.renderizarTudo=()=>{};w.renderizarAgendaObras=()=>{};w.saved=[];w.guardarDados=async()=>{if(w.fail)throw Error('Servidor indisponível');w.saved.push(JSON.parse(JSON.stringify(w.dados)));};w._guardarCacheLocal=()=>{w.cache=JSON.parse(JSON.stringify(w.dados));};w._notificarAdminESubadmin=()=>{w.notified=true;};w.getDataHoje=()=> '2026-11-05';w.tgConfirm=async()=>true;w.eval(source);return w;
}
const settle=()=>new Promise(r=>setImmediate(r));
test('cancel or Escape leaves the open clock untouched and restores the previous focus',async()=>{
 const w=setup();try{w.document.getElementById('origin').focus();await w.TGUnsuccessfulVisits.register('os','p');w.document.querySelector('[data-uv-cancel]').click();assert.equal(w.dados.ponto[0].saida,null);assert.equal(w.saved.length,0);assert.equal(w.document.activeElement.id,'origin');await w.TGUnsuccessfulVisits.register('os','p');w.document.querySelector('#tgVisitOverlay .modal').dispatchEvent(new w.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));assert.equal(w.document.getElementById('tgVisitOverlay'),null);assert.equal(w.dados.ponto[0].saida,null);}finally{w.close();}
});
test('failed save retains entered reason and exit, retries exactly one visit, and notifies only after confirmation',async()=>{
 const w=setup();try{await w.TGUnsuccessfulVisits.register('os','p');let form=w.document.querySelector('form');form.elements.motivo.value='ausente';form.elements.observacoes.value='Cliente ausente';w.fail=true;form.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await settle();assert.match(form.querySelector('[data-uv-error]').textContent,/pendentes de sincronização/);assert(w.dados.ponto[0].saida);assert(w.cache);assert.equal(w.notified,undefined);assert.equal(w.TGUnsuccessfulVisits.attempts(w.dados.servicos[0]).length,1);
 w.fail=false;form.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await settle();assert.equal(w.document.getElementById('tgVisitOverlay'),null);assert.equal(w.saved.length,1);assert.equal(w.TGUnsuccessfulVisits.attempts(w.dados.servicos[0]).length,1);assert(w.notified);}finally{w.close();}
});
test('another reason requires description and session/account changes cannot submit the old form',async()=>{
 const w=setup();try{await w.TGUnsuccessfulVisits.register('os','p');const form=w.document.querySelector('form');form.elements.motivo.value='outro';form.dispatchEvent(new w.Event('submit',{cancelable:true}));await settle();assert.match(form.querySelector('[data-uv-error]').textContent,/Descreve/);assert.equal(w.dados.ponto[0].saida,null);form.elements.observacoes.value='Sem chave';w.usuarioLogado={id:'foreign',adminId:'b',role:'funcionario'};form.dispatchEvent(new w.Event('submit',{cancelable:true}));await settle();assert.equal(w.dados.ponto[0].saida,null);assert.match(form.querySelector('[data-uv-error]').textContent,/sessão mudou/);}finally{w.close();}
});
test('employee cannot open manager decisions; admin cancellation conserves the attempt and removes the pending alert',async()=>{
 const w=setup();try{const os=w.dados.servicos[0];w.TGUnsuccessfulVisits.applyVisit(os,w.dados.ponto[0],w.usuarioLogado,{motivo:'ausente'},w.dados.ponto,new Date());w.TGUnsuccessfulVisits.manage('os');assert.equal(w.document.querySelector('form'),null);w.usuarioLogado={id:'a',role:'admin'};w.TGUnsuccessfulVisits.manage('os');const form=w.document.querySelector('form');assert(form);form.elements.acao.value='cancelar';form.elements.cobranca.value='nao_cobrar';form.dispatchEvent(new w.Event('submit',{cancelable:true}));await settle();assert.equal(os.status,'cancelado');assert.equal(w.TGUnsuccessfulVisits.attempts(os).length,1);assert.equal(w.TGUnsuccessfulVisits.pendingList('a').length,0);assert.equal(w.saved.length,1);}finally{w.close();}
});
test('both visit forms reuse the normal TG dialog, field groups, close control and action footer',async()=>{
 const w=setup(),native=new JSDOM(fs.readFileSync('login.html','utf8')).window.document.querySelector('#modalGenericoOverlay');
 try{w.document.body.append(w.document.importNode(native,true));await w.TGUnsuccessfulVisits.register('os','p');const overlay=w.document.getElementById('modalGenericoOverlay');assert(overlay.classList.contains('open'));assert.equal(w.document.getElementById('tgVisitOverlay'),null);assert(overlay.querySelector('.close-modal'));assert(overlay.querySelector('.form-group select[name=motivo]'));assert(overlay.querySelector('#modalGenericoAcoes .btn-success'));
 overlay.querySelector('.close-modal').click();assert(!overlay.classList.contains('open'));assert.equal(w.dados.ponto[0].saida,null);assert.equal(overlay.style.zIndex,'');assert.equal(overlay.querySelector('#modalGenericoAcoes [data-uv-cancel]'),null);assert.match(overlay.querySelector('#modalGenericoAcoes [type=submit]').textContent,/Guardar/);assert.equal(overlay.querySelector('form').onsubmit,null);
 w.TGUnsuccessfulVisits.applyVisit(w.dados.servicos[0],w.dados.ponto[0],w.usuarioLogado,{motivo:'ausente'},w.dados.ponto,new Date());w.usuarioLogado={id:'a',role:'admin'};w.TGUnsuccessfulVisits.manage('os');assert.equal(w.document.getElementById('modalGenericoTitulo').textContent,'Agendar visita');assert.equal(overlay.querySelector('.tg-uv-history-toggle').open,false);assert(overlay.querySelector('#modalGenericoCampos input[name=data]'));assert(overlay.querySelector('#modalGenericoAcoes [type=submit]'));
 }finally{w.close();}
});

function rescheduleSetup(){
 const w=setup();
 w.dados.funcionarios.push({id:'e2',adminId:'a',nome:'Segundo técnico'},{id:'foreign',adminId:'b',nome:'Outra empresa'});
 w.dados.clientes=[{id:'client',adminId:'a',nome:'Cliente de teste'}];w.dados.servicos[0].clienteId='client';
 w.TGUnsuccessfulVisits.applyVisit(w.dados.servicos[0],w.dados.ponto[0],w.usuarioLogado,{motivo:'ausente'},w.dados.ponto,new Date());
 w.usuarioLogado={id:'a',role:'admin'};w.dados.notificacoes=[];w.pushes=[];w.notifEnabled=true;w.moduloNotificacoesAtivo=()=>w.notifEnabled;w.gerarId=()=> 'notification-'+w.dados.notificacoes.length;
 w.supa={functions:{invoke:(name,{body})=>{assert(w.saved.length>0,'schedule must be saved before sending');w.pushes.push({name,body});return Promise.resolve({});}}};
 const main=fs.readFileSync('app-principal.js','utf8');w.eval(main.match(/        function _notificarFuncionario\([^]*?\n        \}/)[0]);
 w.TGUnsuccessfulVisits.manage('os');const form=w.document.querySelector('form');form.elements.data.value='2026-11-07';form.elements.hora.value='14:30';return {w,form};
}
test('reschedule notifies each next-visit technician through the real in-app and push helper after saving',async()=>{
 const {w,form}=rescheduleSetup();try{
  form.querySelector('[name=tecnicos][value=e2]').checked=true;form.dispatchEvent(new w.Event('submit',{cancelable:true}));await settle();
  assert.deepEqual(w.pushes.map(p=>p.body.utilizador_id),['e','e2']);assert.equal(w.dados.notificacoes.length,2);
  for(const notice of w.dados.notificacoes){assert.equal(notice.adminId,'a');assert.match(notice.titulo,/OS #125 reagendada/);assert.match(notice.mensagem,/Cliente de teste.*Manutenção.*07\/11\/2026 às 14:30/);assert.equal(notice.acao,'abrirVerOS("os")');}
  assert(!w.pushes.some(p=>p.body.utilizador_id==='foreign'));assert.equal(w.saved[0].notificacoes.length,0);assert.equal(w.saved[0].servicos[0].data,'2026-11-07');
  // Even if the old submit handler is invoked again, it does not notify twice.
  await form.onsubmit?.(new w.Event('submit',{cancelable:true}));await settle();assert.equal(w.pushes.length,2);
 }finally{w.close();}
});
test('failed reschedule sends no notification until retry confirms the save, and notifies only the new team',async()=>{
 const {w,form}=rescheduleSetup();try{form.querySelector('[name=tecnicos][value=e]').checked=false;form.querySelector('[name=tecnicos][value=e2]').checked=true;w.fail=true;form.dispatchEvent(new w.Event('submit',{cancelable:true}));await settle();assert.equal(w.pushes.length,0);assert.equal(w.dados.notificacoes.length,0);w.fail=false;form.dispatchEvent(new w.Event('submit',{cancelable:true}));await settle();assert.deepEqual(w.pushes.map(p=>p.body.utilizador_id),['e2']);assert.equal(w.dados.notificacoes.length,1);}finally{w.close();}
});
test('cancelling the form, treating a visit without rescheduling or cancelling the OS never sends a reschedule notification',async()=>{
 for(const action of ['close','manter','cancelar']){const {w,form}=rescheduleSetup();try{if(action==='close')form.querySelector('[data-uv-cancel]').click();else{form.elements.acao.value=action;form.dispatchEvent(new w.Event('submit',{cancelable:true}));await settle();}assert.equal(w.pushes.length,0);assert.equal(w.dados.notificacoes.length,0);}finally{w.close();}}
});
test('reschedule notifications respect the existing notification entitlement',async()=>{
 const {w,form}=rescheduleSetup();try{w.notifEnabled=false;form.dispatchEvent(new w.Event('submit',{cancelable:true}));await settle();assert.equal(w.pushes.length,0);assert.equal(w.dados.notificacoes.length,0);assert.equal(w.dados.servicos[0].data,'2026-11-07');}finally{w.close();}
});
