const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const api=require('../tg-unsuccessful-visits.js');
const copy=x=>JSON.parse(JSON.stringify(x)),now=new Date('2026-11-05T12:20:00');
function sample(){const os={id:'os',adminId:'a',clienteId:'c',data:'2026-11-05',hora:'12:00',status:'em andamento',funcionariosIds:['e','e2'],relatorioResponsavelId:'e',checklist:{existing:true},tiposTrabalho:['RAVAC'],pagamentoLocal:true,pago:false};const point={id:'p',adminId:'a',servicoId:'os',funcionarioId:'e',data:'2026-11-05',entrada:'12:00:00',saida:null};const user={id:'e',adminId:'a',role:'funcionario',nome:'Técnico'};return {os,point,user};}
function fail(t,points=[t.point],input={motivo:'ausente',observacoes:'Aguardou 20 minutos.'}){return api.applyVisit(t.os,t.point,t.user,input,points,now);}
const admin={id:'a',role:'admin'},people=[{id:'e',adminId:'a'},{id:'e2',adminId:'a'},{id:'foreign',adminId:'b'}];
const decision={acao:'reagendar',data:'2026-11-06',hora:'10:00',funcionariosIds:['e2'],cobranca:'nao_cobrar'};
test('failed visit closes only its clock, preserves all unrelated OS and checklist data and is idempotent',()=>{
 const t=sample(),original=copy(t.os),other={...t.point,id:'p2',funcionarioId:'e2'};fail(t,[t.point,other]);assert.equal(t.point.saida,'12:20:00');assert.equal(other.saida,null);assert.equal(t.os.status,'em andamento');assert.equal(t.os.pagamentoLocal,true);assert.equal(t.os.pago,false);assert.deepEqual(t.os.tiposTrabalho,original.tiposTrabalho);assert.equal(t.os.checklist.existing,true);assert(api.pending(t.os));assert(api.blocked(t.os,'e'));assert(!api.blocked(t.os,'e2'));fail(t,[t.point,other]);assert.equal(api.attempts(t.os).length,1);
});
test('without another technician the persisted OS remains pending with a Por reagendar label after reload',()=>{
 const t=sample();fail(t);const reload=copy(t.os);assert.equal(reload.status,'pendente');assert.equal(api.label(reload),'Por reagendar');assert(api.failedPoint(reload,'p'));assert.equal(api.attempts(reload)[0].observacoes,'Aguardou 20 minutos.');
});
test('reason, other description and photograph bounds are validated before changing the clock',()=>{
 for(const input of [{motivo:''},{motivo:'outro'},{motivo:'outro',observacoes:'ab'},{motivo:'ausente',observacoes:'x'.repeat(2001)},{motivo:'acesso',fotos:['javascript:alert(1)']},{motivo:'acesso',fotos:Array(4).fill('data:image/jpeg;base64,YQ==')}]){const t=sample();assert.throws(()=>fail(t,[t.point],input));assert.equal(t.point.saida,null);assert.equal(api.attempts(t.os).length,0);}
 const t=sample();fail(t,[t.point],{motivo:'outro',observacoes:'Sem chave',fotos:['data:image/jpeg;base64,YQ==']});assert.equal(api.attempts(t.os)[0].fotos.length,1);
});
test('cross-tenant, unassigned, closed-clock and customer attempts cannot change a service',()=>{
 for(const change of [t=>t.user.adminId='b',t=>t.user.id='outside',t=>t.user.role='cliente',t=>t.point.adminId='b',t=>t.point.funcionarioId='e2',t=>t.os.status='concluído',t=>t.point.saida='12:10']){const t=sample();change(t);assert.throws(()=>fail(t));assert.equal(api.attempts(t.os).length,0);}
});
test('replanning preserves original attempts and reports, changes team/responsible and releases the old failed clock',()=>{
 const t=sample();fail(t);api.applyDecision(t.os,admin,decision,people,[t.point],now);assert.equal(t.os.data,'2026-11-06');assert.deepEqual(t.os.funcionariosIds,['e2']);assert.equal(t.os.relatorioResponsavelId,'e2');assert(!api.pending(t.os));assert(!api.blocked(t.os,'e'));assert.equal(api.attempts(t.os)[0].dataAgendada,'2026-11-05');assert.equal(api.envelope(t.os).resolucoes.p.cobranca,'nao_cobrar');assert.equal(t.os.pago,false);
 const second={...t.point,id:'p3',funcionarioId:'e2',data:'2026-11-06',entrada:'10:00:00',saida:null};api.applyVisit(t.os,second,{id:'e2',adminId:'a',role:'funcionario'},{motivo:'acesso'},[second],new Date('2026-11-06T10:30:00'));assert.equal(api.attempts(t.os).length,2);assert.equal(api.unresolved(t.os).length,1);
});
test('manager decisions reject foreign technicians, invalid dates/prices, employees and an active colleague',()=>{
 for(const input of [{...decision,funcionariosIds:['foreign']},{...decision,data:'2026-02-30'},{...decision,data:'2026-11-04'},{...decision,hora:'25:60'},{...decision,cobranca:'cobrar',valor:0}]){const t=sample();fail(t);assert.throws(()=>api.applyDecision(t.os,admin,input,people,[t.point],now));assert(api.pending(t.os));}
 const t=sample();fail(t);assert.throws(()=>api.applyDecision(t.os,t.user,decision,people,[t.point],now));assert.throws(()=>api.applyDecision(t.os,admin,decision,people,[{...t.point,id:'active',funcionarioId:'e2',saida:null}],now));
 api.applyDecision(t.os,admin,{acao:'manter',cobranca:'pendente'},people,[{...t.point,id:'active',saida:null}],now);assert(!api.pending(t.os));
});
test('cancellation keeps time/history and records only an explicit billing decision, without marking paid',()=>{
 const t=sample();fail(t);api.applyDecision(t.os,admin,{acao:'cancelar',cobranca:'cobrar',valor:'25.50'},people,[t.point],now);assert.equal(t.os.status,'cancelado');assert.equal(t.point.saida,'12:20:00');assert.equal(api.envelope(t.os).resolucoes.p.valor,25.5);assert.equal(t.os.pago,false);assert.equal(api.attempts(t.os).length,1);
});
function database(row,{active=[],race=null,deny=false,error=null}={}){
 let server=copy(row),writes=0,reads=0;
 const client={from(table){return {select(){return {eq(){return this;},is:async()=>({data:active,error:null}),maybeSingle:async()=>{reads++;return {data:copy(server),error:null};}};},update(patch){const filters=[];return {eq(k,v){filters.push([k,v]);return this;},is(k,v){filters.push([k,v]);return this;},async select(){writes++;if(race&&writes===1)server=race(server);if(error)return {data:null,error};if(deny)return {data:[],error:null};if(filters.some(([k,v])=>k==='checklist'?JSON.stringify(server[k])!==v:server[k]!==v))return {data:[],error:null};server={...server,...copy(patch)};return {data:[copy(server)],error:null};}};},upsert(rows){return {select:async()=>({data:rows.map(r=>({id:r.id})),error:null})};}};}};
 return {client,get server(){return server;},get writes(){return writes;},get reads(){return reads;}};
}
function rows(t){const row={id:t.os.id,admin_id:t.os.adminId,checklist:copy(t.os.checklist),status:t.os.status,data:t.os.data,hora:t.os.hora,descricao:'Descrição original'};return row;}
test('conditional persistence merges a concurrent visit and never resends unrelated stale columns',async()=>{
 const t=sample(),base=rows(t);fail(t);const local=rows(t);const remoteVisit={id:'other',adminId:'a',registadoEm:'2026-11-05T12:10:00Z',motivo:'acesso'};
 const db=database({...base,descricao:'Atualizada no escritório'},{race:server=>({...server,checklist:{...server.checklist,serverCheck:true,[api.KEY]:{tentativas:{other:remoteVisit}}}})});
 const r=await api.persistRows(db.client,[local],new Map([['os',JSON.stringify(base)]]));assert.equal(r.error,null);assert.equal(db.writes,2);assert.equal(db.server.descricao,'Atualizada no escritório');assert.equal(Object.keys(db.server.checklist[api.KEY].tentativas).length,2);assert.equal(db.server.checklist.serverCheck,true);
});
test('remote active colleague keeps OS running and prevents a stale reschedule',async()=>{
 const t=sample(),base=rows(t);fail(t);const local=rows(t),db=database(base,{active:[{id:'p'},{id:'active-colleague'}]});let r=await api.persistRows(db.client,[local],new Map([['os',JSON.stringify(base)]]));assert.equal(r.error,null);assert.equal(db.server.status,'em andamento');
 const reloaded=copy(db.server);t.os.status='pendente';api.applyDecision(t.os,admin,decision,people,[t.point],now);r=await api.persistRows(db.client,[rows(t)],new Map([['os',JSON.stringify(reloaded)]]));assert(r.error);assert.equal(db.server.data,'2026-11-05');
});
test('silent RLS rejection, API failure and concurrent OS closure are never reported as saved',async()=>{
 for(const opts of [{deny:true},{error:{message:'permission denied'}},{}]){
  const t=sample(),base=rows(t);fail(t);const db=database(opts.deny||opts.error?base:{...base,status:'concluído'},opts);const r=await api.persistRows(db.client,[rows(t)],new Map([['os',JSON.stringify(base)]]));assert(r.error);assert.equal(r.data.length,0);assert(db.writes<=3);
 }
});
test('the real exit entry point bypasses worksheets, signatures and payment for failed visits',async()=>{
 const src=fs.readFileSync('app-principal.js','utf8'),fn=src.match(/        async function picarPontoOS\([^]*?\n        \}/)[0],t=sample(),calls=[];
 const c={dados:{servicos:[t.os],ponto:[t.point],administradores:[{id:'a'}]},usuarioLogado:t.user,_tenantId:()=> 'a',_gpsPontoAtivo:()=>false,getDataHoje:()=> '2026-11-05',perguntarSaidaObra:async()=> 'sem_sucesso',alert:()=>{},TGUnsuccessfulVisits:{register:async(id,p)=>calls.push([id,p])},Date,renderizarAgendaObras(){},_osConcluidaParaFuncionario:()=>false};
 vm.runInNewContext(fn+';picarPontoOS("os","saida")',c);await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(calls,[['os','p']]);assert.equal(t.point.saida,null);assert.equal(t.os.status,'em andamento');
});
test('existing Supabase service mapping preserves visit history without any new columns',()=>{
 const src=fs.readFileSync('app-principal.js','utf8'),start=src.indexOf('        const M = {'),end=src.indexOf('        const ORDEM =',start);
 const context={hhmm:s=>s?.slice(0,5)||null,nn:s=>s||null};vm.runInNewContext(src.slice(start,end)+';globalThis.serviceMapping=M.servicos;',context);
 const t=sample();fail(t);const row=context.serviceMapping.to(t.os);assert.equal(row.checklist[api.KEY].tentativas.p.motivo,'ausente');assert.equal(Object.hasOwn(row,'visitas_sem_sucesso'),false);
 const reloaded=context.serviceMapping.from(copy(row));assert(api.pending(reloaded));assert.equal(api.attempts(reloaded)[0].observacoes,'Aguardou 20 minutos.');
});
