const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const src=fs.readFileSync('app-principal.js','utf8');
const fn=name=>{const m=src.match(new RegExp('        (?:async )?function '+name+'\\([^]*?\\n        \\}'));assert(m,name);return m[0];};
function setup(response='hoje'){
 const alerts=[],saved=[],calls=[];
 class Clock extends Date {constructor(...args){super(...(args.length?args:['2026-10-30T16:00:00']));}}
 const os={id:'os',adminId:'a',clienteId:'c',data:'2026-10-30',funcionariosIds:['responsavel','colega'],relatorioResponsavelId:'responsavel',status:'em andamento'};
 const dados={administradores:[{id:'a'}],servicos:[os],ponto:[{id:'p',adminId:'a',servicoId:'os',funcionarioId:'colega',data:os.data,entrada:'09:00',saida:null}],obraPontoLonga:[]};
 const ctx=vm.createContext({dados,usuarioLogado:{id:'colega',adminId:'a',role:'funcionario'},Date:Clock,_tenantId:()=> 'a',_gpsPontoAtivo:()=>false,getDataHoje:()=> '2026-10-30',perguntarSaidaObra:async()=>response,guardarDados:async()=>saved.push(JSON.stringify(dados)),_checklistSaidaVerificar:(id,cb)=>cb(),renderizarTudo:()=>calls.push('render'),renderizarAgendaObras:()=>calls.push('agenda'),renderizarPonto:()=>{},obterNomeFuncionario:()=> 'Responsável',alert:msg=>alerts.push(msg),criarFolhaDaOS:()=>calls.push('sheet'),_folhaOSPendente:null,_pausaAlmocoPendente:()=>({tipo:'os',servicoId:'os'}),pontoAssiduidadeAtivo:()=>false,pontoAbertoHoje:()=>false,_checklistEntradaVerificar:(id,cb)=>cb(),abrirSliderConfirmacao:(title,text,cb)=>{ctx.confirm=cb;},gerarId:()=> 'new',_nomeClienteOS:()=> 'Cliente'});
 vm.runInContext(fn('_osConcluidaParaFuncionario')+'\n'+fn('picarPontoOS'),ctx);
 return {ctx,os,dados,alerts,saved,calls,completed:id=>ctx._osConcluidaParaFuncionario(os,id||'colega')};
}
for(const response of ['hoje',true])test('non-responsible employee completes their own participation after '+response+' without closing the team OS',async()=>{
 const t=setup(response);await t.ctx.picarPontoOS('os','saida');assert(t.completed());assert.equal(t.os.status,'em andamento');assert(t.calls.includes('render'));assert(!t.calls.includes('sheet'));assert(t.alerts.some(s=>s.includes('participação nesta OS ficou concluída')));assert.equal(t.saved.length,1);
 const reload=JSON.parse(t.saved[0]);assert(t.ctx._osConcluidaParaFuncionario(reload.servicos[0],'colega',reload));
 await t.ctx.picarPontoOS('os','entrada');assert(!t.ctx.confirm);assert(t.alerts.at(-1).includes('já está concluída'));
});
test('lunch remains resumable and permits a new personal entry into the same OS',async()=>{
 const t=setup('almoco');await t.ctx.picarPontoOS('os','saida');assert.equal(t.dados.ponto[0].pausaAlmoco,true);assert.equal(t.completed(),false);
 await t.ctx.picarPontoOS('os','entrada');assert.equal(typeof t.ctx.confirm,'function');t.ctx.confirm();assert.equal(t.dados.ponto.length,2);assert.equal(t.dados.ponto[1].saida,null);assert.equal(t.completed(),false);
});
test('the responsible employee retains the sheet workflow and individual completion never affects another user',async()=>{
 const t=setup(true);t.ctx.usuarioLogado.id='responsavel';t.dados.ponto[0].funcionarioId='responsavel';await t.ctx.picarPontoOS('os','saida');assert(t.calls.includes('sheet'));assert.equal(t.completed('responsavel'),false);assert.equal(t.completed('colega'),false);assert.equal(t.os.status,'em andamento');
});
test('canceling the exit preserves the open intervention and availability to continue',async()=>{
 const t=setup(null);await t.ctx.picarPontoOS('os','saida');assert.equal(t.dados.ponto[0].saida,null);assert.equal(t.saved.length,0);assert.equal(t.completed(),false);
});
test('failed exit confirmation never leaves the employee completed or claims success',async()=>{
 const t=setup(true);t.ctx.guardarDados=async()=>{throw Error('offline')};await t.ctx.picarPontoOS('os','saida');assert.equal(t.dados.ponto[0].saida,null);assert.equal(t.completed(),false);assert(!t.calls.includes('sheet'));assert.match(t.alerts.at(-1),/Não foi possível confirmar/);
});
test('existing closed records survive reload while lunch, different dates, tenants and single-worker OS do not imply completion',()=>{
 const t=setup();t.dados.ponto[0].saida='12:00';t.dados.ponto[0].usadoEmFolha=true;assert(t.completed());
 for(const changes of [{pausaAlmoco:true},{data:'2026-10-29'},{adminId:'other'},{funcionarioId:'other'},{saida:null}]){
  const record={...t.dados.ponto[0],...changes};assert.equal(t.ctx._osConcluidaParaFuncionario(t.os,'colega',{ponto:[record]}),false);
 }
 assert.equal(t.ctx._osConcluidaParaFuncionario({...t.os,funcionariosIds:['colega']},'colega',t.dados),false);
 assert.equal(t.ctx._osConcluidaParaFuncionario({...t.os,data:'2026-10-31'},'colega',t.dados),false);
});
