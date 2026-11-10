const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const src=fs.readFileSync('app-principal.js','utf8');
const fn=name=>{const m=src.match(new RegExp('        (?:async )?function '+name+'\\([^]*?\\n        \\}'));assert(m,name);return m[0];};
function setup(){
 const listeners=new Map(),calls=[];
 const c=vm.createContext({console:{warn(){}},Date:{now:()=>c.now},now:100000,navigator:{onLine:true},usuarioLogado:{id:'admin',adminId:'a',role:'admin'},dados:{},modal:false,central:false,agenda:false,home:true,hidden:false,pending:0,changed:['ponto'],calls,_dadosPollTimer:null,_dadosPollEmCurso:false,_dadosPollUltima:0,_dadosPollIdentidade:'',_dadosPollGeracao:0,_ultimasVersoesPorTabela:{},_ultimaVersaoConhecida:null,_falhasSyncConsecutivas:0,_avisoSyncPersistenteMostrado:false,TABELA_PARA_COLUNA:{ponto:'ponto',obra_ponto_longa:'obraPontoLonga',servicos:'servicos',folhas_obra:'folhasObra'},_tenantIdAtual:()=>c.usuarioLogado?.adminId,
 _contarAlteracoesPendentes:()=>c.pending,_tabelasQueMudaram:async()=>{calls.push('versions');c._ultimasVersoesPorTabela={ponto:'new'};return c.changed;},carregarTabelaEspecifica:async col=>{calls.push(col);},carregarDados:async()=>{calls.push('all');},guardarDados:async()=>{calls.push('save');},renderizarTudo:()=>calls.push('render'),setInterval:(cb,ms)=>{c.timer=cb;c.interval=ms;return 1;},clearInterval:()=>{c.timer=null;}});
 const surface={addEventListener:(name,cb)=>listeners.set(name,cb),removeEventListener:name=>listeners.delete(name)};
 c.window={...surface};c.document={...surface,get hidden(){return c.hidden;},getElementById:id=>id==='secao-dashboard-central'?{style:{},classList:{contains:()=>c.central}}:id==='secao-agenda-obras'?{style:{},classList:{contains:()=>c.agenda}}:id==='omeudia'?{style:{display:c.home?'block':'none'}}:null,querySelector:q=>q==='.modal-overlay.open'?(c.modal?{}:null):q==='.section-container.active'?(c.home?null:{}):null};
 vm.runInContext(['_painelAtividadeVisivel','_pollDadosGerais','_retomarPollDadosGerais','iniciarPollDadosGerais','pararPollDadosGerais'].map(fn).join('\n'),c);
 return {c,calls,listeners};
}
test('home, central dashboard and agenda refresh changed tables within the 2s cadence',async()=>{
 for(const screen of ['home','central','agenda']){const {c,calls}=setup();c.home=screen==='home';c.central=screen==='central';c.agenda=screen==='agenda';await c._pollDadosGerais();assert.deepEqual(calls,['versions','ponto','render']);calls.length=0;c.now+=1000;await c._pollDadosGerais();assert.equal(calls.length,0);c.now+=1000;await c._pollDadosGerais();assert.deepEqual(calls,['versions','ponto','render']);}
});
test('other screens and employee sessions retain the 30s cadence',async()=>{
 for(const employee of [false,true]){const {c,calls}=setup();if(employee)c.usuarioLogado.role='funcionario';else c.home=false;await c._pollDadosGerais();calls.length=0;c.now+=2000;await c._pollDadosGerais();assert.equal(calls.length,0);c.now+=28000;await c._pollDadosGerais();assert(calls.includes('versions'));}
});
test('no changes causes no table reload or interface redraw',async()=>{const {c,calls}=setup();c.changed=[];await c._pollDadosGerais();assert.deepEqual(calls,['versions']);});
test('hidden, offline, signed-out and modal states do not interrupt work',async()=>{
 for(const state of ['hidden','offline','signedout','modal']){const {c,calls}=setup();if(state==='hidden')c.hidden=true;if(state==='offline')c.navigator.onLine=false;if(state==='signedout')c.usuarioLogado=null;if(state==='modal')c.modal=true;await c._pollDadosGerais(true);assert.equal(calls.length,0);}
});
test('pending local edits are saved instead of overwritten',async()=>{const {c,calls}=setup();c.pending=1;await c._pollDadosGerais();assert.deepEqual(calls,['save']);});
test('a write starting during version read defers refresh and restores version stamps',async()=>{const {c,calls}=setup();c._tabelasQueMudaram=async()=>{c.pending=1;c._ultimasVersoesPorTabela={ponto:'new'};return ['ponto'];};await c._pollDadosGerais();assert.equal(calls.length,0);assert.equal(Object.keys(c._ultimasVersoesPorTabela).length,0);});
test('concurrent timer/focus calls share one refresh',async()=>{const {c,calls}=setup();let release;c._tabelasQueMudaram=()=>new Promise(r=>release=r);const running=c._pollDadosGerais();await c._pollDadosGerais(true);release(['ponto']);await running;assert.deepEqual(calls,['ponto','render']);});
test('failed table read retries the same version and waits for all reads',async()=>{const {c,calls}=setup();c.changed=['ponto','servicos'];c.carregarTabelaEspecifica=async col=>{calls.push(col);if(col==='ponto')throw Error('offline');};await c._pollDadosGerais();assert.equal(Object.keys(c._ultimasVersoesPorTabela).length,0);assert(!calls.includes('render'));assert.equal(c._dadosPollEmCurso,false);c.carregarTabelaEspecifica=async col=>calls.push(col);c.now+=2000;await c._pollDadosGerais();assert(calls.includes('render'));});
test('changing accounts during a request never redraws the previous account',async()=>{const {c,calls}=setup();c._tabelasQueMudaram=async()=>{c.usuarioLogado={id:'b',adminId:'b',role:'admin'};return ['ponto'];};await c._pollDadosGerais();assert.equal(calls.length,0);});
test('relation changes trigger one full reload rather than parallel full loads',async()=>{const {c,calls}=setup();c.changed=['licencas','encarregado_funcionarios','ponto'];await c._pollDadosGerais();assert.deepEqual(calls,['versions','all','render']);});
test('resume bypasses cadence, repeated start has one timer and stop removes listeners',async()=>{const {c,calls,listeners}=setup();c.iniciarPollDadosGerais();await new Promise(r=>setImmediate(r));assert.equal(c.interval,2000);assert.equal(listeners.size,3);calls.length=0;c.iniciarPollDadosGerais();listeners.get('focus')();await new Promise(r=>setImmediate(r));assert(calls.includes('versions'));c.pararPollDadosGerais();assert.equal(c._dadosPollTimer,null);assert.equal(listeners.size,0);assert.equal(c._dadosPollGeracao,1);});
test('general redraw includes the visible central dashboard so activity does not remain stale',()=>{assert.match(fn('_renderizarTudoAgora'),/if \(_secaoVisivel\('secao-dashboard-central'\)\) renderizarDashboardCentralSecao\(\)/);});
test('a late table response cannot replace local edits or data after logout',async()=>{
 for(const change of ['edit','logout']){const {c}=setup();let release;c.M={ponto:{tabela:'ponto',from:x=>x,to:x=>x}};c._snap={};c._guardarCacheLocal=()=>{};c._pontoCarregadoDesde='2026-01-01';c.supa={from:()=>({select:()=>({gte(){return this;},eq(){return this;}})})};c._buscarPaginadoGenerico=()=>new Promise(r=>release=r);c.dados.ponto=[{id:'local'}];vm.runInContext(fn('carregarTabelaEspecifica'),c);const request=c.carregarTabelaEspecifica('ponto',true);if(change==='edit')c.pending=1;else c._dadosPollGeracao++;release({data:[{id:'remote'}]});if(change==='edit')await assert.rejects(request);else await request;assert.equal(c.dados.ponto[0].id,'local');}
});


test('agenda refresh shows a confirmed lunch return when the OS status has not synced yet', async()=>{
 const {c,calls}=setup();
 c.home=false;c.agenda=true;
 const date='2026-11-10';
 const os={id:'os',adminId:'a',funcionarioId:'f',status:'pausa para almoço',data:date};
 const pausa={adminId:'a',servicoId:'os',funcionarioId:'f',data:date,entrada:'11:16:22',saida:'13:32:30',pausaAlmoco:true};
 const volta={...pausa,entrada:'13:57:06',saida:null,pausaAlmoco:false};
 c.dados={ponto:[pausa],servicos:[os]};
 c.getDataHoje=()=>date;c._tenantId=()=> 'a';c._agendaVistaObras='dia';
 c._calcularConflitos=()=>new Set();c._aplicarFiltrosAgenda=rows=>rows;
 const getElement=c.document.getElementById;
 c.document.getElementById=id=>id==='agendaObrasConteudo'?{}:getElement(id);
 let shown;
 c.renderAgendaDia=(element,rows)=>{shown=rows[0].status;};
 vm.runInContext(['_estadoOSAgenda','renderizarAgendaObras'].map(fn).join('\n'),c);
 c.renderizarTudo=()=>c.renderizarAgendaObras();
 c.renderizarTudo();
 assert.equal(shown,'pausa para almoço');
 await c._pollDadosGerais();
 c.carregarTabelaEspecifica=async col=>{assert.equal(col,'ponto');c.dados.ponto=[pausa,volta];calls.push(col);};
 c.now+=2000;
 await c._pollDadosGerais();
 assert.equal(shown,'em andamento');
 assert.equal(os.status,'pausa para almoço','display does not overwrite the stored OS');
 for(const wrong of [{adminId:'b'},{funcionarioId:'outro'},{servicoId:'outro'},{data:'2026-11-09'},{entrada:'13:30:00'},{saida:'14:30:00'}]){
  assert.equal(c._estadoOSAgenda(os,[pausa,{...volta,...wrong}],date),'pausa para almoço');
 }
 const segundaPausa={...pausa,entrada:'14:30:00',saida:'15:00:00'};
 assert.equal(c._estadoOSAgenda(os,[pausa,volta,segundaPausa],date),'pausa para almoço');
 assert.equal(c._estadoOSAgenda({...os,status:'concluído'},[pausa,volta],date),'concluído');
});
