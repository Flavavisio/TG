const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {JSDOM}=require('jsdom');
const script=fs.readFileSync('tg-os-exit-grid.js','utf8');
const css=fs.readFileSync('tg-os-exit-grid.css','utf8');
function setup(){
 const w=new JSDOM(`<!doctype html><html><body class="tgt-active"><div class="modal-overlay" id="modalSimNaoOverlay"><div class="modal">
 <button type="button" onclick="_modalSimNaoResponder(null)">×</button>
 <p id="modalSimNaoTexto">Outro aviso</p>
 <div style="display:flex;gap:8px;flex-wrap:wrap;">
 <button id="modalSimNaoNaoBtn" onclick="_modalSimNaoResponder(false)">Não</button>
 <button id="modalSimNaoAlmocoBtn" style="display:none" onclick="_modalSimNaoResponder('almoco')">Pausa almoço</button>
 <button id="modalSimNaoHojeBtn" style="display:none" onclick="_modalSimNaoResponder('hoje')"><i class="fas fa-clipboard-list"></i> Terminado por hoje</button>
 <button id="modalSimNaoVisitaBtn" style="display:none" onclick="_modalSimNaoResponder('sem_sucesso')"><i class="fas fa-calendar-xmark"></i> Visita sem sucesso</button>
 <button class="btn btn-success" onclick="_modalSimNaoResponder(true)"><span id="modalSimNaoSimTexto">Sim</span></button>
 </div></div></div></body></html>`,{url:'https://tg.example/',runScripts:'outside-only'}).window;
 w.eval(script);
 w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
 const root=w.document.getElementById('modalSimNaoOverlay'),title=w.document.getElementById('modalSimNaoTexto');
 const next=()=>new Promise(resolve=>setTimeout(resolve,0));
 async function os(){
  title.textContent='Saída da OS #OS-VA1113-2.\nO que pretendes fazer?';
  w.document.getElementById('modalSimNaoNaoBtn').textContent='Não';
  w.document.getElementById('modalSimNaoAlmocoBtn').style.display='block';
  w.document.getElementById('modalSimNaoAlmocoBtn').innerHTML='<i class="fas fa-pause"></i> Pausar OS';
  w.document.getElementById('modalSimNaoVisitaBtn').style.display='block';
  w.document.getElementById('modalSimNaoHojeBtn').style.display='block';
  w.document.getElementById('modalSimNaoSimTexto').textContent='Sim, terminei a obra e quero finalizar';
  root.classList.add('open');
  await next();
 }
 return {w,root,title,next,os,close:()=>w.close()};
}
test('OS: 4 cartões visíveis, nomes e ícones corretos no modal 2x2',async()=>{
 const t=setup();try{
  await t.os();
  assert(t.root.classList.contains('tg-os-exit-grid'));
  assert.match(t.w.document.getElementById('modalSimNaoAlmocoBtn').textContent,/Pausar OS/);
  assert.equal(t.w.document.getElementById('modalSimNaoNaoBtn').textContent,'Não');
  assert.match(css,/#modalSimNaoNaoBtn\{display:none!important\}/);
  assert(t.w.document.querySelector('#modalSimNaoAlmocoBtn [data-tg-os-pause-icon].fa-pause-circle'));
  assert.match(t.w.document.getElementById('modalSimNaoVisitaBtn').textContent,/Visita sem sucesso/);
  assert(t.w.document.querySelector('#modalSimNaoVisitaBtn .fa-calendar-xmark'));
  assert.match(t.w.document.getElementById('modalSimNaoHojeBtn').textContent,/Finalizar por hoje/);
  assert(t.w.document.querySelector('#modalSimNaoHojeBtn .fa-calendar-check'));
  assert.equal(t.w.document.getElementById('modalSimNaoSimTexto').textContent,'Finalizar OS');
  assert(t.w.document.querySelector('[data-tg-os-final-icon].fa-check-circle'));
 }finally{t.close();}
});
test('OS: os quatro cliques mantêm as respostas originais',async()=>{
 const t=setup();try{
  await t.os();
  const ids=['modalSimNaoAlmocoBtn','modalSimNaoVisitaBtn','modalSimNaoHojeBtn'];
  assert.match(t.w.document.getElementById(ids[0]).getAttribute('onclick'),/almoco/);
  assert.match(t.w.document.getElementById('modalSimNaoNaoBtn').getAttribute('onclick'),/false/);
  assert.match(t.w.document.getElementById(ids[1]).getAttribute('onclick'),/sem_sucesso/);
  assert.match(t.w.document.getElementById(ids[2]).getAttribute('onclick'),/hoje/);
  assert.match(t.w.document.querySelector('#modalSimNaoOverlay .btn-success').getAttribute('onclick'),/true/);
  assert.match(css,/grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  for(const [id,position] of [['modalSimNaoAlmocoBtn','grid-column:1;grid-row:1'],['modalSimNaoVisitaBtn','grid-column:2;grid-row:1'],['modalSimNaoHojeBtn','grid-column:1;grid-row:2']]){
   assert(css.includes('#'+id));assert(css.includes(position));
  }
  assert.match(css,/grid-column:2;grid-row:2/);
 }finally{t.close();}
});
test('outros modais mantêm layout normal e textos originais ao fechar',async()=>{
 const t=setup();try{
  t.root.classList.add('open');await t.next();
  assert(!t.root.classList.contains('tg-os-exit-grid'));
  await t.os();
  t.root.classList.remove('open');
  t.title.textContent='Queres mesmo eliminar este registo?';
  await t.next();
  assert(!t.root.classList.contains('tg-os-exit-grid'));
  assert.equal(t.w.document.getElementById('modalSimNaoSimTexto').textContent,'Sim');
  assert.match(t.w.document.getElementById('modalSimNaoHojeBtn').textContent,/Terminado por hoje/);
  assert(!t.root.classList.contains('tg-os-exit-grid'));
  assert.equal(t.w.document.getElementById('modalSimNaoNaoBtn').textContent,'Não');
  assert.equal(t.w.document.querySelectorAll('[data-tg-os-final-icon]').length,0);
 }finally{t.close();}
});
test('visita e hoje ocultos não são forçados a aparecer noutras perguntas',()=>{
 for(const id of ['modalSimNaoVisitaBtn','modalSimNaoHojeBtn'])assert(css.includes('#'+id+':not([style*="display: none"]):not([style*="display:none"])'));
 assert.match(css,/\.tg-os-exit-grid/);
});
test('index, login e PWA incluem grelha e cache atualizada',()=>{
 for(const path of ['index.html','login.html','sw.js']){
  const s=fs.readFileSync(path,'utf8');
  assert(s.includes('tg-os-exit-grid.js?v=1.0.1-native-pause'),path);
  assert(s.includes('tg-os-exit-grid.css?v=1.0.1-native-pause'),path);
 }
 assert(fs.readFileSync('sw.js','utf8').includes('totalgest-release-20261113-os-exit-grid-native-pause'));
});

test('modal com pausa nativa escondida não cria cinco cartões nem desloca Não para pausa',async()=>{
 const t=setup();try{
  await t.os();
  t.w.document.getElementById('modalSimNaoAlmocoBtn').style.display='none';
  await t.next();
  assert(!t.root.classList.contains('tg-os-exit-grid'));
  assert.equal(t.w.document.getElementById('modalSimNaoNaoBtn').textContent,'Não');
 }finally{t.close()}
});
