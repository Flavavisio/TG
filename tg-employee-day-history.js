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
   entries.push({kind,ref:id(ref),name:clientName(record),description:record.descricao||record.tipoTrabalho||record.nome||record.titulo||'',start,end,duration,source});
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
 entries.sort((a,b)=>(a.start||'99:99').localeCompare(b.start||'99:99'));
 return entries;
}
const style=document.createElement('style');style.textContent=`
.tghd-overlay{position:fixed;inset:0;background:rgba(12,25,48,.64);z-index:99999;display:flex;align-items:center;justify-content:center;padding:16px}
.tghd-panel{background:var(--bg-card,#fff);color:var(--text-primary,#182844);width:min(780px,100%);max-height:90dvh;overflow:auto;border-radius:16px;padding:22px;box-shadow:0 20px 60px #0003}
.tghd-head{display:flex;justify-content:space-between;align-items:center;gap:12px}.tghd-head h2{margin:0;font-size:20px}
.tghd-fields{display:grid;grid-template-columns:minmax(0,1fr) minmax(160px,220px);gap:12px;margin:18px 0}
.tghd-fields label{display:block;font-size:12px;font-weight:700;margin-bottom:5px}.tghd-fields select,.tghd-fields input{width:100%;padding:10px;border-radius:9px;border:1px solid #b8c3d6;background:var(--bg-card,#fff);color:inherit}
.tghd-item{padding:12px 0;border-bottom:1px solid #dae0eb}.tghd-item strong{font-size:14px}.tghd-item small{display:block;margin-top:5px;opacity:.8}
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
 root.innerHTML='<div class="tghd-summary"><strong>'+esc(person.nome||'Funcionário')+'</strong> · '+esc(date.value)+'<div>'+count+' trabalho(s) registado(s) · '+fmt(total)+' de intervenções com horários completos</div><small>Não inclui deslocações ou períodos sem hora de entrada e saída. Não substitui o apuramento oficial de horas.</small></div>'+
 (items.length?items.map(x=>'<div class="tghd-item"><strong>'+esc(x.start||'Sem hora')+(x.end?' – '+esc(x.end):'')+' · '+esc(x.kind)+' · '+esc(x.name)+'</strong><div>'+esc(x.description)+'</div><small>'+esc(x.kind)+' #'+esc(x.ref)+(x.duration!==null?' · '+fmt(x.duration):' · Horário não apurado')+(x.sheet?' · Folha de obra':'')+'</small></div>').join(''):'<p>Sem intervenções registadas para este funcionário nesta data.</p>');
}
function inject(){
 if(!tenant())return;
 const area=document.getElementById('secao-navegacao-simples');
 const staff=document.getElementById('secao-funcionarios');
 for(const root of [area,staff]){
   if(!root||root===area&&!root.classList.contains('active')||root===area&&!root.querySelector('.tg-area-head h2')?.textContent.includes('Equipa'))continue;
   if(root.querySelector('[data-tghd-open]'))continue;
   const btn=document.createElement('button');btn.type='button';btn.className='btn btn-outline';btn.dataset.tghdOpen='';btn.innerHTML='<i class="fas fa-calendar-day"></i> Histórico diário do funcionário';btn.addEventListener('click',open);
   (root.querySelector('.tg-area-head')||root).appendChild(btn);
 }
}
window.TGHistoricoDiario={open,close};
const observer=new MutationObserver(()=>{if(document.getElementById('tgHistoricoDiario')&&!tenant())close();inject();});
function start(){observer.observe(document.body,{childList:true,subtree:false,attributes:false});const area=document.getElementById('secao-navegacao-simples');if(area)observer.observe(area,{childList:true,attributes:true,attributeFilter:['class']});inject();document.addEventListener('click',()=>setTimeout(inject,0));}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();