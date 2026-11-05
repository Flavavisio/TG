const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {JSDOM}=require('jsdom');const source=fs.readFileSync('app-principal.js','utf8');
const fn=name=>source.match(new RegExp('        function '+name+'\\([^]*?\\n        \\}'))[0];
function setup(){
 const w=new JSDOM(fs.readFileSync('login.html','utf8'),{runScripts:'outside-only'}).window;
 w.usuarioLogado={id:'a',role:'admin'};w.state={};w._dashCentralFiltroOS=null;w._servicosCarregadoDesde='2026-07-28';
 w.dados={servicos:['pendente','em andamento','stand by','por aprovar','concluído','concluido','cancelado'].map((status,i)=>({id:String(i),numeroRegisto:'OS-'+i,status,adminId:'a',funcionarioId:'f',descricao:'Trabalho '+i,data:'2026-10-28',hora:'09:00'})),funcionarios:[{id:'f',adminId:'a'}]};
 w.dados.servicos.push({id:'foreign',numeroRegisto:'OUTRA',status:'pendente',adminId:'b'});
 Object.assign(w,{_getTableState:()=>w.state,_toolbarHtml:()=>'',_tiposEspecialidadePendentes:()=>[],obterNomeCliente:()=> 'Cliente',obterNomeFuncionario:()=> 'Técnico',statusBadge:()=>'',escapeHtmlSimples:s=>s,_osTemMateriais:()=>false,_tiposTrabalhoBadgesHTML:()=>'',getDataHoje:()=> '2026-10-28'});
 w.eval("let _servicosEstadoFiltro='todos',_servicosEstadoConta='';"+['_servicosGrupoEstado','servicosFiltrarEstado','_servicosContadores','_aplicarFiltroOrdenacao','renderizarServicos'].map(fn).join('\n'));
 w.renderizarServicos();return w;
}
const count=(w,state)=>Number(w.document.querySelector(`[data-servicos-estado="${state}"] strong`).textContent);
const rows=w=>[...w.document.querySelectorAll('#tabelaServicos tr strong')].map(e=>e.textContent);
test('tabs count authorized OS and filter pending, completed and all with search',()=>{
 const w=setup();try{assert.equal(count(w,'todos'),7);assert.equal(count(w,'pendentes'),3);assert.equal(count(w,'concluidos'),2);assert(!rows(w).includes('OUTRA'));
 w.document.querySelector('[data-servicos-estado=pendentes]').onclick=()=>w.servicosFiltrarEstado('pendentes');w.document.querySelector('[data-servicos-estado=pendentes]').click();assert.equal(rows(w).length,3);
 w.servicosFiltrarEstado('standby');assert.equal(count(w,'standby'),1);assert.deepEqual(rows(w),['OS-2']);w.dados.servicos[2].status='em andamento';w.renderizarServicos();assert.equal(count(w,'standby'),0);assert.deepEqual(rows(w),[]);
 w.servicosFiltrarEstado('concluidos');assert.deepEqual(rows(w).sort(),['OS-4','OS-5']);w.state.filtro='Trabalho 4';w.renderizarServicos();assert.deepEqual(rows(w),['OS-4']);assert.equal(count(w,'concluidos'),2);
 w.state.filtro='missing';w.renderizarServicos();assert.match(w.document.getElementById('tabelaServicos').textContent,/Sem ordens/);w.state.filtro='';w.servicosFiltrarEstado('todos');assert.equal(rows(w).length,7);
 }finally{w.close();}
});
test('counts refresh on status changes, employee visibility and account switch',()=>{
 const w=setup();try{w.servicosFiltrarEstado('pendentes');w.dados.servicos[0].status='concluído';w.renderizarServicos();assert.equal(count(w,'pendentes'),2);assert.equal(rows(w).length,2);
 w.usuarioLogado={id:'f',role:'funcionario',adminId:'a'};w.renderizarServicos();assert.equal(count(w,'todos'),7);w.servicosFiltrarEstado('concluidos');assert.equal(rows(w).length,3);
 w.usuarioLogado={id:'b',role:'admin'};w.renderizarServicos();assert.equal(count(w,'todos'),1);assert.deepEqual(rows(w),['OUTRA']);assert.equal(w.document.querySelector('[data-servicos-estado=todos]').getAttribute('aria-pressed'),'true');
 w.usuarioLogado={id:'super',role:'superadmin'};w.renderizarServicos();assert.equal(count(w,'todos'),0);
 }finally{w.close();}
});
test('both entry points expose one counter group and matching versioned assets',()=>{
 const worker=fs.readFileSync('sw.js','utf8');let asset;
 for(const file of ['index.html','login.html']){const w=new JSDOM(fs.readFileSync(file,'utf8')).window;try{assert.equal(w.document.querySelectorAll('#servicosContadores').length,1);const src=w.document.querySelector('script[src^="app-principal.js?v="]').getAttribute('src');assert(worker.includes('./'+src));if(asset)assert.equal(src,asset);asset=src;assert(w.document.querySelector('link[href^="styles.css?v="]'));}finally{w.close();}}
});
function failedVisit(w,index){
 const s=w.dados.servicos[index];s.checklist={__tgVisitasSemSucesso:{tentativas:{['p'+index]:{id:'p'+index,adminId:s.adminId,tecnicoId:'f',tecnicoNome:'Técnico',registadoEm:'2026-11-05T10:00:00Z',motivo:'ausente',data:s.data,entrada:'09:00',saida:'09:15'}}}};
}
test('Por reagendar counts OS once, separates them from pending and opens the single native scheduling form',()=>{
 const w=setup();try{w.eval(fs.readFileSync('tg-unsuccessful-visits.js','utf8'));failedVisit(w,0);const s=w.dados.servicos[0];s.checklist.__tgVisitasSemSucesso.tentativas.other={...s.checklist.__tgVisitasSemSucesso.tentativas.p0,id:'other'};
 w.renderizarServicos();assert.equal(count(w,'reagendar'),1);assert.equal(count(w,'pendentes'),2);assert.equal(count(w,'todos'),7);
 w.servicosFiltrarEstado('reagendar');assert.deepEqual(rows(w),['OS-0']);assert.equal(w.document.getElementById('modalGenericoTitulo').textContent,'Agendar visita');assert(w.document.getElementById('modalGenericoOverlay').classList.contains('open'));assert.equal(w.document.getElementById('tgVisitOverlay'),null);
 s.checklist.__tgVisitasSemSucesso.resolucoes={p0:{acao:'reagendar'},other:{acao:'reagendar'}};w.renderizarServicos();assert.equal(count(w,'reagendar'),0);assert.equal(count(w,'pendentes'),3);
 }finally{w.close();}
});
test('multiple OS open a native chooser and the chosen OS opens directly for scheduling',()=>{
 const w=setup();try{w.eval(fs.readFileSync('tg-unsuccessful-visits.js','utf8'));failedVisit(w,0);failedVisit(w,1);w.renderizarServicos();w.servicosFiltrarEstado('reagendar');assert.equal(count(w,'reagendar'),2);assert.deepEqual(rows(w).sort(),['OS-0','OS-1']);assert.equal(w.document.getElementById('modalGenericoTitulo').textContent,'OS por reagendar');
 const form=w.document.getElementById('modalGenericoForm');form.elements.os.value='1';form.dispatchEvent(new w.Event('submit',{cancelable:true}));assert.equal(w.document.getElementById('modalGenericoTitulo').textContent,'Agendar visita');assert.match(form.textContent,/OS OS-1/);assert.equal(w.document.querySelectorAll('.modal-overlay.open').length,1);
 }finally{w.close();}
});
