/* Compact live activity: grouped OS and construction work with actual participants. */
(function () {
'use strict';
if (window.TGLiveWorkSummary) return;
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const text = v => String(v ?? '').trim();
const date = () => {const d=new Date();return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');};
const time = value => {const s=text(value);const m=s.match(/(?:^|T|\\s)([01]?\\d|2[0-3]):([0-5]\\d)/);return m ? m[1].padStart(2,'0')+':'+m[2] : '';};
const todayRecord = (row,today) => text(row.data || row.dataEntrada || row.dataInicio).slice(0,10)===today;
const duration = (start,finish,today) => {
 const a=time(start),b=time(finish),now=new Date();
 if(!a)return '';
 const toMinutes=t=>Number(t.slice(0,2))*60+Number(t.slice(3,5));
 let end=b?toMinutes(b):now.getHours()*60+now.getMinutes();
 let mins=Math.max(0,end-toMinutes(a));if(mins>1440)mins=1440;
 return (mins>=60?Math.floor(mins/60)+'h':'')+(mins%60?String(mins%60).padStart(mins>=60?2:1,'0')+'m':mins<60?'0m':'');
};
const scope = () => {
 if(typeof usuarioLogado==='undefined'||!usuarioLogado||!['admin','subadmin','superadmin'].includes(usuarioLogado.role))return null;
 return usuarioLogado.adminId||usuarioLogado.id;
};
function records() {
 if(typeof dados==='undefined'||!dados)return [];
 const tenant=scope();if(!tenant)return [];
 const today=date(),groups=new Map();
 const people=new Map([...(dados.funcionarios||[]),...(dados.encarregados||[]),...(dados.administradores||[])].filter(p=>p.adminId===tenant||p.id===tenant).map(p=>[String(p.id),text(p.nome)||'Técnico']));
 const clients=new Map((dados.clientes||[]).filter(c=>c.adminId===tenant).map(c=>[String(c.id),text(c.nome)||text(c.nomeFiscal)]));
 const jobs={os:new Map((dados.servicos||[]).filter(v=>v.adminId===tenant).map(v=>[String(v.id),v])),obra:new Map((dados.obras||[]).filter(v=>v.adminId===tenant).map(v=>[String(v.id),v]))};
 for(const [kind,list,idKey] of [['os',dados.ponto||[],'servicoId'],['obra',dados.obraPontoLonga||[],'obraId']]){
  for(const row of list){
   if(row.adminId!==tenant||!row[idKey]||!row.funcionarioId||!todayRecord(row,today)||!time(row.entrada))continue;
   const job=jobs[kind].get(String(row[idKey]));if(!job)continue;
   const key=kind+':'+row[idKey];if(!groups.has(key))groups.set(key,{kind,id:String(row[idKey]),job,people:new Map(),first:'',last:'',active:false});
   const group=groups.get(key),start=time(row.entrada),finished=!!time(row.saida);
   const pid=String(row.funcionarioId),existing=group.people.get(pid);
   if(!existing||(!finished&&existing.finished))group.people.set(pid,{name:people.get(pid)||text(row.funcionarioNome)||'Técnico',start,finish:time(row.saida),finished});
   if(!group.first||start<group.first)group.first=start;
   if(!group.last||start>group.last)group.last=start;
   if(!finished)group.active=true;
  }
 }
 return [...groups.values()].sort((a,b)=>Number(b.active)-Number(a.active)||b.last.localeCompare(a.last)).slice(0,35).map(g=>{
 const job=g.job,work=g.kind==='os'?'OS':'Obra';
 const related=g.kind==='os'?jobs.obra.get(String(job.obraId||'')):null;
 const client=clients.get(String(job.clienteId||related?.clienteId||''))||text(job.clienteNome)||text(related?.clienteNome)||'Cliente não identificado';
 const summary=text(job.descricao||job.trabalho||job.tipoTrabalho||job.nome||job.titulo)||'Trabalho sem descrição';
 const staff=[...g.people.values()].sort((a,b)=>a.name.localeCompare(b.name,'pt'));
 return {kind:g.kind,id:g.id,work,client,summary,staff,active:g.active,at:g.first};
 });
}
const style=document.createElement('style');
style.textContent=`
.tgl-work-feed{display:flex;flex-direction:column;gap:0;max-height:370px;overflow:auto;scrollbar-width:thin}
.tgl-work-row{display:grid;grid-template-columns:42px minmax(0,1fr);gap:9px;padding:10px 3px;border-bottom:1px solid #e2e8f0;font:inherit}
.tgl-work-row:last-child{border-bottom:0}
.tgl-work-time{font-size:11px;font-weight:750;font-variant-numeric:tabular-nums;color:inherit;padding-top:2px}
.tgl-work-main{min-width:0}.tgl-work-head{display:flex;align-items:center;gap:6px;min-width:0}
.tgl-work-client{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;font-weight:750}
.tgl-work-tag{font-size:9px;padding:2px 5px;border-radius:5px;background:#e8efff;color:#2753aa;white-space:nowrap}
.tgl-work-tag.obra{background:#fff0db;color:#a15e16}
.tgl-work-desc{font-size:10px;line-height:1.4;color:#64748b;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-top:3px}
.tgl-work-team{font-size:10px;line-height:1.4;margin-top:3px;overflow-wrap:anywhere}
.tgl-work-state{font-size:10px;margin-top:3px;color:#64748b}.tgl-work-state.active{color:#16836a}
body.dark-mode .tgl-work-row{border-color:#35445d}body.dark-mode .tgl-work-desc,body.dark-mode .tgl-work-state{color:#aebbd0}
`;
function target(){
 const root=document.getElementById('tgHome');if(!root||getComputedStyle(root).display==='none')return null;
 const heading=[...root.querySelectorAll('h2,h3,h4,.tgm-title')].find(n=>/atividade em tempo real/i.test(n.textContent||''));
 if(!heading)return null;
 const panel=heading.closest('.tgm-panel,.home-card');if(!panel)return null;
 const list=panel.querySelector('.tgm-lista,.tgm-resumo-lista,[id*=AtividadeLista],[id*=atividadeLista]');
 return list ? {panel,list}:null;
}
function render(){
 try{
 const host=target();if(!host)return;
 const items=records();if(!items.length)return;
 const markup=items.map(g=>`<div class="tgl-work-row" data-work-type="${g.kind}" data-work-id="${esc(g.id)}">
 <span class="tgl-work-time">${esc(g.at)}</span><div class="tgl-work-main">
 <div class="tgl-work-head"><span class="tgl-work-client" title="${esc(g.client)}">${esc(g.client)}</span><span class="tgl-work-tag ${g.kind}">${g.work}</span></div>
 <div class="tgl-work-desc" title="${esc(g.summary)}">${esc(g.summary)}</div>
 <div class="tgl-work-team" title="${esc(g.staff.map(p=>p.name).join(', '))}">${esc(g.staff.map(p=>p.name).join(' · '))}</div>
 <div class="tgl-work-state ${g.active?'active':''}">${g.active?'Em curso':'Terminado'} · ${g.staff.length} ${g.staff.length===1?'técnico':'técnicos'}</div>
 </div></div>`).join('');
 if(host.list.dataset.tglMarkup===markup)return;
 host.list.dataset.tglMarkup=markup;
 host.list.innerHTML='<div class="tgl-work-feed">'+markup+'</div>';
 }catch(e){console.warn('TG live work summary',e);}
}
function start(){document.head.append(style);render();setInterval(()=>{if(!document.hidden)render();},2500);document.addEventListener('tg:interface-updated',render);}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
window.TGLiveWorkSummary={render,records};
})();
