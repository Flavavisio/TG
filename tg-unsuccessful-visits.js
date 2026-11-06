/* Failed visits are stored in the existing tenant-scoped service checklist JSON.
   The normal OS state remains pending/in progress; no completed work is invented. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.TGUnsuccessfulVisits=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
const KEY='__tgVisitasSemSucesso';
const REASONS=Object.freeze({ausente:'Cliente ausente',acesso:'Sem acesso à instalação',reagendar:'Cliente pediu para reagendar',condicoes:'Local sem condições para trabalhar',material:'Material ou equipamento indisponível',outro:'Outro motivo'});
const clone=x=>JSON.parse(JSON.stringify(x));
const object=x=>x&&typeof x==='object'&&!Array.isArray(x)?x:{};
const envelope=os=>object(object(os?.checklist)[KEY]);
const attempts=os=>Object.values(object(envelope(os).tentativas)).filter(v=>v&&v.id&&v.adminId===os.adminId).sort((a,b)=>b.registadoEm.localeCompare(a.registadoEm));
const closed=os=>['concluído','concluido','cancelado','cancelada'].includes(os?.status);
const unresolved=os=>closed(os)?[]:attempts(os).filter(v=>!object(envelope(os).resolucoes)[v.id]);
const pending=os=>unresolved(os).length>0;
const failedPoint=(os,id)=>!!object(envelope(os).tentativas)[id];
const assigned=os=>os?.funcionariosIds?.length?os.funcionariosIds:[os?.funcionarioId].filter(Boolean);
const tenant=u=>u?.role==='admin'?u.id:u?.adminId;
function checkActor(os,u,admin=false){
 if(!os||!u||tenant(u)!==os.adminId)throw Error('Esta OS não está disponível para a tua conta.');
 if(admin?!['admin','subadmin'].includes(u.role):!['admin','subadmin','funcionario','encarregado','vendedor'].includes(u.role)||!assigned(os).includes(u.id))throw Error('Não tens permissão para esta ação.');
}
function validate(input){
 if(!Object.hasOwn(REASONS,input?.motivo))throw Error('Escolhe o motivo da visita sem sucesso.');
 const observacoes=String(input.observacoes||'').trim();
 if(input.motivo==='outro'&&observacoes.length<3)throw Error('Descreve o motivo da visita.');
 if(observacoes.length>2000)throw Error('As observações podem ter até 2000 caracteres.');
 const fotos=input.fotos||[];
 if(!Array.isArray(fotos)||fotos.length>3||fotos.some(f=>typeof f!=='string'||f.length>120000||!/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(f)))throw Error('Escolhe até três fotografias válidas.');
 return {motivo:input.motivo,observacoes,fotos:[...fotos]};
}
function applyVisit(os,point,u,input,points,now=new Date()){
 checkActor(os,u);const value=validate(input);
 if(point?.adminId!==os.adminId||point?.servicoId!==os.id||point?.funcionarioId!==u.id||!point?.entrada)throw Error('Não existe uma entrada tua nesta OS.');
 const existing=object(envelope(os).tentativas)[point.id];if(existing)return existing;
 if(closed(os)||point.saida)throw Error('Esta intervenção já foi encerrada. Atualiza a informação antes de continuar.');
 const out=now.toTimeString().slice(0,8),stamp=now.toISOString();
 const visit={id:point.id,adminId:os.adminId,tecnicoId:u.id,tecnicoNome:u.nome||'',data:point.data,entrada:point.entrada,saida:out,registadoEm:stamp,dataAgendada:os.data||'',horaAgendada:os.hora||'',...value};
 const env=envelope(os);os.checklist={...object(os.checklist),[KEY]:{...env,versao:1,tentativas:{...object(env.tentativas),[point.id]:visit}}};
 point.saida=out;point.pausaAlmoco=false;
 if(input.loc){point.latSaida=input.loc.lat;point.lngSaida=input.loc.lng;}
 if(input.kmFim!=null)point.kmFim=input.kmFim;
 os.status=points.some(p=>p.adminId===os.adminId&&p.servicoId===os.id&&p.entrada&&!p.saida)?'em andamento':'pendente';
 return visit;
}
function applyDecision(os,u,input,people,points,now=new Date()){
 checkActor(os,u,true);
 if(!pending(os))throw Error('Esta OS já não tem visitas por tratar.');
 if(!['reagendar','cancelar','manter'].includes(input.acao))throw Error('Escolhe o próximo passo.');
 if(input.acao!=='manter'&&points.some(p=>p.adminId===os.adminId&&p.servicoId===os.id&&p.entrada&&!p.saida))throw Error('Ainda há técnicos em serviço nesta OS. Podes manter a visita em curso ou aguardar pela saída antes de reagendar ou cancelar.');
 if(!['pendente','cobrar','nao_cobrar'].includes(input.cobranca))throw Error('Escolhe como tratar a deslocação.');
 const valor=input.cobranca==='cobrar'?Number(input.valor):null;
 if(input.cobranca==='cobrar'&&(!Number.isFinite(valor)||valor<=0||valor>1000000))throw Error('Indica um valor válido para a deslocação.');
 let ids=[];
 if(input.acao==='reagendar'){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(input.data||'')||!/^\d{2}:\d{2}$/.test(input.hora||'')||Number(input.hora.slice(0,2))>23||Number(input.hora.slice(3))>59)throw Error('Indica a nova data e hora.');
  const date=new Date(input.data+'T12:00:00');if(Number.isNaN(+date)||date.toISOString().slice(0,10)!==input.data)throw Error('A data indicada não é válida.');
  const today=now.getFullYear()+'-'+String(now.getMonth()+1).padStart(2,'0')+'-'+String(now.getDate()).padStart(2,'0');
  if(input.data<today)throw Error('Escolhe hoje ou uma data futura.');
  ids=[...new Set(input.funcionariosIds||[])];
  if(!ids.length||ids.some(id=>!people.some(p=>p.id===id&&tenant(p)===os.adminId&&!p.suspenso&&p.ativo!==false)))throw Error('Seleciona pelo menos um técnico ativo da tua empresa.');
 }
 const resolution={acao:input.acao,cobranca:input.cobranca,valor,decididoPor:u.id,decididoEm:now.toISOString(),data:input.acao==='reagendar'?input.data:null,hora:input.acao==='reagendar'?input.hora:null,funcionariosIds:ids};
 const env=envelope(os),resolved={...object(env.resolucoes)};
 unresolved(os).forEach(v=>{resolved[v.id]={...resolution};});
 os.checklist={...object(os.checklist),[KEY]:{...env,resolucoes:resolved}};
 if(input.acao==='reagendar'){
  os.data=input.data;os.hora=input.hora;os.funcionariosIds=ids;os.funcionarioId=ids[0];
  if(!ids.includes(os.relatorioResponsavelId))os.relatorioResponsavelId=ids[0];
  os.status='pendente';
 }else if(input.acao==='cancelar')os.status='cancelado';
 return resolution;
}
function mergeChecklist(remote,local,base){
 const out={...object(remote)};
 for(const [key,value]of Object.entries(object(local)))if(key!==KEY&&JSON.stringify(value)!==JSON.stringify(object(base)[key]))out[key]=value;
 const r=object(object(remote)[KEY]),l=object(object(local)[KEY]);
 if(Object.keys(r).length||Object.keys(l).length){
  const resolve={...object(r.resolucoes)};
  for(const [id,v]of Object.entries(object(l.resolucoes))){if(!resolve[id]||resolve[id].decididoEm<v.decididoEm)resolve[id]=v;}
  out[KEY]={...r,...l,versao:1,tentativas:{...object(l.tentativas),...object(r.tentativas)},resolucoes:resolve};
 }
 return out;
}
// Optimistic updates merge attempts from other devices and preserve unrelated fields.
async function persistRows(client,rows,snap,onSaved,normalize=row=>row){
 const saved=[];
 try{
  for(const local of rows){
   if(!local.checklist?.[KEY]){
    const r=await client.from('servicos').upsert([local],{onConflict:'id'}).select('id');if(r.error)throw r.error;saved.push(...r.data||[]);continue;
   }
   const original=clone(local),base=JSON.parse(snap.get(local.id)||'null');
   if(!base)throw Error('A OS tem de estar sincronizada antes de registar uma visita.');
   let finished=false;
   for(let retry=0;retry<3&&!finished;retry++){
    const read=await client.from('servicos').select('*').eq('id',local.id).eq('admin_id',local.admin_id).maybeSingle();
    if(read.error)throw read.error;if(!read.data)throw Error('A OS já não está disponível no servidor.');
    const remote=normalize(read.data),patch={};
    for(const[key,value]of Object.entries(original)){
     if(['id','admin_id','checklist'].includes(key)||JSON.stringify(value)===JSON.stringify(base[key]))continue;
     // Concurrent staff exits may keep the OS running. Never turn a closed OS into pending.
     if(key==='status'){
      if(['concluído','concluido','cancelado'].includes(remote.status)&&remote.status!==base.status)throw Error('A OS foi encerrada noutra sessão. Atualiza antes de continuar.');
     }else if(JSON.stringify(remote[key])!==JSON.stringify(base[key])&&JSON.stringify(remote[key])!==JSON.stringify(value))throw Error('A OS foi alterada noutra sessão. Atualiza antes de continuar.');
     patch[key]=value;
    }
    patch.checklist=mergeChecklist(remote.checklist,original.checklist,base.checklist);
    const merged=object(patch.checklist[KEY]),old=object(object(base.checklist)[KEY]);
    const newVisit=Object.keys(object(merged.tentativas)).some(id=>!object(old.tentativas)[id]);
    const newDecision=Object.entries(object(merged.resolucoes)).some(([id,v])=>JSON.stringify(v)!==JSON.stringify(object(old.resolucoes)[id])&&['reagendar','cancelar'].includes(v.acao));
    if(newVisit&&['concluído','concluido','cancelado'].includes(remote.status))throw Error('A OS foi encerrada noutra sessão. Atualiza antes de continuar.');
    if(newVisit||newDecision){
     const active=await client.from('ponto').select('id').eq('admin_id',local.admin_id).eq('servico_id',local.id).is('saida',null);
     if(active.error)throw active.error;
     const other=(active.data||[]).some(p=>!object(merged.tentativas)[p.id]);
     if(newDecision&&other)throw Error('Ainda há técnicos em serviço nesta OS. Aguarda pela saída antes de reagendar ou cancelar.');
     if(newVisit&&!newDecision)patch.status=other?'em andamento':'pendente';
    }
    let query=client.from('servicos').update(patch).eq('id',local.id).eq('admin_id',local.admin_id).eq('status',remote.status);
    query=remote.checklist==null?query.is('checklist',null):query.eq('checklist',JSON.stringify(remote.checklist));
    const write=await query.select('*');if(write.error)throw write.error;
    if(write.data?.length){Object.assign(local,clone(write.data[0]));onSaved?.(local,original);saved.push({id:local.id});finished=true;}
   }
   if(!finished)throw Error('A OS está a ser atualizada por outra pessoa. Tenta guardar novamente.');
  }
  return {data:saved,error:null};
 }catch(error){return {data:saved,error};}
}
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const state=()=>dados;
const actor=()=>usuarioLogado;
const find=id=>state().servicos?.find(s=>s.id===id&&s.adminId===tenant(actor()));
const canManage=os=>['admin','subadmin'].includes(actor()?.role)&&tenant(actor())===os?.adminId;
const blocked=(os,userId)=>pending(os)&&unresolved(os).some(v=>v.tecnicoId===userId);
const label=os=>pending(os)&&os.status!=='em andamento'?'Por reagendar':os.status||'pendente';
function badge(os){if(!pending(os))return '';return '<span class="tg-uv-badge">'+(os.status==='em andamento'?'Visita sem sucesso · por tratar':'Visita sem sucesso · por reagendar')+'</span>';}
function refresh(){if(typeof renderizarTudo==='function')renderizarTudo();if(typeof renderizarAgendaObras==='function')renderizarAgendaObras();}
let disposeModal=null;
function cleanupModal(){disposeModal?.();}
function modal(title,body){
 disposeModal?.();
 const previous=document.activeElement;
 // Use the same shell, title, fields, footer and close button as the other TG forms.
 let overlay=document.getElementById('modalGenericoOverlay'),temporary=false;
 if(overlay){
  if(overlay.classList.contains('open')&&typeof _fecharModalGenerico==='function')_fecharModalGenerico();
  overlay.classList.remove('modal-veros');
 }else{
  temporary=true;document.getElementById('tgVisitOverlay')?.remove();
  overlay=document.createElement('div');overlay.id='tgVisitOverlay';overlay.className='modal-overlay';
  overlay.innerHTML='<div class="modal"><div class="tg-uv-title-row"><h3 id="tgVisitTitle"></h3><button type="button" class="close-modal" aria-label="Fechar visita">×</button></div><form><div class="tg-uv-body"></div><div class="modal-actions"></div></form></div>';
  document.body.append(overlay);
 }
 const oldZIndex=overlay.style.zIndex;
 overlay.dataset.tgVisits='true';overlay.style.zIndex='100100';
 const box=overlay.querySelector('.modal'),form=temporary?overlay.querySelector('form'):document.getElementById('modalGenericoForm');
 const heading=temporary?overlay.querySelector('h3'):document.getElementById('modalGenericoTitulo');
 const fields=temporary?overlay.querySelector('.tg-uv-body'):document.getElementById('modalGenericoCampos');
 const actions=temporary?overlay.querySelector('.modal-actions'):document.getElementById('modalGenericoAcoes');
 const oldActions=[...actions.childNodes],closeButton=overlay.querySelector('.close-modal'),oldClose=closeButton.onclick;
 heading.textContent=title;
 box.style.cssText='max-width:640px;';box.setAttribute('role','dialog');box.setAttribute('aria-modal','true');box.setAttribute('aria-labelledby',heading.id);box.tabIndex=-1;
 form.style.cssText='';form.classList.add('tg-uv-form');fields.style.cssText='';fields.classList.add('tg-uv-body');
 fields.innerHTML=body+'<p data-uv-error role="alert" class="tg-uv-error"></p>';
 for(const label of [...fields.querySelectorAll('label')]){
  if(label.classList.contains('tg-uv-person'))continue;
  const group=document.createElement('div');group.className='form-group';
  label.before(group);group.append(label);
  if(label.hasAttribute('data-uv-price')){group.dataset.uvPrice='';label.removeAttribute('data-uv-price');group.hidden=label.hidden;label.hidden=false;}
 }
 const footer=fields.querySelector('.tg-uv-actions');actions.style.cssText='';actions.replaceChildren();
 if(footer){actions.append(...footer.children);footer.remove();}
 else actions.innerHTML='<button type="button" class="btn" data-uv-cancel style="background:#e9edf2;">Fechar</button>';
 actions.querySelector('[data-uv-cancel]')?.classList.remove('btn-outline');
 const cancel=actions.querySelector('[data-uv-cancel]');if(cancel)cancel.style.background='#e9edf2';
 const primary=actions.querySelector('[type=submit]');if(primary){primary.classList.remove('btn-warning');primary.classList.add('btn-success');}
 const onKey=e=>{
  if(e.key==='Escape'){e.preventDefault();e.stopPropagation();close();}
  if(e.key==='Tab'){
   const nodes=[...box.querySelectorAll('button,input,select,textarea,a[href],summary')].filter(n=>!n.disabled&&n.getClientRects().length),first=nodes[0],last=nodes.at(-1);
   if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}
  }
 };
 let disposed=false;
 const dispose=()=>{if(disposed)return;disposed=true;overlay.removeEventListener('keydown',onKey);form.classList.remove('tg-uv-form');fields.classList.remove('tg-uv-body');delete overlay.dataset.tgVisits;overlay.style.zIndex=oldZIndex;closeButton.onclick=oldClose;actions.replaceChildren(...oldActions);form.onsubmit=null;if(disposeModal===dispose)disposeModal=null;};
 const close=()=>{dispose();if(temporary)overlay.remove();else if(typeof _fecharModalGenerico==='function')_fecharModalGenerico();else overlay.classList.remove('open');previous?.focus?.();if(disposeModal===dispose)disposeModal=null;};
 disposeModal=dispose;
 overlay.querySelector('.close-modal').onclick=close;cancel?.addEventListener('click',close);overlay.addEventListener('keydown',onKey);
 overlay.classList.add('open');box.focus();
 return {overlay,form,close,error:message=>{fields.querySelector('[data-uv-error]').textContent=message;}};
}
function historyHtml(os){
 if(!attempts(os).length)return '';
 const env=envelope(os);
 return `<section class="tg-uv-history"><h3>Histórico de visitas sem sucesso</h3>${attempts(os).map(v=>{
  const decision=object(env.resolucoes)[v.id];const when=new Date(v.registadoEm).toLocaleString('pt-PT');
  return `<article><strong>${esc(REASONS[v.motivo]||'Visita sem sucesso')}</strong><p>${esc(v.tecnicoNome||v.tecnicoId)} · ${esc(when)}<br>Entrada ${esc(v.data)} às ${esc(v.entrada)} · Saída ${esc(v.saida)}</p>${v.observacoes?`<p class="tg-uv-notes">${esc(v.observacoes)}</p>`:''}<div class="tg-uv-photos">${(v.fotos||[]).filter(f=>/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(f)).map(f=>`<a href="${f}" target="_blank" rel="noopener"><img src="${f}" alt="Fotografia da tentativa de visita" loading="lazy"></a>`).join('')}</div><p>${decision?`${decision.acao==='reagendar'?'Reagendada para '+esc(decision.data)+' às '+esc(decision.hora):decision.acao==='cancelar'?'OS cancelada':'Tratada — manter o serviço'} · ${decision.cobranca==='cobrar'?'Deslocação a cobrar: '+Number(decision.valor).toFixed(2)+' €':decision.cobranca==='nao_cobrar'?'Sem cobrança de deslocação':'Cobrança por decidir'}`:'Aguarda decisão da administração.'}</p></article>`;
 }).join('')}</section>`;
}
function panel(os){if(!attempts(os).length)return '';return `<div class="tg-uv-panel">${badge(os)}${pending(os)&&canManage(os)?`<button type="button" class="btn btn-sm btn-warning" onclick="TGUnsuccessfulVisits.manage('${esc(os.id)}')">Tratar visita / Reagendar</button>`:''}<details><summary>Ver tentativas anteriores (${attempts(os).length})</summary>${historyHtml(os)}</details></div>`;}
async function register(osId,pointId,context={}){
 const os=find(osId),point=state().ponto?.find(p=>p.id===pointId);
 try{checkActor(os,actor());if(!point||point.saida||point.funcionarioId!==actor().id)throw Error('Não existe uma entrada tua em aberto.');}catch(e){alert(e.message);return;}
 const ui=modal('Visita sem sucesso',`<p>A saída fecha apenas o teu tempo nesta OS. O serviço fica por tratar pela administração.</p><label>Motivo<select name="motivo" required><option value="">Selecionar motivo</option>${Object.entries(REASONS).map(([v,t])=>`<option value="${v}">${t}</option>`).join('')}</select></label><label>Observações<textarea name="observacoes" rows="3" maxlength="2000" placeholder="O que impediu a realização do serviço?"></textarea></label><label>Fotografias (opcional, até 3)<input name="fotos" type="file" accept="image/*" multiple></label><div class="tg-uv-actions"><button type="button" class="btn btn-outline" data-uv-cancel>Cancelar</button><button type="submit" class="btn btn-warning">Confirmar visita e sair</button></div>`);
 ui.form.elements.motivo.onchange=()=>{ui.form.elements.observacoes.required=ui.form.elements.motivo.value==='outro';};
 let applied=false,synced=false,visit=null;
 ui.form.onsubmit=async event=>{
  event.preventDefault();const button=ui.form.querySelector('[type=submit]');if(button.disabled)return;button.disabled=true;ui.error('');
  try{
   if(!applied){
    const files=[...ui.form.elements.fotos.files];if(files.length>3)throw Error('Escolhe até três fotografias.');
    validate({motivo:ui.form.elements.motivo.value,observacoes:ui.form.elements.observacoes.value});
    const fotos=[];for(const file of files){if(!file.type.startsWith('image/')||file.size>15*1024*1024)throw Error('Escolhe fotografias até 15 MB.');let photo=await _comprimirImagem(file,800,.6);if(photo.length>120000)photo=await _comprimirImagem(file,600,.45);fotos.push(photo);}
    // Check again after compression: logout, reassignment or closing on this device must cancel.
    if(find(osId)!==os||actor()?.id!==point.funcionarioId)throw Error('A sessão mudou. Volta a abrir esta OS.');
    visit=applyVisit(os,point,actor(),{motivo:ui.form.elements.motivo.value,observacoes:ui.form.elements.observacoes.value,fotos,loc:context.loc,kmFim:context.kmSai},state().ponto||[]);applied=true;
    [...ui.form.elements].forEach(el=>{if(!el.matches('button'))el.disabled=true;});
   }
   if(!navigator.onLine)throw Error('Sem ligação. A visita fica por sincronizar.');
   await guardarDados();synced=true;
   if(typeof _notificarAdminESubadmin==='function')_notificarAdminESubadmin(os.adminId,'Visita sem sucesso · OS '+(os.numeroRegisto||os.id),REASONS[visit.motivo]+' · '+(visit.tecnicoNome||'Técnico')+' · '+visit.data,'TGUnsuccessfulVisits.open('+JSON.stringify(os.id)+')');
   ui.close();refresh();alert('Visita sem sucesso registada. A administração encontra a pendência para reagendar.');
  }catch(e){
   if(applied&&!synced){if(typeof _guardarCacheLocal==='function')_guardarCacheLocal();refresh();button.textContent='Tentar sincronizar';ui.error('A visita e a saída estão pendentes de sincronização. '+e.message+' Não registes outra tentativa.');}
   else ui.error(e.message||'Não foi possível guardar a visita.');
  }finally{button.disabled=false;}
 };
}
function peopleFor(os){return [...(state().administradores||[]).map(p=>({...p,role:'admin'})),...state().funcionarios||[],...state().encarregados||[]].filter((p,i,arr)=>tenant(p)===os.adminId&&!p.suspenso&&p.ativo!==false&&arr.findIndex(x=>x.id===p.id)===i);}
function open(id){const os=find(id);if(!os)return;if(canManage(os)&&pending(os))return manage(id);if(typeof abrirVerOS==='function')abrirVerOS(id);}
function visitContext(os){
 const latest=unresolved(os)[0]||attempts(os)[0];
 if(!latest)return '';
 return `<p class="help-text tg-uv-context"><strong>OS ${esc(os.numeroRegisto||os.id)} · ${esc(REASONS[latest.motivo]||'Visita sem sucesso')}</strong><br>${esc(latest.tecnicoNome||latest.tecnicoId)} · ${esc(new Date(latest.registadoEm).toLocaleString('pt-PT'))}${latest.observacoes?'<br>'+esc(latest.observacoes.slice(0,280)):''}</p>`;
}
function openPending(){
 const list=pendingList(tenant(actor())).filter(canManage);
 if(!list.length)return;
 if(list.length===1)return manage(list[0].id);
 const ui=modal('OS por reagendar',`<p class="help-text">Seleciona a ordem de serviço para agendar a próxima visita.</p><label>Ordem de serviço<select name="os" required>${list.map(os=>`<option value="${esc(os.id)}">OS ${esc(os.numeroRegisto||os.id)} · ${esc(os.descricao||'Serviço')} · ${esc(REASONS[unresolved(os)[0]?.motivo]||'Visita sem sucesso')}</option>`).join('')}</select></label><div class="tg-uv-actions"><button type="button" class="btn" data-uv-cancel>Cancelar</button><button type="submit" class="btn btn-success">Agendar visita</button></div>`);
 ui.form.onsubmit=event=>{event.preventDefault();const id=ui.form.elements.os.value;ui.close();manage(id);};
}
function manage(id){
 const os=find(id);try{checkActor(os,actor(),true);}catch(e){alert(e.message);return;}
 const people=peopleFor(os),ui=modal('Agendar visita',`${visitContext(os)}<label>Próximo passo<select name="acao"><option value="reagendar">Reagendar OS</option><option value="manter">Manter o serviço e dar esta visita como tratada</option><option value="cancelar">Cancelar OS</option></select></label><div data-uv-schedule><div class="tg-uv-fields"><label>Nova data<input name="data" type="date" value="${esc(getDataHoje())}"></label><label>Hora<input name="hora" type="time" value="${esc((os.hora||'09:00').slice(0,5))}"></label></div><fieldset><legend>Técnicos da próxima visita</legend>${people.map(p=>`<label class="tg-uv-person"><input type="checkbox" name="tecnicos" value="${esc(p.id)}" ${assigned(os).includes(p.id)?'checked':''}>${esc(p.nome||p.empresa||p.id)}</label>`).join('')}</fieldset></div><label>Deslocação desta tentativa<select name="cobranca"><option value="pendente">Por decidir</option><option value="nao_cobrar">Não cobrar</option><option value="cobrar">Cobrar deslocação</option></select></label><label data-uv-price hidden>Valor da deslocação (€)<input name="valor" type="number" min="0.01" max="1000000" step="0.01"></label><p class="help-text">A decisão de cobrança fica no histórico. A emissão de fatura é feita separadamente.</p><details class="tg-uv-history-toggle"><summary>Histórico de tentativas (${attempts(os).length})</summary>${historyHtml(os)}</details><div class="tg-uv-actions"><button type="button" class="btn btn-outline" data-uv-cancel>Cancelar</button><button type="submit" class="btn btn-success">Guardar decisão</button></div>`);
 ui.form.elements.acao.onchange=()=>{ui.form.querySelector('[data-uv-schedule]').hidden=ui.form.elements.acao.value!=='reagendar';};
 ui.form.elements.cobranca.onchange=()=>{ui.form.querySelector('[data-uv-price]').hidden=ui.form.elements.cobranca.value!=='cobrar';};
 let applied=false,rescheduleNotice=null,notified=false;
 ui.form.onsubmit=async event=>{
  event.preventDefault();const button=ui.form.querySelector('[type=submit]');if(button.disabled)return;button.disabled=true;ui.error('');
  try{
   if(!applied){
    const input={acao:ui.form.elements.acao.value,data:ui.form.elements.data.value,hora:ui.form.elements.hora.value,funcionariosIds:[...ui.form.querySelectorAll('[name=tecnicos]:checked')].map(el=>el.value),cobranca:ui.form.elements.cobranca.value,valor:ui.form.elements.valor.value};
    if(input.acao==='cancelar'&&!await tgConfirm('Cancelar esta OS e conservar o histórico da tentativa?',{titulo:'Cancelar OS'}))return;
    if(input.acao==='reagendar'&&typeof _bloquearSeAusenteEmOS==='function'&&_bloquearSeAusenteEmOS(input.funcionariosIds,input.data))return;
    applyDecision(os,actor(),input,peopleFor(os),state().ponto||[]);applied=true;
    if(input.acao==='reagendar'){
     const client=(state().clientes||[]).find(c=>c.id===os.clienteId&&c.adminId===os.adminId);
     rescheduleNotice={ids:[...new Set(assigned(os))],adminId:os.adminId,title:'📅 OS '+(os.numeroRegisto?'#'+os.numeroRegisto+' ':'')+'reagendada',
      message:[client?.nome||client?.empresa,os.descricao,'Nova visita em '+os.data.split('-').reverse().join('/')+' às '+os.hora+'.'].filter(Boolean).join(' — '),
      action:'abrirVerOS('+JSON.stringify(os.id)+')'};
    }
    [...ui.form.elements].forEach(el=>{if(!el.matches('button'))el.disabled=true;});
   }
   if(!navigator.onLine)throw Error('É necessária ligação para confirmar a decisão.');
   await guardarDados();
   // Only notify after the reschedule has been confirmed; failed saves can be retried.
   if(rescheduleNotice&&!notified&&typeof _notificarFuncionario==='function'){
    notified=true;
    for(const id of rescheduleNotice.ids){
     try{_notificarFuncionario(id,rescheduleNotice.title,rescheduleNotice.message,rescheduleNotice.adminId,rescheduleNotice.action);}
     catch(error){console.warn('Notificação de reagendamento:',error);}
    }
   }
   ui.close();refresh();alert('Decisão guardada no histórico da OS.');
  }catch(e){if(applied){if(typeof _guardarCacheLocal==='function')_guardarCacheLocal();refresh();button.textContent='Tentar sincronizar';}ui.error((applied?'Decisão pendente de sincronização. ':'')+(e.message||'Não foi possível guardar.'));}finally{button.disabled=false;}
 };
}
function pendingList(adminId){return (state().servicos||[]).filter(s=>s.adminId===adminId&&pending(s));}
function summary(adminId){const rows=pendingList(adminId);if(!rows.length)return '';return `<div class="tg-uv-summary"><strong>${rows.length} OS com visitas sem sucesso por tratar</strong>${rows.map(s=>`<button type="button" class="btn btn-outline" onclick="TGUnsuccessfulVisits.open('${esc(s.id)}')">OS ${esc(s.numeroRegisto||s.id)} · ${esc(s.descricao||'Serviço')} · ${esc(REASONS[unresolved(s)[0]?.motivo])}</button>`).join('')}</div>`;}
return Object.freeze({KEY,REASONS,envelope,attempts,unresolved,pending,failedPoint,blocked,label,validate,applyVisit,applyDecision,mergeChecklist,persistRows,register,manage,open,openPending,cleanupModal,badge,panel,summary,pendingList});
});
