/* Layout 2x2 da decisão de saída da OS. Mantém as respostas nativas intactas. */
(function(){
 'use strict';
 const $=id=>document.getElementById(id);
 function install(){
  const overlay=$('modalSimNaoOverlay'),prompt=$('modalSimNaoTexto');
  if(!overlay||!prompt||overlay.dataset.tgOsGridReady)return;
  overlay.dataset.tgOsGridReady='1';
  const pause=$('modalSimNaoNaoBtn'),today=$('modalSimNaoHojeBtn'),visit=$('modalSimNaoVisitaBtn'),yes=$('modalSimNaoSimTexto');
  if(!pause||!today||!visit||!yes)return;
  const title=/\bSaída da OS\b/i;
  function sync(){
   const active=overlay.classList.contains('open')&&title.test(prompt.textContent||'');
   if(overlay.classList.contains('tg-os-exit-grid')!==active)overlay.classList.toggle('tg-os-exit-grid',active);
   if(!active){
    if(yes.textContent.trim()==='Finalizar OS')yes.textContent='Sim';
    if(today.dataset.tgOsGridLabel==='1'){
     today.innerHTML='<i class="fas fa-clipboard-list" aria-hidden="true"></i> Terminado por hoje';
     delete today.dataset.tgOsGridLabel;
    }
    const icon=pause.querySelector('[data-tg-os-pause-icon]');if(icon)icon.remove();
    const finalIcon=yes.parentElement?.querySelector('[data-tg-os-final-icon]');if(finalIcon)finalIcon.remove();
    return;
   }
   if(!pause.querySelector('[data-tg-os-pause-icon]')){
    pause.insertAdjacentHTML('afterbegin','<i data-tg-os-pause-icon class="fas fa-pause-circle" aria-hidden="true"></i> ');
   }
   if(today.dataset.tgOsGridLabel!=='1'||!today.querySelector('.fa-calendar-check')){
    today.innerHTML='<i class="fas fa-calendar-check" aria-hidden="true"></i><span>Finalizar por hoje</span>';
    today.dataset.tgOsGridLabel='1';
   }
   if(yes.textContent.trim()!=='Finalizar OS')yes.textContent='Finalizar OS';
   if(!yes.parentElement?.querySelector('[data-tg-os-final-icon]')){
    yes.insertAdjacentHTML('beforebegin','<i data-tg-os-final-icon class="fas fa-check-circle" aria-hidden="true"></i>');
   }
  }
  const observer=new MutationObserver(sync);
  observer.observe(overlay,{subtree:true,attributes:true,childList:true,characterData:true});
  sync();
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});
 else install();
})();
