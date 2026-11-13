const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {JSDOM}=require('jsdom');
function setup(type='os',photos=Array.from({length:3},(_,i)=>({nome:'Foto '+(i+1)})),role='admin'){
 const w=new JSDOM('<!doctype html><html><body></body></html>',{url:'https://tg.example/',runScripts:'outside-only'}).window;
 w.usuarioLogado={id:role==='admin'?'a':'f',adminId:'a',role};
 w.dados={servicos:[{id:'s',adminId:'a',funcionariosIds:['f'],fotos:[...photos]}],
  assistencias:[{id:'as',adminId:'a',fotos:[...photos]}],
  obras:[{id:'w',adminId:'a',responsaveisIds:['f'],fotos:[...photos]}],encarregados:[]};
 const id=type==='os'?'s':type==='assistencia'?'as':'w',table=type==='os'?'servicos':type==='obra'?'obras':'assistencias';
 const rows={[table]:{id,fotos:[...photos]}},calls={storage:0,update:0};
 const scoped=()=>({
  select(){return this},eq(){return this},update(value){calls.update++;return this},
  single(){return Promise.resolve({data:rows[table],error:null})}
 });
 w.supa={from:()=>scoped(),storage:{from:()=>({
   createSignedUrl:async()=>({data:{signedUrl:''}}),
   upload:async()=>{calls.storage++;return {error:null}},
   remove:async()=>({})
 })}};
 w.eval(fs.readFileSync(type==='os'?'tg-os-photos.js':'tg-entity-photos.js','utf8'));
 const opened=type==='os'?w.TGOSPhotos.open(id):w.TGEntityPhotos.open(type,id);
 return {w,calls,opened,ready:()=>new Promise(r=>setTimeout(r,0)),close:()=>w.close()};
}
for(const type of ['os','assistencia','obra']){
 test(type+': máximo de três fotos desativa a câmara e a galeria',async()=>{
  const t=setup(type);try{
   assert.equal(t.opened,true);
   await t.ready();
   const buttons=t.w.document.querySelectorAll(type==='os'?'[data-photo-source]':'[data-entity-photo-source]');
   assert.equal(buttons.length,2);buttons.forEach(b=>assert.equal(b.disabled,true));
   const count=t.w.document.querySelector(type==='os'?'#tg-os-photo-count':'#tg-entity-photo-count');
   assert.equal(count.textContent,'3');
   assert.equal(t.calls.storage,0);
  }finally{t.close()}
 });
 test(type+': 2 fotografias mantêm galeria disponível e mostram 1 vaga',async()=>{
  const t=setup(type,[{nome:'A'},{nome:'B'}]);try{
   await t.ready();
   const btn=t.w.document.querySelector(type==='os'?'[data-photo-source="gallery"]':'[data-entity-photo-source="gallery"]');
   assert.equal(btn.disabled,false);
   const notice=t.w.document.querySelector(type==='os'?'#tg-os-photo-limit':'#tg-entity-photo-left');
   assert.match(notice.textContent,/[1]/);
  }finally{t.close()}
 });
}
test('assistência e obra sem registo ou de outra empresa não permitem abrir galeria',()=>{
 const w=new JSDOM('<body></body>',{url:'https://tg.example/',runScripts:'outside-only'}).window;
 w.usuarioLogado={id:'a',role:'admin',adminId:'a'};
 w.dados={assistencias:[{id:'foreign',adminId:'b'}],obras:[{id:'foreign',adminId:'b'}]};
 w.eval(fs.readFileSync('tg-entity-photos.js','utf8'));
 assert.equal(w.TGEntityPhotos.openAssistencia('foreign'),false);
 assert.equal(w.TGEntityPhotos.openObra('foreign'),false);
 w.close();
});
test('técnico tem acesso apenas às suas obras, nunca às assistências de gestão',async()=>{
 const w=new JSDOM('<body></body>',{url:'https://tg.example/',runScripts:'outside-only'}).window;
 w.usuarioLogado={id:'f',adminId:'a',role:'funcionario'};
 w.dados={assistencias:[{id:'as',adminId:'a'}],obras:[{id:'work',adminId:'a',responsaveisIds:['f']},{id:'other',adminId:'a',responsaveisIds:['x']}]};
 w.eval(fs.readFileSync('tg-entity-photos.js','utf8'));
 assert.equal(w.TGEntityPhotos.openAssistencia('as'),false);
 assert.equal(w.TGEntityPhotos.openObra('other'),false);
 assert.equal(w.TGEntityPhotos.openObra('work'),true);
 await new Promise(resolve=>setTimeout(resolve,0));
 w.close();
});
test('limite é verificado novamente no servidor e não apaga fotografias existentes',()=>{
 const os=fs.readFileSync('tg-os-photos.js','utf8'),entity=fs.readFileSync('tg-entity-photos.js','utf8');
 assert.match(os,/const MAX_PHOTOS=3/);
 assert.match(os,/if\(old.length>=MAX_PHOTOS\)/);
 assert.match(entity,/const BUCKET='relatorios-especialidade',LIMIT=3/);
 assert.match(entity,/if\(entries.length>=LIMIT\)/);
 assert.match(os,/if\(!stored\)try\{await storage\.remove/);
 assert.match(entity,/if\(!persisted\)try\{await storage\.remove/);
});

test('administrador vê atalho Fotografias nos detalhes de cada obra',async()=>{
 const w=new JSDOM('<body><div id="verObraConteudo"></div></body>',{url:'https://tg.example/',runScripts:'outside-only'}).window;
 w.usuarioLogado={id:'a',adminId:'a',role:'admin'};
 w.dados={obras:[{id:'obra1',adminId:'a',nome:'Obra 1'},{id:'obra2',adminId:'a',nome:'Obra 2'}]};
 w.abrirObraLongaDetalhe=id=>Promise.resolve(id);
 w.eval(fs.readFileSync('tg-entity-photos.js','utf8'));
 await w.abrirObraLongaDetalhe('obra1');await new Promise(resolve=>setTimeout(resolve,0));
 assert.match(w.document.querySelector('[data-tg-work-photo-shortcut]').textContent,/máx\. 3/);
 await w.abrirObraLongaDetalhe('obra2');await new Promise(resolve=>setTimeout(resolve,0));
 assert.equal(w.document.querySelectorAll('[data-tg-work-photo-shortcut]').length,1);
 w.close();
});
