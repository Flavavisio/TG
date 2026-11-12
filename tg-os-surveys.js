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
 host.innerHTML='<strong><i class="fas fa-star"></i> Inquérito de satisfação</strong><p>Envie um link personalizado ao cliente após a intervenção.</p><button type="button" class="btn btn-outline" data-sat-os-button>Enviar inquérito</button><button type="button" class="btn btn-outline" data-sat-view-response disabled>Ver resposta</button><small data-sat-os-state>Inquérito respondido: Não</small>';
 host.querySelector('[data-sat-os-button]').addEventListener('click',()=>copyLink(osId));
 host.querySelector('[data-sat-view-response]').addEventListener('click',()=>showOSResponse(osId));
 fetchRows(true).then(rows=>{
  if(!host.isConnected||host.dataset.osId!==String(osId))return;
  const row=rows.find(r=>String(r.servico_id)===String(osId));
  const answered=!!row?.respondido_em;
  host.querySelector('[data-sat-os-state]').textContent='Inquérito respondido: '+(answered?'Sim':'Não');
  host.querySelector('[data-sat-view-response]').disabled=!answered;
  host.querySelector('[data-sat-os-button]').disabled=answered;
  host.querySelector('[data-sat-os-button]').textContent=answered?'Já respondido':'Enviar inquérito';
 }).catch(()=>{if(host.isConnected)host.querySelector('[data-sat-os-state]').textContent='Não foi possível consultar o estado';});
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
function showOSResponse(osId){
 if(!tenant())return;
 const os=(records().servicos||[]).find(x=>String(x.id)===String(osId)&&String(x.adminId)===tenant());
 if(!os)return;
 const overlay=document.createElement('div');overlay.className='tg-sat-warning';overlay.id='tgOsSurveyResponse';
 const frame=document.createElement('div');frame.className='tg-sat-warning-card tg-sat-response-dialog';
 frame.setAttribute('role','dialog');frame.setAttribute('aria-modal','true');frame.setAttribute('aria-label','Resposta ao inquérito da OS');
 frame.innerHTML='<h3 style="color:#173b68"><i class="fas fa-star"></i> Inquérito da OS '+esc(os.numeroRegisto||os.id)+'</h3><div data-os-survey-response><p>A carregar resposta do cliente…</p></div><button type="button" class="btn btn-outline" data-os-survey-close>Fechar</button>';
 overlay.append(frame);document.getElementById('tgOsSurveyResponse')?.remove();document.body.append(overlay);
 const close=()=>overlay.remove();
 frame.querySelector('[data-os-survey-close]').addEventListener('click',close);
 overlay.addEventListener('click',e=>{if(e.target===overlay)close();});
 fetchRows(true).then(rows=>{
  if(!overlay.isConnected)return;
  const row=rows.find(r=>String(r.servico_id)===String(os.id));
  const target=frame.querySelector('[data-os-survey-response]');
  target.innerHTML=row?.respondido_em?rowHtml(row):'<p>O inquérito ainda não foi respondido.</p>';
 }).catch(()=>{if(overlay.isConnected)frame.querySelector('[data-os-survey-response]').textContent='Não foi possível carregar a resposta.';});
}
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
const surveyQuestions=[
 ['avaliacao_tecnico','Atendimento e profissionalismo do técnico'],
 ['avaliacao_execucao','Qualidade da execução do serviço ou obra'],
 ['avaliacao_pontualidade','Pontualidade e cumprimento dos horários'],
 ['avaliacao_limpeza','Organização e limpeza no final da intervenção'],
 ['avaliacao_geral','Satisfação geral com o serviço']
];
async function expandSurveyDashboard(){
 if(!yes())return;
 document.getElementById('tgSurveyDashboardModal')?.remove();
 const overlay=document.createElement('div');
 overlay.id='tgSurveyDashboardModal';overlay.className='tg-sat-warning tg-os-survey-modal';
 const panel=document.createElement('div');
 panel.className='tg-os-survey-modal-panel';
 panel.setAttribute('role','dialog');panel.setAttribute('aria-modal','true');
 panel.setAttribute('aria-label','Detalhes de satisfação dos inquéritos');
 panel.innerHTML='<header><div><small>INQUÉRITOS DAS ORDENS DE SERVIÇO</small><h2>Satisfação dos Inquéritos</h2><p>Classificações de cada pergunta, exclusivamente de inquéritos respondidos por link.</p></div><button type="button" data-survey-modal-close aria-label="Fechar">✕</button></header><div data-survey-modal-content> A carregar avaliações… </div>';
 overlay.append(panel);document.body.append(overlay);
 const close=()=>{document.removeEventListener('keydown',escape);overlay.remove();};
 panel.querySelector('[data-survey-modal-close]').addEventListener('click',close);
 overlay.addEventListener('click',e=>{if(e.target===overlay)close();});
 const escape=e=>{if(e.key==='Escape')close();};
 document.addEventListener('keydown',escape);
 panel.querySelector('[data-survey-modal-close]').focus();
 try{
  const rows=(await fetchRows(true)).filter(r=>r.respondido_em);
  if(!overlay.isConnected)return;
  const content=panel.querySelector('[data-survey-modal-content]');
  const averages=surveyQuestions.map(([key,title])=>{
   const valid=rows.map(r=>Number(r[key])).filter(n=>Number.isInteger(n)&&n>=1&&n<=5);
   const avg=valid.length?valid.reduce((a,b)=>a+b,0)/valid.length:0;
   const counts=[1,2,3,4,5].map(n=>valid.filter(v=>v===n).length);
   return {key,title,average:avg,total:valid.length,counts};
  });
  content.innerHTML='<div class="tg-os-survey-modal-summary"><strong>'+rows.length+'</strong> inquéritos respondidos</div>'+
  '<div class="tg-os-survey-question-grid">'+averages.map(q=>'<section class="tg-os-survey-question"><div class="tg-os-survey-question-top"><strong>'+esc(q.title)+'</strong><b>'+(q.total?q.average.toLocaleString('pt-PT',{minimumFractionDigits:1,maximumFractionDigits:1}):'—')+' / 5</b></div><div class="tg-os-survey-question-chart">'+q.counts.map((n,i)=>'<div class="tg-os-survey-question-row"><small>'+(i+1)+' ★</small><div class="tg-os-survey-bar-track"><div class="tg-os-survey-bar-fill rating-'+(i+1)+'" style="width:'+(q.total?100*n/q.total:0)+'%"></div></div><span>'+n+'</span></div>').join('')+'</div></section>').join('')+'</div>'+
  '<p class="tg-sat-source">Resultados agregados por pergunta. As respostas individuais continuam disponíveis na ficha do cliente e na respetiva OS.</p>';
 }catch(e){if(overlay.isConnected)panel.querySelector('[data-survey-modal-content]').textContent='Não foi possível carregar as avaliações. Tente novamente.';}
}
async function dashboard(){
 if(!yes())return;
 const parent=document.getElementById('hdcSatisfacao');if(!parent?.isConnected)return;
 let mount=document.getElementById('tgOsSatisfactionDashboard');
 // Os inquéritos têm um cartão independente, nunca fazem parte do indicador dos Reports.
 if(!mount){
  mount=document.createElement('section');mount.id='tgOsSatisfactionDashboard';mount.className='hdc-card tg-os-satisfaction-card';
  parent.insertAdjacentElement('afterend',mount);
 }
 try{
  const rows=await fetchRows();if(!mount.isConnected)return;
  const rated=rows.filter(r=>r.respondido_em);
  const neg=rated.filter(r=>Number(r.avaliacao_geral)<=2).sort((a,b)=>String(b.respondido_em).localeCompare(String(a.respondido_em)));
  const avg=rated.length?(rated.reduce((acc,r)=>acc+Number(r.avaliacao_geral),0)/rated.length).toFixed(1).replace('.',','):'—';
  const count=Array.from({length:5},(_,i)=>rated.filter(r=>Number(r.avaliacao_geral)===i+1).length);
  const max=Math.max(1,...count);
  mount.innerHTML='<header class="tg-os-survey-heading"><h4><i class="fas fa-chart-column"></i> Satisfação dos Inquéritos</h4><button type="button" class="btn btn-outline" data-sat-expand title="Expandir inquéritos">Expandir <i class="fas fa-expand"></i></button></header>'+
   '<div class="tg-sat-metrics"><span><b>'+rated.length+'</b> respostas</span><span><b>'+avg+'</b> média / 5</span><span class="'+(neg.length?'negative':'')+'"><b>'+neg.length+'</b> negativas</span></div>'+
   '<div class="tg-os-survey-chart" role="img" aria-label="Distribuição das avaliações gerais dos inquéritos por estrelas">'+count.map((n,i)=>'<div class="tg-os-survey-bar-row"><span>'+String(i+1)+' ★</span><div class="tg-os-survey-bar-track"><div class="tg-os-survey-bar-fill rating-'+String(i+1)+'" style="width:'+(100*n/max)+'%"></div></div><b>'+n+'</b></div>').join('')+'</div>'+
   '<p class="tg-sat-source">Respostas aos inquéritos das OS · Escala 1 a 5</p>';
  mount.querySelector('[data-sat-expand]')?.addEventListener('click',expandSurveyDashboard);
 }catch(e){mount.textContent='Não foi possível atualizar os inquéritos.';}
}

// A tabela das OS não apresenta coluna de inquéritos; os detalhes pertencem à própria OS.
function removeLegacySurveyColumn(){
 const tbody=document.getElementById('tabelaServicos');
 const table=tbody?.closest('table');
 if(!table)return;
 table.querySelectorAll('[data-sat-os-heading],[data-sat-os-cell]').forEach(el=>el.remove());
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
 if(ticking)return;ticking=true;setTimeout(()=>{ticking=false;installOS();injectCustomerTab();if(activeOS)mountOS(activeOS);removeLegacySurveyColumn();if(document.getElementById('hdcSatisfacao')&&!document.getElementById('tgOsSatisfactionDashboard'))dashboard();},200);
}
document.addEventListener('change',watchCustomerSelect,true);
document.addEventListener('tg:interface-updated',()=>{cache.at=0;refresh();dashboard();removeLegacySurveyColumn();});
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
 setInterval(()=>{if(tenant()){installOS();injectCustomerTab();removeLegacySurveyColumn();}if(document.getElementById('hdcSatisfacao'))dashboard();},30000);
});
window.TGOSSurveys={linkForOS,copyLink,openCustomer,fetchRows,dashboard,warnCustomer,showOSResponse};
})();
