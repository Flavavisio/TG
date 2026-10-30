const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {JSDOM}=require('jsdom');
const src=fs.readFileSync('app-principal.js','utf8');
const names=['_inicioTempoServico','_formatarTempoServico','_tempoServicoHTML','_tempoAcumuladoServicoHTML','_atualizarTemposServico','_htmlResumoEquipaHoje','atualizarRelogio'];
const functions=names.map(name=>{const m=src.match(new RegExp('        function '+name+'\\([^]*?\\n        \\}'));assert(m,name);return m[0];}).join('\n');
function setup(){
 const dom=new JSDOM('<input id="draft" value="Texto por guardar"><div id="panel"></div>',{pretendToBeVisual:true});
 let now=new Date('2026-10-30T16:00:00').getTime();
 class Clock extends Date {constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}}
 const dados={servicos:[{id:'os',adminId:'a',data:'2026-10-30',hora:'11:43',clienteId:'c',funcionariosIds:['v','f'],status:'em andamento'}],obras:[],ponto:[],obraPontoLonga:[]};
 const ctx=vm.createContext({Date:Clock,document:dom.window.document,dados,obterNomeFuncionario:id=>({v:'Vanda Ribeiro',f:'Flávio Rosa'}[id]||id),obterNomeCliente:()=> 'Churrasqueira Jaime',escapeHtmlSimples:s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),_kmPercorridosOS:()=>0});
 vm.runInContext(functions,ctx);
 return {ctx,dados,document:dom.window.document,advance:ms=>now+=ms,close:()=>dom.window.close()};
}
const entry=(id,entrada,extra={})=>({id,funcionarioId:id,adminId:'a',servicoId:'os',data:'2026-10-30',entrada,saida:'',...extra});
test('service clocks use each actual entry, not the planned OS start, and survive reload',()=>{
 const t=setup();try{
  t.dados.ponto=[entry('v','15:55'),entry('f','15:20')];
  const html=t.ctx._htmlResumoEquipaHoje('a','2026-10-30');t.document.getElementById('panel').innerHTML=html;
  const people=[...t.document.querySelectorAll('.tgm-resumo-pessoa')];assert.equal(people.length,2);
  assert.match(people[0].textContent,/Vanda Ribeiro.*00h 05m 00s/);assert.match(people[1].textContent,/Flávio Rosa.*00h 40m 00s/);
  t.advance(61000);assert.match(t.ctx._htmlResumoEquipaHoje('a','2026-10-30'),/00h 06m 01s/);
 }finally{t.close();}
});
test('one second tick changes clock text only, preserving focused fields and DOM nodes',()=>{
 const t=setup();try{
  t.document.getElementById('panel').innerHTML=t.ctx._tempoServicoHTML(entry('v','15:55'));
  const timer=t.document.querySelector('[data-tempo-servico]'),draft=t.document.getElementById('draft');draft.focus();draft.value='Alteração em curso';
  t.advance(1000);t.ctx.atualizarRelogio();assert.equal(timer.textContent,'00h 05m 01s');assert.equal(t.document.activeElement,draft);assert.equal(draft.value,'Alteração em curso');assert.equal(t.document.querySelector('[data-tempo-servico]'),timer);
 }finally{t.close();}
});
test('closed entries and assigned colleagues without entry never acquire a running clock',()=>{
 const t=setup();try{
  t.dados.ponto=[entry('v','09:00',{saida:'12:00'})];
  assert(!t.ctx._htmlResumoEquipaHoje('a','2026-10-30').includes('data-tempo-servico'));
  assert.equal(t.ctx._tempoServicoHTML(t.dados.ponto[0]),'');
  t.dados.ponto.push(entry('v','15:55'));const html=t.ctx._htmlResumoEquipaHoje('a','2026-10-30');assert.equal((html.match(/data-tempo-servico=/g)||[]).length,1);assert.match(html,/03h 05m 00s/);
 }finally{t.close();}
});
test('active works have personal clocks, tenant isolation and the native work detail link',()=>{
 const t=setup();try{
  t.dados.obras=[{id:'w',adminId:'a',nome:'Obra central',responsaveisIds:['v']}];
  t.dados.obraPontoLonga=[entry('v','14:00',{servicoId:null,obraId:'w'}),entry('f','13:00',{adminId:'other',servicoId:null,obraId:'w'})];
  t.dados.ponto=[entry('f','12:00',{adminId:'other'})];
  const html=t.ctx._htmlResumoEquipaHoje('a','2026-10-30');assert.match(html,/abrirObraLongaDetalhe\('w'\)/);assert.match(html,/Tempo em obra:.*02h 00m 00s/);assert.equal((html.match(/data-tempo-servico=/g)||[]).length,1);
 }finally{t.close();}
});
test('elapsed time handles midnight, long sessions, future and invalid entries without negative values',()=>{
 const t=setup();try{
  assert.match(t.ctx._tempoServicoHTML(entry('v','23:30',{data:'2026-10-29'})),/16h 30m 00s/);
  assert.match(t.ctx._tempoServicoHTML(entry('v','15:55',{data:'2026-10-28'})),/48h 05m 00s/);
  assert.match(t.ctx._tempoServicoHTML(entry('v','17:00')),/00h 00m 00s/);
  for(const p of [null,entry('v','99:00'),entry('v','bad'),entry('v','15:55',{data:''})])assert.equal(t.ctx._tempoServicoHTML(p),'');
 }finally{t.close();}
});
test('rendering and ticking never mutate attendance or write to the server',()=>{
 const t=setup();try{t.dados.ponto=[entry('v','15:55')];const before=JSON.stringify(t.dados);for(let i=0;i<5;i++){t.document.getElementById('panel').innerHTML=t.ctx._htmlResumoEquipaHoje('a','2026-10-30');t.advance(1000);t.ctx.atualizarRelogio();}assert.equal(JSON.stringify(t.dados),before);}finally{t.close();}
});

test('a visible team row switches to red Faltou when the entry tolerance expires without a data reload',()=>{
 const t=setup();try{
  t.ctx.getDataHoje=()=> '2026-10-30';
  for(const name of ['_funcionarioAusenteEm','_estadoPresencaPessoa'])vm.runInContext(src.match(new RegExp('        function '+name+'\\([^]*?\\n        \\}'))[0],t.ctx);
  t.dados.administradores=[{id:'a',horaEntradaHabitual:'16:00',toleranciaAtrasoMin:15}];t.dados.funcionarios=[{id:'v',adminId:'a'}];
  t.document.getElementById('panel').innerHTML='<div data-presenca-funcionario="v"><span class="tgm-equipa-dot"></span><span class="tgm-equipa-estado"></span></div>';
  t.ctx.atualizarRelogio();assert.equal(t.document.querySelector('.tgm-equipa-estado').textContent,'Ainda não começou');
  t.advance(16*60000);t.ctx.atualizarRelogio();assert.equal(t.document.querySelector('.tgm-equipa-estado').textContent,'Faltou');assert.equal(t.document.querySelector('.tgm-equipa-estado').style.color,'rgb(220, 38, 38)');
 }finally{t.close();}
});

test('finished OS retains each personal total including earlier work, used sheets and lunch intervals',()=>{
 const t=setup();try{
  t.dados.servicos[0].status='concluído';
  t.dados.ponto=[entry('v','09:00',{saida:'12:00',pausaAlmoco:true,usadoEmFolha:true}),entry('v','13:00',{saida:'15:00',usadoEmFolha:true}),entry('f','10:00',{saida:'11:30'})];
  t.document.getElementById('panel').innerHTML=t.ctx._htmlResumoEquipaHoje('a','2026-10-30');
  const people=t.document.querySelectorAll('.tgm-resumo-pessoa');assert.match(people[0].textContent,/Vanda Ribeiro.*Tempo na OS: 05h 00m 00s/);assert.match(people[1].textContent,/Flávio Rosa.*Tempo na OS: 01h 30m 00s/);assert.equal(t.document.querySelectorAll('[data-tempo-servico]').length,0);
  t.advance(60000);t.ctx.atualizarRelogio();assert.match(people[0].textContent,/05h 00m 00s/);
 }finally{t.close();}
});
test('accumulated counter resumes after lunch without counting the break and freezes after final exit',()=>{
 const t=setup();try{
  t.dados.ponto=[entry('v','09:00',{saida:'12:00',pausaAlmoco:true}),entry('v','15:55')];
  t.document.getElementById('panel').innerHTML=t.ctx._htmlResumoEquipaHoje('a','2026-10-30');const timer=t.document.querySelector('[data-tempo-servico]');assert.equal(timer.textContent,'03h 05m 00s');
  t.advance(1000);t.ctx.atualizarRelogio();assert.equal(timer.textContent,'03h 05m 01s');
  t.dados.ponto[1].saida='16:00';const html=t.ctx._htmlResumoEquipaHoje('a','2026-10-30');assert.match(html,/03h 05m 00s/);assert(!html.includes('data-tempo-servico='));
 }finally{t.close();}
});
