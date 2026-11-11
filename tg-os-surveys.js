/* Inquéritos independentes por OS: ligação, dashboard e histórico do cliente. */
(function(){
'use strict';
if(window.TGOSSurveys)return;
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const user=()=>typeof usuarioLogado!=='undefined'?usuarioLogado:null;
const tenant=()=>['admin','subadmin'].includes(user()?.role)?String(user().adminId||user().id):null;
const records=()=>typeof dados==='undefined'?{}:dados||{};
const yes=()=>tenant()&&typeof supa!=='undefined'&&!!supa?.from;
const base=location.origin+location.pathname.replace(/[^/]*$/,'')+'inquerito-satisfacao.html?token=';
const label=n=>Number(n)<=2?'Insatisfeito':Number(n)===3?'Neutro':'Satisfeito';
const stamp=v=>v?new Date(v).toLocaleDateString('pt-PT'):'—';
let cache={owner:'',at:0,items:[]},activeOS='',warned='';
async function fetchRows(force=false){
 const t=tenant();if(!yes())return [];
 if(!force&&cache.owner===t&&Date.now()-cache.at<20000)return cache.items;
 const {data,error}=await supa.from('inqueritos_satisfacao_os').select('*').eq('admin_id',t).order('criado_em',{ascending:false}).limit(2000);
 if(error)throw error;
 cache={owner:t,at:Date.now(),items:data||[]};return cache.items;
}
function surveyUrl(row){return base+encodeURIComponent(row.token);}
function uuidToken(){
 const bytes=new Uint8Array(32);crypto.getRandomValues(bytes);return Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
}
async function linkForOS(osId){
 if(!yes())throw Error('Não tem permissões para gerar o link.');
 const os=(records().servicos||[]).find(x=>String(x.id)===String(osId)&&String(x.adminId)===tenant());
 if(!os||!os.clienteId)throw Error('OS ou cliente não encontrado.');
 const existing=(await fetchRows()).find(r=>String(r.servico_id)===String(os.id));
 if(existing){
  if(new Date(existing.expira_em).getTime()<Date.now())throw Error('O link desta OS expirou. É necessário criar um novo inquérito.');
  return existing;
 }
 const payload={admin_id:tenant(),servico_id:os.id,cliente_id:os.clienteId,token:uuidToken()};
 const {data,error}=await supa.from('inqueritos_satisfacao_os').insert(payload).select('*').single();
 if(error){
   const rows=await fetchRows(true);const other=rows.find(r=>String(r.servico_id)===String(os.id));
   if(other)return other;
   throw Error(error.message||'Não foi possível gerar o link.');
 }
 cache.at=0;return data;
}
function shareDialog(link){
 document.getElementById('tgSurveyShare')?.remove();
 const overlay=document.createElement('div');overlay.id='tgSurveyShare';overlay.className='tg-sat-warning';
 overlay.innerHTML='<div class="tg-sat-warning-card" role="dialog" aria-modal="true" aria-label="Enviar inquérito"><h3 style="color:#183b69"><i class="fas fa-star"></i> Enviar inquérito ao cliente</h3><p>Copie o link ou abra o WhatsApp para enviar o inquérito relativo a esta OS.</p><label for="tgSurveyLink">Ligação do inquérito</label><input id="tgSurveyLink" style="width:100%;padding:10px;border:1px solid #cad5e4;border-radius:8px;margin:8px 0" readonly><div style="display:flex;gap:9px;flex-wrap:wrap"><button type="button" class="btn btn-outline" data-share-copy>Copiar link</button><button type="button" class="btn btn-success" data-share-whatsapp>WhatsApp</button><button type="button" class="btn" data-share-close>Fechar</button></div></div>';
 document.body.append(overlay);const input=overlay.querySelector('#tgSurveyLink');input.value=link;
 overlay.querySelector('[data-share-close]').addEventListener('click',()=>overlay.remove());
 overlay.addEventListener('click',e=>{if(e.target===overlay)overlay.remove();});
 overlay.querySelector('[data-share-copy]').addEventListener('click',async()=>{
  try{if(navigator.clipboard?.writeText)await navigator.clipboard.writeText(link);else{input.select();if(!document.execCommand('copy'))throw Error('Cópia indisponível');}toast('Link copiado.');}
  catch(e){input.focus();input.select();toast('Selecione e copie o link apresentado.',true);}
 });
 overlay.querySelector('[data-share-whatsapp]').addEventListener('click',()=>{
  const message='Obrigado pela sua confiança. Agradecemos a sua avaliação do serviço realizado: '+link;
  window.open('https://wa.me/?text='+encodeURIComponent(message),'_blank','noopener,noreferrer');
 });
 input.focus();input.select();
}
async function copyLink(osId){
 const button=document.querySelector('[data-sat-os-button]');
 if(button)button.disabled=true;
 try{const row=await linkForOS(osId);shareDialog(surveyUrl(row));}
 catch(e){toast(e.message||'Erro ao gerar link.',true);}
 finally{if(button)button.disabled=false;}
}
function toast(message,error=false){
 let node=document.getElementById('tg-survey-toast');if(!node){node=document.createElement('div');node.id='tg-survey-toast';document.body.append(node);}
 node.textContent=message;node.className=error?'tg-survey-toast is-error':'tg-survey-toast';node.hidden=false;
 clearTimeout(window.__tgSurveyToastTimer);window.__tgSurveyToastTimer=setTimeout(()=>node.hidden=true,6500);
}
function mountOS(osId){
 if(!yes())return;
 const os=(records().servicos||[]).find(x=>String(x.id)===String(osId)&&String(x.adminId)===tenant());if(!os)return;
 const target=[...document.querySelectorAll('#modalGenericoOverlay.modal-veros,.modal-overlay.open,.modal.open,[role="dialog"][open],[role="dialog"].open,.ws-os-overlay.open,.tgm-modal.open')].filter(x=>x.offsetWidth>0||x.getClientRects().length).at(-1);
 if(!target)return;
 let host=target.querySelector('[data-survey-os-action]');
 if(host?.dataset.osId===String(osId))return;
 if(!host){host=document.createElement('div');host.className='tg-survey-actions';host.dataset.surveyOsAction='';(target.querySelector('#verOsConteudo,#modalGenericoCampos,.modal-content,.modal-body,.modal-card,.tgm-modal-content')||target).append(host);}
 host.dataset.osId=String(osId);
 host.innerHTML='<strong><i class="fas fa-star"></i> Inquérito de satisfação</strong><p>Envie um link personalizado ao cliente após a intervenção.</p><button type="button" class="btn btn-outline" data-sat-os-button>Copiar link do inquérito</button>';
 host.querySelector('button').addEventListener('click',()=>copyLink(osId));
}
function installOS(){
 if(typeof window.abrirVerOS!=='function'||window.abrirVerOS.__surveyWrapped)return;
 const original=window.abrirVerOS;
 const wrapped=function(...args){const answer=original.apply(this,args);activeOS=String(args[0]||'');setTimeout(()=>mountOS(activeOS),180);return answer;};
 wrapped.__surveyWrapped=true;window.abrirVerOS=wrapped;
}
function customerName(id){return (records().clientes||[]).find(x=>String(x.id)===String(id)&&String(x.adminId)===tenant())?.nome||'Cliente';}
function rowsForCustomer(rows,id){return rows.filter(r=>String(r.cliente_id)===String(id));}
function technician(os){return (records().funcionarios||[]).find(p=>p.id===os?.funcionarioId)?.nome||(records().encarregados||[]).find(p=>p.id===os?.funcionarioId)?.nome||'—';}
function rowHtml(r){
 const os=(records().servicos||[]).find(x=>String(x.id)===String(r.servico_id));
 const rating=r.avaliacao_geral;const mark=rating===null?'<span class="tg-sat-pill">Pendente</span>':'<span class="tg-sat-pill '+(rating<=2?'bad':'good')+'">'+rating+'/5 · '+label(rating)+'</span>';
 return '<article class="tg-sat-record"><div class="tg-sat-record-head"><strong>OS '+esc(os?.numeroRegisto||r.servico_id)+'</strong>'+mark+'</div><div class="tg-sat-record-meta">'+esc(stamp(os?.data||r.criado_em))+' · Técnico: '+esc(technician(os))+'</div>'+
 (r.respondido_em?'<div class="tg-sat-five">'+[['Técnico',r.avaliacao_tecnico],['Execução',r.avaliacao_execucao],['Pontualidade',r.avaliacao_pontualidade],['Limpeza',r.avaliacao_limpeza],['Geral',r.avaliacao_geral]].map(([k,v])=>'<span>'+k+': <b>'+v+'/5</b></span>').join('')+'</div><p>'+esc(r.comentario||'Sem comentários.')+'</p><small>Respondido em '+esc(stamp(r.respondido_em))+'</small>':'<p>A aguardar resposta do cliente.</p>')+'</article>';
}
async function openCustomer(id){
 const container=document.getElementById('wsClienteConteudo');if(!container||!yes())return;
 container.innerHTML='<div class="tg-sat-wait">A carregar avaliações do cliente…</div>';
 try{
  const rows=rowsForCustomer(await fetchRows(true),id);
  if(!container.isConnected||document.getElementById('wsClienteOverlay')?.dataset.clienteAtual!==id)return;
  const rated=rows.filter(x=>x.respondido_em);const negatives=rated.filter(x=>x.avaliacao_geral<=2);
  container.innerHTML='<section class="tg-sat-client"><header><div><small>FICHA DO CLIENTE</small><h2>Satisfação</h2><p>'+esc(customerName(id))+'</p></div><span>'+rated.length+' avaliações · '+negatives.length+' negativas</span></header>'+
  (rows.length?rows.map(rowHtml).join(''):'<p>Este cliente ainda não tem inquéritos de satisfação associados a OS.</p>')+'</section>';
 }catch(e){container.innerHTML='<p class="tg-sat-error">Não foi possível consultar a satisfação. '+esc(e.message)+'</p>';}
}
let tabObservedOverlay=null;
let tabObserver=null;
function observeClientNavigation(){
 const overlay=document.getElementById('wsClienteOverlay');
 if(!overlay||overlay===tabObservedOverlay)return;
 tabObserver?.disconnect();
 tabObservedOverlay=overlay;
 tabObserver=new MutationObserver(mutations=>{
  // Executa no microtask da alteração do DOM, antes do próximo desenho.
  if(!tenant()||!overlay.isConnected||!overlay.classList.contains('open'))return;
  if(!mutations.some(m=>m.type==='childList'&&(m.addedNodes.length||m.removedNodes.length)))return;
  if(!overlay.querySelector('[data-tg-survey-tab]'))injectCustomerTab();
 });
 tabObserver.observe(overlay,{childList:true,subtree:true});
}
function injectCustomerTab(){
 const overlay=document.getElementById('wsClienteOverlay');if(!overlay||!tenant())return;
 observeClientNavigation();
 const buttons=[...overlay.querySelectorAll('button,[role="tab"]')];
 const summary=buttons.find(x=>/^(resumo|visão geral)$/i.test(x.textContent.trim())||x.dataset.aba==='resumo');
 const history=buttons.find(x=>/^hist[oó]rico$/i.test(x.textContent.trim())||x.dataset.aba==='historico');
 const reference=summary||history;if(!reference||overlay.querySelector('[data-tg-survey-tab]'))return;
 const tab=document.createElement('button');tab.type='button';tab.className=reference.className;tab.dataset.tgSurveyTab='';tab.dataset.aba='satisfacao';tab.innerHTML='<i class="fas fa-star"></i> Satisfação';
 if(overlay.dataset.abaAtual==='satisfacao')tab.classList.add('ativo','active');
 if(summary)summary.after(tab);else history.before(tab);
 tab.addEventListener('click',event=>{
  event.preventDefault();event.stopPropagation();
  const id=overlay.dataset.clienteAtual;if(!id)return;
  overlay.dataset.abaAtual='satisfacao';
  buttons.forEach(x=>x.classList.remove('ativo','active'));tab.classList.add('ativo','active');
  openCustomer(id);
 });
}
async function dashboard(){
 if(!yes())return;
 const parent=document.getElementById('hdcSatisfacao');if(!parent||!parent.isConnected)return;
 let mount=document.getElementById('tgOsSatisfactionDashboard');
 if(!mount){mount=document.createElement('div');mount.id='tgOsSatisfactionDashboard';parent.append(mount);}
 try{
  const rated=(await fetchRows()).filter(r=>r.respondido_em);
  const neg=rated.filter(r=>r.avaliacao_geral<=2).sort((a,b)=>String(b.respondido_em).localeCompare(String(a.respondido_em)));
  const avg=rated.length?(rated.reduce((acc,r)=>acc+Number(r.avaliacao_geral),0)/rated.length).toFixed(1).replace('.',','):'—';
  mount.innerHTML='<h5>Inquéritos enviados por OS</h5><div class="tg-sat-metrics"><span><b>'+rated.length+'</b> respostas</span><span><b>'+avg+'</b> média / 5</span><span class="'+(neg.length?'negative':'')+'"><b>'+neg.length+'</b> negativas</span></div>'+
  (neg.length?'<details><summary>Ver últimas avaliações negativas</summary>'+neg.slice(0,8).map(r=>'<p><strong>'+esc(customerName(r.cliente_id))+'</strong> · '+r.avaliacao_geral+'/5 · '+esc(stamp(r.respondido_em))+'<br>'+esc(r.comentario||'Sem comentário')+'</p>').join('')+'</details>':'');
 }catch(e){mount.textContent='Não foi possível atualizar os inquéritos.';}
}
async function warnCustomer(id){
 if(!yes()||!id||id===warned)return;
 try{
  const services=new Map((records().servicos||[]).filter(s=>String(s.adminId)===tenant()).map(s=>[String(s.id),s]));
  const responses=(await fetchRows()).filter(r=>String(r.cliente_id)===String(id)&&r.respondido_em).sort((a,b)=>{
   const date=r=>String(services.get(String(r.servico_id))?.data||r.criado_em||'');
   return date(b).localeCompare(date(a))||String(b.respondido_em).localeCompare(String(a.respondido_em));
  });
  const last=responses[0];if(!last||last.avaliacao_geral>2)return;
  warned=id;
  const os=(records().servicos||[]).find(s=>String(s.id)===String(last.servico_id));
  const box=document.createElement('div');box.className='tg-sat-warning';box.innerHTML='<div class="tg-sat-warning-card" role="alertdialog" aria-modal="true"><h3><i class="fas fa-triangle-exclamation"></i> Cliente insatisfeito na última intervenção</h3><p><strong>'+esc(customerName(id))+'</strong> avaliou a última intervenção com <strong>'+last.avaliacao_geral+'/5</strong>.</p><p>OS '+esc(os?.numeroRegisto||last.servico_id)+' · '+esc(stamp(last.respondido_em))+'</p><p>'+esc(last.comentario||'O cliente não deixou comentários.')+'</p><button type="button" class="btn btn-primary">Compreendi — continuar a OS</button></div>';document.body.append(box);
  const dismiss=()=>box.remove();box.querySelector('button').addEventListener('click',dismiss);box.addEventListener('click',e=>{if(e.target===box)dismiss();});
 }catch(e){console.warn('Satisfação: falha a consultar alerta',e);}
}
function watchCustomerSelect(event){
 if(!tenant())return;
 const target=event.target;if(!(target instanceof HTMLSelectElement))return;
 const id=(target.id||'')+' '+(target.name||'');if(!/cliente/i.test(id)||/filtro|pesquisa/i.test(id))return;
 const value=target.value;if(!(records().clientes||[]).some(c=>String(c.id)===value))return;
 const nearby=target.closest('.modal-overlay,.modal,[role="dialog"],.section-container');
 const text=nearby?.textContent?.slice(0,700)||'';
 if(!/nova ordem|nova os|criar os|ordem de servi|novo servi/i.test(text)&&!target.closest('#modalGenericoOverlay,[id*=modalServ],[id*=modalOS]'))return;
 warned='';warnCustomer(value);
}
let ticking=false;
function refresh(){
 if(ticking)return;ticking=true;setTimeout(()=>{ticking=false;installOS();injectCustomerTab();if(activeOS)mountOS(activeOS);if(document.getElementById('hdcSatisfacao')&&!document.getElementById('tgOsSatisfactionDashboard'))dashboard();},200);
}
document.addEventListener('change',watchCustomerSelect,true);
document.addEventListener('tg:interface-updated',()=>{cache.at=0;refresh();dashboard();});
document.addEventListener('click',event=>{
 if(event.target.closest('[data-tg-survey-tab]'))return;
 const action=event.target.closest('button,a,[role="button"]');
 if(action&&/nova os|nova ordem de servi|criar ordem de servi|novo servi/i.test((action.textContent||'').trim())){
  warned='';
  setTimeout(()=>{
   const selectors=[...document.querySelectorAll('select[id*="cliente" i],select[name*="cliente" i]')];
   const visible=selectors.filter(el=>el.getClientRects().length&&el.value&&(records().clientes||[]).some(c=>String(c.id)===String(el.value)));
   const last=visible.at(-1);if(last)warnCustomer(last.value);
  },450);
 }
 // Não esperar pelo timeout do clique: o observador repõe o separador antes do paint.
 observeClientNavigation();
 setTimeout(refresh,0);
});
document.addEventListener('DOMContentLoaded',()=>{
 observeClientNavigation();
 refresh();
 setInterval(()=>{if(tenant()){installOS();injectCustomerTab();}if(document.getElementById('hdcSatisfacao'))dashboard();},60000);
});
window.TGOSSurveys={linkForOS,copyLink,openCustomer,fetchRows,dashboard,warnCustomer};
})();
