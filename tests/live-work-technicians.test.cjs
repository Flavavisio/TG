const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {JSDOM}=require('jsdom');
const source=fs.readFileSync('tg-live-work-summary.js','utf8');
function setup(role='admin'){
 const w=new JSDOM(`<section id="secao-dashboard-central"><div class="hdc-card hdc-feed"><h4>Atividade em Tempo Real — OS de hoje</h4><div class="fi" onclick="abrirVerOS('os')"><span class="dot"></span><div><div class="tt">09:44 — Churrasqueira Jaime</div><div class="ds">Formação</div></div><span class="ago">Concluída</span></div></div></section>`,{runScripts:'outside-only'}).window;
 const d=new Date(),today=[d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');
 w.usuarioLogado=role==='admin'?{id:'a',role}:{id:'sub',adminId:'a',role};
 w.dados={funcionarios:[{id:'f1',adminId:'a',nome:'Bruno'},{id:'f2',adminId:'a',nome:'Luís'},{id:'absent',adminId:'a',nome:'Ausente'},{id:'foreign',adminId:'other',nome:'Outra empresa'}],encarregados:[{id:'e',adminId:'a',nome:'Encarregado'}],administradores:[{id:'a',nome:'António'}],clientes:[{id:'c',adminId:'a',nome:'Churrasqueira Jaime'}],servicos:[{id:'os',adminId:'a',clienteId:'c',funcionarioId:'f1',funcionariosIds:['f1','f2','absent'],status:'concluído',descricao:'Formação'}],obras:[],ponto:[],folhasObra:[],obraPontoLonga:[]};
 w.setInterval=()=>1;w.eval(source);w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
 return {w,today,job:w.dados.servicos[0]};
}
const label=w=>w.document.querySelector('[data-tgl-os-team]')?.textContent;
test('the completed OS card shows one technician then all actual participants, deduplicating morning and afternoon',()=>{
 const {w,today}=setup();try{
 w.dados.ponto=[{adminId:'a',servicoId:'os',funcionarioId:'f1',data:today,entrada:'09:44',saida:'12:00'}];w.TGLiveWorkSummary.render();assert.equal(label(w),'Técnico: Bruno');
 w.dados.ponto.push({adminId:'a',servicoId:'os',funcionarioId:'f1',data:today,entrada:'14:00',saida:'17:00'},{adminId:'a',servicoId:'os',funcionarioId:'f2',data:today,entrada:'09:44',saida:'17:00'});
 const before=JSON.stringify(w.dados);w.TGLiveWorkSummary.render();w.TGLiveWorkSummary.render();assert.equal(label(w),'Técnicos: Bruno · Luís');assert(!label(w).includes('Ausente'));assert.equal(w.document.querySelectorAll('[data-tgl-os-team]').length,1);assert.equal(JSON.stringify(w.dados),before);
 assert.equal(w.document.querySelector('.tt').textContent,'09:44 — Churrasqueira Jaime');assert.equal(w.document.querySelector('.ds').textContent,'Formação');assert.equal(w.document.querySelector('.ago').textContent,'Concluída');assert.equal(w.document.querySelector('.fi').getAttribute('onclick'),"abrirVerOS('os')");
 }finally{w.close();}
});
test('work-sheet participants supplement clock entries, including administrator and supervisor, within the same company',()=>{
 for(const role of ['admin','subadmin']){const {w,today}=setup(role);try{
 w.dados.ponto=[{adminId:'a',servicoId:'os',funcionarioId:'f1',data:today,entrada:'09:00'},{adminId:'other',servicoId:'os',funcionarioId:'foreign',data:today,entrada:'09:00'}];
 w.dados.folhasObra=[{adminId:'a',servicoId:'os',funcionarioId:'a',descricao:'Formação'},{adminId:'a',servicoId:'os',funcionarioId:'e',horasTrabalhadas:1},{adminId:'other',servicoId:'os',funcionarioId:'foreign',descricao:'Outro tenant'},{adminId:'a',servicoId:'another',funcionarioId:'absent',descricao:'Outra OS'}];
 w.TGLiveWorkSummary.render();assert.equal(label(w),'Técnicos: António · Bruno · Encarregado');
 }finally{w.close();}}
});
test('scheduled staff are explicitly identified as assigned until attendance exists; no assignment stays explicit',()=>{
 const {w,job}=setup();try{assert.equal(label(w),'Atribuídos: Ausente · Bruno · Luís');job.funcionarioId=null;job.funcionariosIds=[];w.TGLiveWorkSummary.render();assert.equal(label(w),'Sem técnico atribuído');job.funcionarioId='f2';w.TGLiveWorkSummary.render();assert.equal(label(w),'Atribuído: Luís');}finally{w.close();}
});
test('technician names are literal text, and previous account names disappear after account or role change',()=>{
 const {w,today}=setup();try{w.dados.funcionarios[0].nome='<img src=x onerror=alert(1)>';w.dados.ponto=[{adminId:'a',servicoId:'os',funcionarioId:'f1',data:today,entrada:'09:00'}];w.TGLiveWorkSummary.render();assert(label(w).includes('<img'));assert.equal(w.document.querySelectorAll('.tgl-work-team img').length,0);w.usuarioLogado={id:'other',role:'admin'};w.TGLiveWorkSummary.render();assert.equal(label(w),undefined);w.usuarioLogado={id:'f1',adminId:'a',role:'funcionario'};w.TGLiveWorkSummary.render();assert.equal(label(w),undefined);}finally{w.close();}
});
test('today clock parsing retains completed and active OS and works with all participants',()=>{
 const {w,today}=setup();try{
 w.dados.ponto=[{adminId:'a',servicoId:'os',funcionarioId:'f1',data:today,entrada:'09:44:00',saida:'10:00:00'},{adminId:'a',servicoId:'os',funcionarioId:'f2',data:today,entrada:today+'T09:45:00',saida:'10:00'},{adminId:'a',servicoId:'os',funcionarioId:'absent',data:'2000-01-01',entrada:'09:00'}];
 w.dados.obras=[{id:'work',adminId:'a',clienteId:'c',nome:'Instalação'}];w.dados.obraPontoLonga=[{adminId:'a',obraId:'work',funcionarioId:'a',data:today,entrada:'9:00'}];
 const rows=w.TGLiveWorkSummary.records();assert.equal(rows.length,2);assert.equal(rows[0].kind,'obra');assert(rows[0].active);assert.equal(rows[1].at,'09:44');assert.equal(rows[1].active,false);assert.deepEqual(Array.from(rows[1].staff,p=>p.name),['Bruno','Luís']);
 }finally{w.close();}
});
test('a normal dashboard redraw receives participant names again on the next refresh',()=>{
 const {w}=setup();try{const row=w.document.querySelector('.fi');row.querySelector('[data-tgl-os-team]').remove();assert.equal(label(w),undefined);w.TGLiveWorkSummary.render();assert.match(label(w),/Bruno/);}finally{w.close();}
});
test('both entry pages and service worker load the same version of the participant enhancement',()=>{
 for(const file of ['index.html','login.html','sw.js']){const html=fs.readFileSync(file,'utf8');assert(html.includes('tg-live-work-summary.js?v=1.1.0-technicians'),file);if(file!=='sw.js')assert.equal((html.match(/tg-live-work-summary\.js/g)||[]).length,1);}
});
