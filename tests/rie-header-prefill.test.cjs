const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {JSDOM,VirtualConsole}=require(process.env.JSDOM_PATH||'jsdom');
const source=fs.readFileSync('app-principal.js','utf8');
const helpers=source.slice(source.indexOf('        function _tgPrepararCabecalhoRIE'),source.indexOf('        function _tgPrepararNomeFiscalEspecialidade'));
const prepare=new Function(helpers+';return _tgPrepararCabecalhoRIE;')();
const template=Buffer.from(source.match(/RIE: "([A-Za-z0-9+/=]+)"/)[1],'base64').toString('utf8');
const msg={type:'init',numero:'RIE-505946548-001',data:'2026-11-13',nCliente:'505946548',cliente:'AGRO "Oficina" & Filhos',morada:'Rua da Oficina',numeroPorta:'12',codigoPostal:'7000-100',localidade:'Évora',empresaNome:'BM, Lda'};
function open(html){
 const errors=[],messages=[];const vc=new VirtualConsole();vc.on('jsdomError',e=>errors.push(e));
 const dom=new JSDOM(prepare(html),{runScripts:'dangerously',virtualConsole:vc,beforeParse(w){
  Object.defineProperty(w,'parent',{value:{postMessage:m=>messages.push(m)}});
  w.HTMLCanvasElement.prototype.getContext=function(){return new Proxy({canvas:this},{get:(o,k)=>o[k]||(()=>{})})};
  w.HTMLCanvasElement.prototype.toDataURL=()=>'';
 }});
 return {w:dom.window,errors,messages,close:()=>dom.window.close()};
}
const send=(s,data)=>s.w.dispatchEvent(new s.w.MessageEvent('message',{data}));
function check(s){for(const page of s.w.document.querySelectorAll('.print-page')){
 assert.equal(page.querySelector('.docNo').value,msg.numero);
 assert.equal(page.querySelector('.meta input[type=date]').value,msg.data);
 const cells=page.querySelectorAll('.client-row input');
 assert.deepEqual([...cells].map(x=>x.value),[msg.cliente,msg.morada,msg.numeroPorta,msg.codigoPostal,msg.localidade,msg.nCliente]);
}}
test('RIE fills all header fields and preserves edits and equipment across multiple pages',()=>{
 const s=open(template);try{
  send(s,msg);check(s);
  s.w.document.getElementById('cell_0_0').value='Bce120';
  for(let i=0;i<8;i++)s.w.addCol();
  assert.equal(s.w.document.querySelectorAll('.print-page').length,2);check(s);
  assert.equal(s.w.document.getElementById('cell_0_0').value,'Bce120');
  const input=s.w.document.querySelectorAll('.print-page')[1].querySelector('.client-row input');
  input.value='Cliente corrigido';input.dispatchEvent(new s.w.Event('input',{bubbles:true}));
  s.w.addCol();assert([...s.w.document.querySelectorAll('.client-row input:first-of-type')].length);
  for(const page of s.w.document.querySelectorAll('.print-page'))assert.equal(page.querySelector('.client-row input').value,'Cliente corrigido');
  assert.equal(s.errors.length,0,s.errors.map(e=>e.message).join('\n'));
 }finally{s.close()}
});
test('legacy draft with 18 units repairs empty header without rebuilding equipment or signature',()=>{
 // Generate the same script-bearing HTML snapshot as an old RIE draft.
 const original=open(template);let draft;
 try{
  for(let i=0;i<8;i++)original.w.addCol();
  original.w.document.getElementById('cell_0_0').value='Bce120';
  original.w.document.getElementById('cell_0_17').value='Bce final';
  original.w.document.getElementById('sign_cliente_nome').value='Assinatura existente';
  original.w.document.getElementById('_relBtnRascunho').click();
  draft=original.messages.find(m=>m.type==='relatorioEspecialidadeRascunho').html;
  draft=draft.replace(/<script data-tg-rie-header>[\s\S]*?<\/script>/g,'');
 }finally{original.close()}
 const s=open(draft);try{
  const signature=s.w.document.getElementById('sign_cliente');
  send(s,{...msg,type:'rieCabecalho'});check(s);
  assert.equal(s.w.document.getElementById('sign_cliente'),signature,'no DOM rebuild');
  assert.equal(s.w.document.getElementById('sign_cliente_nome').value,'Assinatura existente');
  assert.equal(s.w.document.getElementById('cell_0_17').value,'Bce final');
  s.w.addCol();check(s);
  assert(s.w.document.getElementById('cell_0_18'),'nineteenth unit');
  assert.equal(s.w.document.getElementById('cell_0_17').value,'Bce final');
  assert.equal(s.w.document.getElementById('cell_0_0').value,'Bce120');
  assert.equal(s.errors.length,0,s.errors.map(e=>e.message).join('\n'));
 }finally{s.close()}
});
test('draft header corrections are retained when missing fields are repaired',()=>{
 const s=open(template);try{
  const client=s.w.document.querySelector('.client-row input');client.value='Nome manual';
  send(s,{...msg,type:'rieCabecalho'});
  assert.equal(client.value,'Nome manual');assert.equal(s.w.document.querySelector('.docNo').value,msg.numero);
  s.w.remCol();assert.equal(s.w.document.querySelector('.client-row input').value,'Nome manual');
 }finally{s.close()}
});
