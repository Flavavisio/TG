const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {JSDOM}=require('jsdom');
const source=fs.readFileSync('tg-os-surveys.js','utf8');
function setup(responses=[]){
 const html='<!doctype html><html><body><div id="modalGenericoOverlay" class="modal-overlay"><h2>Nova Ordem de Serviço</h2><select id="clienteOs" name="cliente"><option value="">Escolher cliente</option><option value="c1">Empresa XPTO</option><option value="c2">Outra empresa</option></select></div></body></html>';
 const w=new JSDOM(html,{url:'https://totalgest.example/',runScripts:'outside-only',pretendToBeVisual:true}).window;
 w.usuarioLogado={id:'admin',adminId:'a',role:'admin'};
 w.dados={clientes:[{id:'c1',adminId:'a',nome:'Empresa XPTO'},{id:'c2',adminId:'a',nome:'Outra empresa'}],
 servicos:[{id:'os1',adminId:'a',numeroRegisto:'123',data:'2026-11-01'},{id:'os2',adminId:'a',numeroRegisto:'126',data:'2026-11-08'}]};
 const query={select(){return this},eq(){return this},order(){return this},limit(){return Promise.resolve({data:responses,error:null})}};
 w.supa={from:()=>query};w.eval(source);
 const select=w.document.getElementById('clienteOs');
 async function choose(id){select.value=id;select.dispatchEvent(new w.Event('change',{bubbles:true}));await new Promise(resolve=>setTimeout(resolve,0));}
 return {w,select,choose,finish:()=>w.close()};
}
const survey=(id,date,rating,customer='c1',os='os1')=>({id,cliente_id:customer,servico_id:os,respondido_em:date,criado_em:date,avaliacao_geral:rating,comentario:'Feedback '+id});
test('o último inquérito negativo abre modal com OK e Cancelar',async()=>{
 const t=setup([survey('new','2026-11-12T17:00:00Z',1)]);try{
 await t.choose('c1');
 const dialog=t.w.document.querySelector('.tg-sat-warning [role=alertdialog]');
 assert(dialog);assert.match(dialog.textContent,/último inquérito negativo/i);
 assert.match(dialog.textContent,/1\/5/);
 assert(dialog.querySelector('[data-sat-ok]'));
 assert(dialog.querySelector('[data-sat-cancel]'));
 assert.equal(t.select.value,'c1');
 }finally{t.finish()}
});
test('OK mantém o cliente selecionado para continuar a registar a OS',async()=>{
 const t=setup([survey('bad','2026-11-12T17:00:00Z',2)]);try{
 await t.choose('c1');t.w.document.querySelector('[data-sat-ok]').click();
 assert.equal(t.select.value,'c1');
 assert.equal(t.w.document.querySelector('.tg-sat-warning'),null);
 assert.equal(t.w.dados.servicos.length,2);
 }finally{t.finish()}
});
test('Cancelar limpa cliente sem criar OS',async()=>{
 const t=setup([survey('bad','2026-11-12T17:00:00Z',1)]);try{
 await t.choose('c1');t.w.document.querySelector('[data-sat-cancel]').click();
 assert.equal(t.select.value,'');
 assert.equal(t.w.document.querySelector('.tg-sat-warning'),null);
 assert.equal(t.w.dados.servicos.length,2);
 }finally{t.finish()}
});
test('última resposta positiva não alerta mesmo havendo negativa antiga',async()=>{
 const t=setup([survey('negative','2026-11-01T20:00:00Z',1),survey('positive','2026-11-12T20:00:00Z',5,'c1','os2')]);try{
 await t.choose('c1');assert.equal(t.w.document.querySelector('.tg-sat-warning'),null);
 }finally{t.finish()}
});
test('última resposta negativa alerta mesmo que OS antiga tenha data mais recente',async()=>{
 const t=setup([survey('recentAnswer','2026-11-12T20:00:00Z',2,'c1','os1'),survey('oldAnswer','2026-11-07T20:00:00Z',5,'c1','os2')]);try{
 await t.choose('c1');assert(t.w.document.querySelector('.tg-sat-warning'));
 }finally{t.finish()}
});
test('inquérito neutro ou pendente não alerta',async()=>{
 for(const rating of [3,4,5]){const t=setup([survey('normal','2026-11-12T20:00:00Z',rating)]);try{
  await t.choose('c1');assert.equal(t.w.document.querySelector('.tg-sat-warning'),null);
 }finally{t.finish()}}
});
test('alteração de cliente durante resposta lenta não mostra aviso errado',async()=>{
 let finish;const t=setup();try{
 t.w.supa.from=()=>({select(){return this},eq(){return this},order(){return this},limit(){return new Promise(resolve=>{finish=()=>resolve({data:[survey('bad','2026-11-12T20:00:00Z',1)],error:null})})}});
 t.select.value='c1';t.select.dispatchEvent(new t.w.Event('change',{bubbles:true}));
 await Promise.resolve();t.select.value='c2';t.select.dispatchEvent(new t.w.Event('change',{bubbles:true}));
 finish();await new Promise(resolve=>setTimeout(resolve,0));
 assert.equal(t.w.document.querySelector('.tg-sat-warning'),null);
 }finally{t.finish()}
});
test('aviso está centrado no telemóvel',()=>{
 const css=fs.readFileSync('tg-os-surveys.css','utf8');
 assert.match(css,/\.tg-sat-warning\{[^}]*place-items:center/);
 assert.match(css,/\.tg-sat-warning-actions/);
});
