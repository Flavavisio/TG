/* Histórico diário do funcionário — consulta exclusivamente de leitura. */
(() => {
'use strict';
if (window.TGHistoricoDiario) return;
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const id = v => String(v ?? '');
const dateKey = v => { if(!v) return ''; const s=String(v); if(/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0,10); const d=new Date(v); if(!Number.isFinite(d.getTime()))return '';return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-'); };
const t = v => { const m=String(v??'').match(/(?:T|\s|^)([01]?\d|2[0-3]):([0-5]\d)/);return m?m[1].padStart(2,'0')+':'+m[2]:''; };
const fmt = n => {n=Math.max(0,Math.round(n||0));return Math.floor(n/60)+'h '+String(n%60).padStart(2,'0')+'m';};
const mins = s => s ? Number(s.slice(0,2))*60+Number(s.slice(3,5)):null;
const current = () => typeof usuarioLogado !== 'undefined' ? usuarioLogado : null;
const tenant = () => {const u=current();return u&&['admin','subadmin'].includes(u.role) ? id(u.adminId||u.id):null;};
const data = () => typeof dados === 'undefined' ? {} : (dados||{});
const same = (v,w) => id(v)===id(w);
const scoped = (items,org) => (Array.isArray(items)?items:[]).filter(x=>x&&same(x.adminId,org));
const people = org => [...scoped(data().funcionarios,org),...scoped(data().encarregados,org)].filter((p,i,a)=>a.findIndex(q=>same(q.id,p.id))===i).sort((a,b)=>String(a.nome||'').localeCompare(String(b.nome||''),'pt'));
const personMatches = (r,p) => same(r.funcionarioId,p)||same(r.tecnicoId,p)||same(r.utilizadorId,p);
const timeDate = (r) => dateKey(r.data||r.dataEntrada||r.dataInicio||r.entrada);
const coordinate = (r,kind) => {
 const lat = r[kind==='entrada'?'latEntrada':'latSaida'] ?? r[kind==='entrada'?'latitudeEntrada':'latitudeSaida'] ?? (kind==='entrada'?r.latitude:undefined);
 const lng = r[kind==='entrada'?'lngEntrada':'lngSaida'] ?? r[kind==='entrada'?'longitudeEntrada':'longitudeSaida'] ?? (kind==='entrada'?r.longitude:undefined);
 const a=Number(lat),b=Number(lng);
 return lat!==undefined&&lat!==null&&lng!==undefined&&lng!==null&&Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a)<=90&&Math.abs(b)<=180&&!(a===0&&b===0)?{lat:a,lng:b}:null;
};
const locate = p => p ? '<a href="https://www.google.com/maps?q='+encodeURIComponent(p.lat+','+p.lng)+'" target="_blank" rel="noopener noreferrer">Ver localização</a>' : '<span class="tghd-muted">Localização não registada</span>';
const generalClocks = (d,org,p,day) => {
 const collections=['picagensPonto','registosPonto','pontoGeral','pontoFuncionarios','pontos','picagens','registosAssiduidade'];
 const found=[];const seen=new Set();
 for(const key of collections)for(const row of scoped(d[key],org)){
   if(!personMatches(row,p)||timeDate(row)!==day)continue;
   const unique=id(row.id||key+':'+(row.entrada||row.horaEntrada||'')+':'+(row.saida||row.horaSaida||''));if(seen.has(unique))continue;seen.add(unique);
   found.push({kind:'Ponto',name:'Registo de ponto',description:'Assiduidade',start:t(row.entrada||row.horaEntrada||row.dataEntrada),end:t(row.saida||row.horaSaida||row.dataSaida),source:row,locationIn:coordinate(row,'entrada'),locationOut:coordinate(row,'saida'),lunch:!!row.pausaAlmoco});
 }
 return found;
};
function activity(org,p,day) {
 const d=data(), entries=[],jobs=scoped(d.servicos,org),works=scoped(d.obras,org),clients=scoped(d.clientes,org);
 const jobMap=new Map(jobs.map(x=>[id(x.id),x]));const workMap=new Map(works.map(x=>[id(x.id),x]));
 const clientName = record => {
   const c=clients.find(x=>same(x.id,record?.clienteId));return c?.nome||c?.nomeFiscal||record?.clienteNome||'Cliente não identificado';
 };
 const add=(kind,ref,source) => {
   const record=(kind==='OS'?jobMap:workMap).get(id(ref));if(!record)return;
   const start=t(source.entrada||source.horaEntrada||source.inicio||source.dataEntrada);
   const end=t(source.saida||source.horaSaida||source.fim||source.dataSaida);
   const s=mins(start),e=mins(end);
   const duration=s!==null&&e!==null&&e>=s?e-s:null;
   entries.push({kind,ref:id(ref),name:clientName(record),description:record.descricao||record.tipoTrabalho||record.nome||record.titulo||'',start,end,duration,source,locationIn:coordinate(source,'entrada'),locationOut:coordinate(source,'saida'),lunch:!!source.pausaAlmoco});
 };
 scoped(d.ponto,org).filter(x=>personMatches(x,p)&&timeDate(x)===day&&x.servicoId).forEach(x=>add('OS',x.servicoId,x));
 scoped(d.obraPontoLonga,org).filter(x=>personMatches(x,p)&&timeDate(x)===day&&x.obraId).forEach(x=>add('Obra',x.obraId,x));
 // Folhas sem picagem associada também aparecem, mas não acrescentam horas ao total.
 scoped(d.folhasObra,org).filter(x=>personMatches(x,p)&&dateKey(x.data||x.dataCriacao||x.criadoEm)===day).forEach(x=>{
   const kind=x.servicoId?'OS':x.obraId?'Obra':null,ref=x.servicoId||x.obraId;
   if(!kind||!ref||entries.some(e=>e.kind===kind&&e.ref===id(ref)))return;
   const record=(kind==='OS'?jobMap:workMap).get(id(ref));if(!record)return;
   entries.push({kind,ref:id(ref),name:clientName(record),description:x.descricao||record.descricao||'',start:'',end:'',duration:null,sheet:true});
 });
 entries.push(...generalClocks(d,org,p,day));
 entries.sort((a,b)=>(a.start||'99:99').localeCompare(b.start||'99:99'));
 return entries;
}
const style=document.createElement('style');style.textContent=`
.tghd-overlay{position:fixed;inset:0;background:rgba(12,25,48,.64);z-index:99999;display:flex;align-items:center;justify-content:center;padding:16px}
.tghd-panel{background:var(--bg-card,#fff);color:var(--text-primary,#182844);width:min(780px,100%);max-height:90dvh;overflow:auto;border-radius:16px;padding:22px;box-shadow:0 20px 60px #0003}
.tghd-head{display:flex;justify-content:space-between;align-items:center;gap:12px}.tghd-head h2{margin:0;font-size:20px}
.tghd-fields{display:grid;grid-template-columns:minmax(0,1fr) minmax(160px,220px);gap:12px;margin:18px 0}
.tghd-fields label{display:block;font-size:12px;font-weight:700;margin-bottom:5px}.tghd-fields select,.tghd-fields input{width:100%;padding:10px;border-radius:9px;border:1px solid #b8c3d6;background:var(--bg-card,#fff);color:inherit}
.tghd-muted{opacity:.65}.tghd-event{padding:5px 0;font-size:12px}.tghd-event a{color:#2670bd;text-decoration:underline}.tghd-item{padding:12px 0;border-bottom:1px solid #dae0eb}.tghd-item strong{font-size:14px}.tghd-item small{display:block;margin-top:5px;opacity:.8}
.tghd-summary{background:var(--bg-secondary,#f0f4fa);padding:12px;border-radius:10px;margin-bottom:8px}
.tghd-actions{display:flex;gap:8px;align-items:center}.tghd-action{border:1px solid #c3cedf;background:transparent;color:inherit;border-radius:9px;padding:9px 12px;cursor:pointer}
@media(max-width:520px){.tghd-fields{grid-template-columns:1fr}.tghd-panel{padding:14px}}
@media print{body>*:not(#tgHistoricoDiario){display:none!important}.tghd-overlay{position:static;background:transparent;padding:0}.tghd-panel{max-height:none;box-shadow:none;width:100%}.tghd-actions,.tghd-fields{display:none!important}}
`;document.head.appendChild(style);
function open() {
 const org=tenant();if(!org)return;
 let overlay=document.getElementById('tgHistoricoDiario');
 if(!overlay){
   overlay=document.createElement('div');overlay.id='tgHistoricoDiario';overlay.className='tghd-overlay';overlay.setAttribute('role','dialog');overlay.setAttribute('aria-modal','true');overlay.setAttribute('aria-label','Histórico diário do funcionário');
   overlay.innerHTML='<div class="tghd-panel"><div class="tghd-head"><h2><i class="fas fa-calendar-day"></i> Histórico diário do funcionário</h2><div class="tghd-actions"><button type="button" class="tghd-action" data-print>Imprimir / PDF</button><button type="button" class="tghd-action" data-close aria-label="Fechar">✕</button></div></div><div class="tghd-fields"><div><label for="tghdFuncionario">Funcionário</label><select id="tghdFuncionario"></select></div><div><label for="tghdData">Data</label><input id="tghdData" type="date"></div></div><div id="tghdContent" aria-live="polite"></div></div>';
   document.body.appendChild(overlay);
   overlay.addEventListener('click',e=>{if(e.target===overlay||e.target.closest('[data-close]'))close();if(e.target.closest('[data-print]'))window.print();});
   overlay.querySelector('#tghdFuncionario').addEventListener('change',render);
   overlay.querySelector('#tghdData').addEventListener('change',render);
 }
 const staff=people(org),sel=overlay.querySelector('#tghdFuncionario'),previous=sel.value;
 sel.innerHTML='<option value="">Selecionar funcionário</option>'+staff.map(x=>'<option value="'+esc(x.id)+'">'+esc(x.nome||'Funcionário')+'</option>').join('');
 if(staff.some(x=>same(x.id,previous)))sel.value=previous;
 else if(staff.length)sel.value=id(staff[0].id);
 const date=overlay.querySelector('#tghdData');if(!date.value)date.value=dateKey(new Date().toLocaleDateString('sv-SE'));
 overlay.hidden=false;overlay.style.display='flex';render();sel.focus();
}
function close(){const el=document.getElementById('tgHistoricoDiario');if(el){el.hidden=true;el.style.display='none';}}
function render() {
 const org=tenant(),root=document.getElementById('tghdContent'),sel=document.getElementById('tghdFuncionario'),date=document.getElementById('tghdData');if(!root)return;
 if(!org){close();return;}
 const person=people(org).find(x=>same(x.id,sel.value));if(!person||!date.value){root.textContent='Selecione um funcionário e uma data.';return;}
 const items=activity(org,person.id,date.value);
 // Tempos de sessões válidas, unidos para impedir contagem dupla de trabalhos sobrepostos.
 const spans=items.filter(x=>x.duration!==null).map(x=>[mins(x.start),mins(x.end)]).sort((a,b)=>a[0]-b[0]);
 let total=0,last=null;for(const [a,b] of spans){if(last===null){total+=b-a;last=b;}else{total+=Math.max(0,b-Math.max(last,a));last=Math.max(last,b);}}
 const count=new Set(items.map(x=>x.kind+':'+x.ref)).size;
 const timeline=[];
 for(const x of items){
   const label=x.kind==='Ponto'?'Ponto':x.kind+' · '+x.name;
   if(x.start)timeline.push({at:x.start,priority:1,label:'Entrada · '+label,loc:x.locationIn});
   if(x.end)timeline.push({at:x.end,priority:2,label:(x.lunch?'Saída para almoço':'Saída')+' · '+label,loc:x.locationOut});
   if(!x.start&&!x.end)timeline.push({at:'',priority:3,label:x.kind+' · '+x.name+' — '+(x.description||'Registo sem horário'),loc:null});
 }
 timeline.sort((a,b)=>(a.at||'99:99').localeCompare(b.at||'99:99')||a.priority-b.priority);
 const countJobs=new Set(items.filter(x=>x.kind!=='Ponto').map(x=>x.kind+':'+x.ref)).size;
 const pauseEvents=timeline.filter(x=>x.label.startsWith('Saída para almoço'));
 root.innerHTML='<div class="tghd-summary"><strong>'+esc(person.nome||'Funcionário')+'</strong> · '+esc(date.value)+'<div>'+countJobs+' trabalho(s) · '+fmt(total)+' de intervenções com horários completos</div><small>Consulta de registos existentes. Horários incompletos e deslocações não entram no total; este valor não substitui o apuramento oficial.</small></div>'+
 '<h3>Cronologia do dia</h3>'+
 (timeline.length?timeline.map(x=>'<div class="tghd-item"><strong>'+esc(x.at||'Sem hora')+' · '+esc(x.label)+'</strong><div class="tghd-event">'+locate(x.loc)+'</div></div>').join(''):'<p>Sem registos para esta data.</p>')+
 '<h3>Trabalhos realizados</h3>'+
 (items.filter(x=>x.kind!=='Ponto').map(x=>'<div class="tghd-item"><strong>'+esc(x.start||'Sem hora')+(x.end?' – '+esc(x.end):'')+' · '+esc(x.kind)+' · '+esc(x.name)+'</strong><div>'+esc(x.description)+'</div><small>'+esc(x.kind)+' #'+esc(x.ref)+(x.duration!==null?' · '+fmt(x.duration):' · Horário não apurado')+(x.sheet?' · Folha de obra':'')+'</small></div>').join('')||'<p>Sem OS ou obras registadas.</p>')+
 '<p class="tghd-muted">O regresso do almoço é identificado pela entrada seguinte; só são indicadas localizações efetivamente registadas.</p>';
}
function inject(){
 if(!tenant())return;
 const existing=document.querySelector('#cardsGrid .card-principal[data-card="historico-diario"]');
 if(existing)return;
 const staff=document.querySelector('#cardsGrid .card-principal[data-card="funcionarios"]');
 if(!staff)return;
 const card=document.createElement('div');card.className='card-principal';card.dataset.card='historico-diario';
 card.innerHTML='<div class="icon"><i class="fas fa-calendar-day"></i></div><div class="info"><h3>Histórico Diário</h3><p>Entradas, pausas, trabalhos e localizações</p></div>';
 card.setAttribute('onclick','return abrirHistoricoDiarioFuncionario()');
 staff.after(card);
}
window.TGHistoricoDiario={open,close};
window.abrirHistoricoDiarioFuncionario=function(){open();return false;};
// Os menus Nexus/Equipa são reconstruídos dinamicamente. Intercetar a opção
// antes dos renderizadores evita um cartão visível sem ação associada.
document.addEventListener('click',event=>{
 const target=event.target instanceof Element ? event.target.closest('[data-tgn-card="historico-diario"],[data-nx-open="historico-diario"],[data-secao="historico-diario"],.card-principal[data-card="historico-diario"],[data-tghd-open]') : null;
 if(!target||!tenant())return;
 event.preventDefault();event.stopImmediatePropagation();open();
},true);
const observer=new MutationObserver(()=>{if(document.getElementById('tgHistoricoDiario')&&!tenant())close();inject();});
function start(){observer.observe(document.body,{childList:true,subtree:true,attributes:false});const area=document.getElementById('secao-navegacao-simples');if(area)observer.observe(area,{childList:true,attributes:true,attributeFilter:['class']});inject();document.addEventListener('click',()=>setTimeout(inject,0));}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();