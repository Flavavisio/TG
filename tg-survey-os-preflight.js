/* Último inquérito negativo: confirmação obrigatória antes de gravar uma OS.
   O formulário OS real usa #s_cliente (input hidden), não um <select>. */
(function(){
 'use strict';
 if(window.TGSurveyOSPreflight)return;
 const MAX_AGE=120000;
 let pending=false,approval=null;
 const $=id=>document.getElementById(id);
 const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 function activeForm(){
  const overlay=$('modalOverlay');
  const client=overlay?.querySelector('#s_cliente');
  return overlay?.classList.contains('open')&&client?{overlay,client}:null;
 }
 function selected(){return String(activeForm()?.client?.value||'').trim();}
 function tenant(){
  const user=typeof usuarioLogado!=='undefined'?usuarioLogado:null;
  return user&&['admin','subadmin'].includes(user.role)?String(user.adminId||user.id):'';
 }
 async function latestNegative(id){
  const surveys=window.TGOSSurveys;
  if(!surveys?.fetchRows||!tenant())throw Error('Não foi possível verificar os inquéritos deste cliente.');
  const rows=(await surveys.fetchRows(true)).filter(r=>String(r.cliente_id)===String(id)&&r.respondido_em)
    .sort((a,b)=>String(b.respondido_em).localeCompare(String(a.respondido_em)));
  const last=rows[0],score=Number(last?.avaliacao_geral);
  return last&&Number.isInteger(score)&&score>=1&&score<=2?last:null;
 }
 function alertDialog(id,answer){
  return new Promise(resolve=>{
   const old=document.getElementById('tgNegativeSurveyBeforeOS');
   old?.remove();
   const clientName=(typeof dados==='undefined'?[]:dados.clientes||[])
     .find(c=>String(c.id)===id&&String(c.adminId)===tenant())?.nome||'este cliente';
   const modal=document.createElement('div');
   modal.id='tgNegativeSurveyBeforeOS';modal.className='tg-sat-warning';
   modal.innerHTML='<div class="tg-sat-warning-card" role="alertdialog" aria-modal="true" aria-labelledby="tgBeforeOSTitle" aria-describedby="tgBeforeOSBody">'+
    '<h3 id="tgBeforeOSTitle"><i class="fas fa-triangle-exclamation"></i> Atenção — último inquérito negativo</h3>'+
    '<p id="tgBeforeOSBody">O último inquérito preenchido pelo cliente <strong>'+esc(clientName)+'</strong> foi de caráter negativo (<strong>'+esc(answer.avaliacao_geral)+'/5</strong>).</p>'+
    '<p>Desejas continuar a registar esta OS?</p>'+
    '<div class="tg-sat-warning-actions"><button type="button" class="btn btn-outline" data-negative-cancel>Cancelar</button>'+
    '<button type="button" class="btn btn-primary" data-negative-ok>OK — Continuar</button></div></div>';
   document.body.append(modal);
   const finish=ok=>{document.removeEventListener('keydown',escHandler,true);modal.remove();resolve(ok);};
   const escHandler=e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();finish(false);}};
   document.addEventListener('keydown',escHandler,true);
   modal.querySelector('[data-negative-cancel]').addEventListener('click',()=>finish(false));
   modal.querySelector('[data-negative-ok]').addEventListener('click',()=>finish(true));
   modal.querySelector('[data-negative-cancel]').focus();
  });
 }
 function errorDialog(message){
  return new Promise(resolve=>{
   const modal=document.createElement('div');modal.className='tg-sat-warning';modal.id='tgNegativeSurveyCheckError';
   modal.innerHTML='<div class="tg-sat-warning-card" role="alertdialog" aria-modal="true">'+
    '<h3><i class="fas fa-triangle-exclamation"></i> Não foi possível verificar a satisfação</h3>'+
    '<p>'+esc(message)+'</p><p>Para evitar ignorar um inquérito negativo, verifica a ligação e tenta novamente.</p>'+
    '<div class="tg-sat-warning-actions"><button type="button" class="btn btn-primary">OK</button></div></div>';
   document.body.append(modal);
   modal.querySelector('button').addEventListener('click',()=>{modal.remove();resolve(false);});
   modal.querySelector('button').focus();
  });
 }
 async function check(id){
  const negative=await latestNegative(id);
  if(selected()!==id)return false;
  if(!negative)return true;
  if(approval?.id===id&&approval.survey===String(negative.id)&&Date.now()-approval.at<MAX_AGE)return true;
  const ok=await alertDialog(id,negative);
  if(!ok||selected()!==id)return false;
  approval={id,survey:String(negative.id),at:Date.now()};
  return true;
 }
 function intercept(e){
  const form=activeForm();if(!form||pending)return;
  const button=e.type==='click'?e.target.closest?.('button,input[type="submit"]'):null;
  if(e.type==='click'&&!button?.matches('#modalSubmitBtn,#modalForm button[type="submit"],#modalForm input[type="submit"]'))return;
  if(e.type==='submit'&&e.target!==form.overlay.querySelector('#modalForm'))return;
  const id=selected();if(!id)return;
  // An already verified click may generate a submit event; allow this one through.
  if(approval?.id===id&&approval.allowNext===true){
   if(e.type==='submit')approval.allowNext=false;
   return;
  }
  e.preventDefault();e.stopImmediatePropagation();
  pending=true;
  (async()=>{
   try{
    const proceed=await check(id);
    if(!proceed||selected()!==id||!activeForm())return;
    if(!approval||approval.id!==id)approval={id,survey:'',at:Date.now()};
    approval.allowNext=true;
    if(e.type==='click')button.click();
    else form.overlay.querySelector('#modalForm')?.requestSubmit?.();
    // Click path may not cause a submit event (custom button action).
    queueMicrotask(()=>{if(approval)approval.allowNext=false;});
   }catch(err){
    await errorDialog(err?.message||'Não foi possível carregar os inquéritos.');
   }finally{pending=false;}
  })();
 }
 document.addEventListener('click',intercept,true);
 document.addEventListener('submit',intercept,true);
 document.addEventListener('change',e=>{if(e.target?.id==='s_cliente')approval=null},true);
 document.addEventListener('tg:interface-updated',()=>{if(!activeForm())approval=null;});
 window.TGSurveyOSPreflight={latestNegative,check};
})();
