/* Grelha de ações de saída de OS e de obra. Mantém as respostas nativas intactas. */
(function(){
 'use strict';
 const $=id=>document.getElementById(id);
 function install(){
  const overlay=$('modalSimNaoOverlay'),prompt=$('modalSimNaoTexto');
  if(!overlay||!prompt||overlay.dataset.tgOsGridReady)return;
  overlay.dataset.tgOsGridReady='1';
  const pause=$('modalSimNaoAlmocoBtn'),today=$('modalSimNaoHojeBtn'),visit=$('modalSimNaoVisitaBtn'),yes=$('modalSimNaoSimTexto');
  if(!pause||!today||!visit||!yes)return;
  const title=/\bSaída da OS\b/i;
  function sync(){
   const isWork=overlay.hasAttribute('data-tgt-work-exit');
   const hasPause=!pause.hidden&&pause.style.display!=='none';
   const active=overlay.classList.contains('open')&&(isWork||title.test(prompt.textContent||'')&&hasPause);
   if(overlay.classList.contains('tg-os-exit-grid')!==active)overlay.classList.toggle('tg-os-exit-grid',active);
   if(!active){
    if(['Finalizar OS','Finalizar obra'].includes(yes.textContent.trim()))yes.textContent='Sim';
    if(today.dataset.tgOsGridLabel==='1'){
     today.innerHTML='<i class="fas fa-clipboard-list" aria-hidden="true"></i> Terminado por hoje';
     delete today.dataset.tgOsGridLabel;
    }
    const finalIcon=yes.parentElement?.querySelector('[data-tg-os-final-icon]');if(finalIcon)finalIcon.remove();
    return;
   }
   const pauseLabel=isWork?'Pausar obra':'Pausar OS';
   if(hasPause&&(!pause.querySelector('.fa-pause-circle')||!pause.textContent.includes(pauseLabel))){
    pause.innerHTML='<i data-tg-os-pause-icon class="fas fa-pause-circle" aria-hidden="true"></i><span>'+pauseLabel+'</span>';
   }
   if(today.dataset.tgOsGridLabel!=='1'||!today.querySelector('.fa-calendar-check')){
    today.innerHTML='<i class="fas fa-calendar-check" aria-hidden="true"></i><span>Finalizar por hoje</span>';
    today.dataset.tgOsGridLabel='1';
   }
   const finishLabel=isWork?'Finalizar obra':'Finalizar OS';
   if(yes.textContent.trim()!==finishLabel)yes.textContent=finishLabel;
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
