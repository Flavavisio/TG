/* Illustrative public tour: no account, API requests or real customer records. */
(() => {
 'use strict';
 const demo = document.querySelector('[data-demo]');
 if (!demo) return;
 const play = demo.querySelector('[data-demo-play]');
 const seek = demo.querySelector('[data-demo-seek]');
 const stage = demo.querySelector('.tg-demo-stage');
 const chapters = [...demo.querySelectorAll('[data-demo-step]')];
 const scenes = [...demo.querySelectorAll('[data-demo-scene]')];
 let elapsed = 0, timer = null, lastTime = 0, current = -1;
 const track = name => { if (typeof window._tgRegistarEvento === 'function') window._tgRegistarEvento(name, 'demo_90s'); };
 const clock = seconds => `${String(Math.floor(seconds / 60)).padStart(2,'0')}:${String(Math.floor(seconds % 60)).padStart(2,'0')}`;
 function render() {
  const chapter = Math.min(4, Math.floor(elapsed / 18));
  demo.querySelector('[data-demo-time]').textContent = `${clock(elapsed)} / 01:30`;
  seek.value = String(Math.floor(elapsed));
  seek.setAttribute('aria-valuetext', `${Math.floor(elapsed)} de 90 segundos`);
  stage.dataset.demoPhase = String(Math.min(3, Math.floor((elapsed % 18) / 4)));
  if (chapter !== current) {
   current = chapter;
   chapters.forEach((button,i) => button.setAttribute('aria-pressed', String(i === chapter)));
   scenes.forEach((scene,i) => { scene.hidden = i !== chapter; });
   demo.querySelector('[data-demo-announcement]').textContent = `Etapa ${chapter+1} de 5: ${chapters[chapter].querySelector('strong').textContent}`;
  }
  if (elapsed === 90) stage.dataset.demoPhase = '3';
 }
 function pause() {
  if (timer !== null) window.clearInterval(timer);
  timer = null;
  play.textContent = elapsed >= 90 ? 'Rever demonstração' : elapsed > 0 ? 'Continuar' : 'Reproduzir · 90 segundos';
  play.setAttribute('aria-label', play.textContent);
 }
 play.addEventListener('click', () => {
  if (timer !== null) { pause(); return; }
  if (elapsed >= 90) elapsed = 0;
  track(elapsed === 0 ? 'demo_inicio' : 'demo_continuar');
  lastTime = performance.now();
  play.textContent = 'Pausar'; play.setAttribute('aria-label', 'Pausar demonstração');
  render();
  timer = window.setInterval(() => {
   if (!document.getElementById('tg-landing').getClientRects().length) { pause(); return; }
   const now = performance.now();
   elapsed = Math.min(90, elapsed + (now-lastTime)/1000); lastTime = now;
   render();
   if (elapsed >= 90) { pause(); track('demo_concluida'); }
  }, 200);
 });
 chapters.forEach((button,i) => button.addEventListener('click', () => {
  pause(); elapsed = i*18; render(); stage.dataset.demoPhase = '3'; pause();
 }));
 seek.addEventListener('input', () => { pause(); elapsed = Number(seek.value); render(); stage.dataset.demoPhase = '3'; pause(); });
 demo.querySelector('[data-demo-reset]').addEventListener('click', () => { pause(); elapsed = 0; render(); pause(); });
 document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
 window.addEventListener('pagehide', pause);
 render();
})();
