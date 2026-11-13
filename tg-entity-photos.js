/* Fotos autónomas de Assistências e Obras: máximo 3 por registo.
   A galeria usa o bucket privado com pasta por tenant e RLS das tabelas de origem. */
(function(root){
 'use strict';
 if(root.TGEntityPhotos)return;
 const BUCKET='relatorios-especialidade',LIMIT=3;
 const CONFIG={assistencia:{table:'assistencias',key:'assistencias',folder:'assistencias',title:'Assistência'},obra:{table:'obras',key:'obras',folder:'obras',title:'Obra'}};
 const $=id=>document.getElementById(id);
 let modal=null,ctx=null,busy=false,loaded=false,entries=[];
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const who=()=>typeof usuarioLogado==='undefined'?null:usuarioLogado;
 const tenant=()=>who()?.role==='admin'?who()?.id:who()?.adminId;
 function entry(kind,id){
  const me=who(),cfg=CONFIG[kind];
  if(!me||!tenant()||!cfg)return null;
  const item=(typeof dados==='undefined'?[]:dados[cfg.key]||[]).find(r=>r.id===id&&r.adminId===tenant());
  if(!item)return null;
  if(['admin','subadmin'].includes(me.role))return item;
  if(kind==='obra'&&['funcionario','encarregado'].includes(me.role)){
   const assigned=Array.isArray(item.responsaveisIds)&&item.responsaveisIds.length?item.responsaveisIds:[item.responsavelId].filter(Boolean);
   if(assigned.includes(me.id))return item;
  }
  return null;
 }
 function valid(){return !!(ctx&&who()?.id===ctx.user&&tenant()===ctx.tenant&&entry(ctx.kind,ctx.id));}
 function status(message,error=false){
  const node=$('tg-entity-photo-status');
  if(node){node.textContent=message;node.style.color=error?'#b42318':'#475569';}
 }
 function controls(){
  if(!modal)return;
  const disabled=busy||!loaded||entries.length>=LIMIT;
  modal.querySelectorAll('[data-entity-photo-source]').forEach(b=>{
   b.disabled=disabled;b.title=entries.length>=LIMIT?'Limite de 3 fotografias atingido':'';
  });
  const count=$('tg-entity-photo-count');
  if(count)count.textContent=String(entries.length);
  const left=$('tg-entity-photo-left');
  if(left)left.textContent=entries.length>=LIMIT?'Limite de 3 fotografias atingido.':'Vagas disponíveis: '+(LIMIT-entries.length);
 }
 async function fresh(){
  if(!valid()||typeof supa==='undefined')throw Error('Sessão ou ligação indisponível.');
  const table=CONFIG[ctx.kind].table;
  const r=await supa.from(table).select('id,fotos').eq('id',ctx.id).eq('admin_id',ctx.tenant).single();
  if(r.error||!r.data||!valid())throw Error('Não foi possível consultar as fotografias deste registo.');
  entries=Array.isArray(r.data.fotos)?r.data.fotos:[];
  const local=entry(ctx.kind,ctx.id);if(local)local.fotos=entries;
  loaded=true;controls();
  return entries;
 }
 async function render(){
  const list=await fresh(),holder=$('tg-entity-photo-gallery');
  if(!holder||!valid())return;
  holder.replaceChildren();
  for(const p of list){
   if(!valid())return;
   const fig=document.createElement('figure');fig.className='tg-entity-photo-thumb';
   let src='';
   const prefix=ctx.tenant+'/'+CONFIG[ctx.kind].folder+'/'+ctx.id+'/';
   if(p.bucket===BUCKET&&typeof p.storagePath==='string'&&p.storagePath.startsWith(prefix)){
    const r=await supa.storage.from(BUCKET).createSignedUrl(p.storagePath,1800);
    if(!r.error)src=r.data?.signedUrl||'';
   }
   if(src){const img=document.createElement('img');img.src=src;img.alt='Fotografia da '+CONFIG[ctx.kind].title;img.loading='lazy';fig.append(img);}
   const caption=document.createElement('figcaption');caption.textContent=p.nome||'Fotografia';fig.append(caption);holder.append(fig);
  }
 }
 function compress(file){
  return new Promise((resolve,reject)=>{
   const url=URL.createObjectURL(file),image=new Image();
   image.onload=()=>{
    try{
     const factor=Math.min(1,1600/Math.max(image.naturalWidth,image.naturalHeight));
     const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(image.naturalWidth*factor));canvas.height=Math.max(1,Math.round(image.naturalHeight*factor));
     canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);
     canvas.toBlob(b=>b?resolve(b):reject(Error('Erro ao preparar fotografia.')),'image/jpeg',.78);
    }catch(e){reject(e)}finally{URL.revokeObjectURL(url);}
   };
   image.onerror=()=>{URL.revokeObjectURL(url);reject(Error('Fotografia inválida.'));};
   image.src=url;
  });
 }
 async function add(files){
  if(busy||!valid()||!files.length)return;
  busy=true;controls();
  try{
   await fresh();
   const free=LIMIT-entries.length;
   if(files.length>free)throw Error('Só são permitidas 3 fotografias por registo. Vagas disponíveis: '+Math.max(0,free)+'.');
   for(const file of files){
    if(!valid())throw Error('A sessão mudou.');
    if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>8*1024*1024)throw Error('Apenas JPG, PNG ou WebP até 8 MB.');
    status('A guardar '+file.name+'…');
    const blob=await compress(file);
    const id=crypto.randomUUID?.()||Date.now()+'-'+Math.random().toString(36).slice(2);
    const path=ctx.tenant+'/'+CONFIG[ctx.kind].folder+'/'+ctx.id+'/'+id+'.jpg';
    const storage=supa.storage.from(BUCKET);
    const upload=await storage.upload(path,blob,{contentType:'image/jpeg',upsert:false});
    if(upload.error)throw Error('Não foi possível enviar a fotografia.');
    let persisted=false;
    try{
     await fresh();
     if(entries.length>=LIMIT)throw Error('Limite de 3 fotografias atingido.');
     const updated=[...entries,{bucket:BUCKET,storagePath:path,nome:String(file.name||'Fotografia').slice(0,90),funcionarioId:who().id,dataCriacao:Date.now()}];
     const save=await supa.from(CONFIG[ctx.kind].table).update({fotos:updated}).eq('id',ctx.id).eq('admin_id',ctx.tenant).select('id,fotos').single();
     if(save.error||!save.data)throw Error('Não foi possível associar a fotografia ao registo.');
     persisted=true;entries=Array.isArray(save.data.fotos)?save.data.fotos:updated;
     const local=entry(ctx.kind,ctx.id);if(local)local.fotos=entries;
    }finally{if(!persisted)try{await storage.remove([path]);}catch(_){}}
   }
   status('Fotografias guardadas.');await render();
  }catch(error){status(error.message||'Não foi possível guardar a fotografia.',true);}
  finally{busy=false;controls();}
 }
 function close(){if(busy)return;modal?.remove();modal=null;ctx=null;loaded=false;entries=[];}
 function open(kind,id){
  const item=entry(kind,id);if(!item||!CONFIG[kind])return false;
  if(modal){if(busy)return false;modal.remove();}
  ctx={kind,id,tenant:tenant(),user:who().id};busy=false;loaded=false;entries=[];
  const box=document.createElement('div');box.id='tg-entity-photo-modal';box.innerHTML=
   '<section class="tg-entity-photo-card" role="dialog" aria-modal="true" aria-label="Fotografias da '+esc(CONFIG[kind].title)+'">'+
   '<header><h2>Fotografias da '+esc(CONFIG[kind].title)+'</h2><button type="button" data-photo-dismiss aria-label="Fechar">×</button></header>'+
   '<p>Máximo de 3 fotografias por registo, tiradas ou escolhidas da galeria.</p>'+
   '<div class="tg-entity-photo-actions"><button type="button" data-entity-photo-source="camera">Tirar fotografia</button><button type="button" data-entity-photo-source="gallery">Escolher da galeria</button></div>'+
   '<input id="tg-entity-photo-input" type="file" accept="image/jpeg,image/png,image/webp" hidden>'+
   '<p id="tg-entity-photo-status" role="status"></p>'+
   '<p>Fotografias guardadas: <strong id="tg-entity-photo-count">0</strong> / 3 · <span id="tg-entity-photo-left"></span></p>'+
   '<div id="tg-entity-photo-gallery"></div></section>';
  box.addEventListener('click',event=>{
   if(event.target===box||event.target.closest('[data-photo-dismiss]'))return close();
   const selected=event.target.closest('[data-entity-photo-source]');
   if(!selected||busy||selected.disabled)return;
   const input=$('tg-entity-photo-input');
   if(selected.dataset.entityPhotoSource==='camera'){input.capture='environment';input.multiple=false;}
   else{input.removeAttribute('capture');input.multiple=true;}
   input.click();
  });
  box.querySelector('#tg-entity-photo-input').addEventListener('change',async event=>{
   const files=[...event.target.files];event.target.value='';await add(files);
  });
  document.body.append(box);modal=box;controls();
  render().catch(error=>status(error.message,true));
  return true;
 }
 function installWorkShortcut(){
  const original=root.abrirObraLongaDetalhe;
  if(typeof original!=='function'||original.__tgPhotoShortcut)return;
  function wrapped(...args){
   const result=original.apply(this,args);
   const id=args[0];
   Promise.resolve(result).then(()=>{
    const box=$('verObraConteudo');
    if(!box||!entry('obra',id))return;
    let btn=box.querySelector('[data-tg-work-photo-shortcut]');
    if(btn)btn.remove();
    btn=document.createElement('button');btn.type='button';
    btn.className='btn btn-outline';btn.dataset.tgWorkPhotoShortcut='true';
    btn.style.cssText='display:inline-flex;align-items:center;gap:7px;margin:8px 0;min-height:44px';
    btn.textContent='Fotografias da obra (máx. 3)';
    btn.addEventListener('click',()=>root.TGEntityPhotos?.openObra(id));
    box.prepend(btn);
   }).catch(error=>console.warn('Fotografias da obra:',error));
   return result;
  }
  wrapped.__tgPhotoShortcut=true;
  root.abrirObraLongaDetalhe=wrapped;
 }
 installWorkShortcut();
 document.addEventListener('tg:interface-updated',()=>{if(modal&&!valid())close();installWorkShortcut();});
 root.TGEntityPhotos={open,openObra:id=>open('obra',id),openAssistencia:id=>open('assistencia',id),close};
})(window);
