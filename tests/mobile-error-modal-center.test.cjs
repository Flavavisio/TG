const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const styles=fs.readFileSync('styles.css','utf8');
const login=fs.readFileSync('login.html','utf8');
const index=fs.readFileSync('index.html','utf8');
const sw=fs.readFileSync('sw.js','utf8');
test('o aviso real de erro usa modalErroOverlay nos dois pontos de entrada',()=>{
 for(const [page,html] of [['login',login],['index',index]]){
  assert.match(html,/id="modalErroOverlay"/,page);
  assert.match(html,/id="modalErroMensagem"/,page);
  assert.match(html,/fecharModalErro\(\)/,page);
 }
});
test('CSS móvel sobrepõe alinhamento genérico ao topo para modais de erro',()=>{
 const old=styles.indexOf('.modal-overlay { flex-wrap:wrap; overflow-y:auto; align-items:flex-start;');
 const fixed=styles.lastIndexOf('#modalErroOverlay.modal-overlay.open');
 assert(old>0&&fixed>old,'A regra específica deve vir depois do alinhamento genérico');
 const block=styles.slice(fixed,fixed+1550);
 assert.match(block,/align-items:center!important/);
 assert.match(block,/justify-content:center!important/);
 assert.match(block,/flex-wrap:nowrap!important/);
 assert.match(block,/overflow:hidden!important/);
});
test('erro longo mantém scroll interno e altura automática e respeita safe area',()=>{
 const i=styles.lastIndexOf('#modalErroOverlay.modal-overlay.open > .modal');
 assert(i>0);
 const block=styles.slice(i,i+700);
 assert.match(block,/height:auto!important/);
 assert.match(block,/max-height:calc\(100dvh/);
 assert.match(block,/overflow-y:auto!important/);
 assert.match(styles.slice(i-650,i+700),/safe-area-inset-top/);
});
test('PWA distribui CSS corrigido no login, index e cache offline',()=>{
 const ver='styles.css?v=20261113-modal-erro-centrado';
 for(const [file,source] of [['index',index],['login',login],['sw',sw]])assert(source.includes(ver),file);
 assert(sw.includes("totalgest-release-20261113-modal-erro-center"));
});
