/* Configuração por empresa do inquérito de satisfação enviado por OS. */
(function(){
'use strict';
if(window.TGSurveyConfig)return;
const $=id=>document.getElementById(id);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c]));
const actor=()=>typeof usuarioLogado!=='undefined'?usuarioLogado:null;
const org=()=>['admin','subadmin'].includes(actor()?.role)?String(actor().adminId||actor().id):null;
const canEdit=()=>actor()?.role==='admin';
const db=()=>typeof supa!=='undefined'&&supa?.from?supa:null;
const fixed=[
 {id:'avaliacao_tecnico',label:'Atendimento e profissionalismo do técnico',type:'rating',required:true},
 {id:'avaliacao_execucao',label:'Qualidade da execução do serviço ou obra',type:'rating',required:true},
 {id:'avaliacao_pontualidade',label:'Pontualidade e cumprimento dos horários',type:'rating',required:true},
 {id:'avaliacao_limpeza',label:'Organização e limpeza no final da intervenção',type:'rating',required:true},
 {id:'avaliacao_geral',label:'Satisfação geral com o serviço',type:'rating',required:true}
];
const defaults=()=>({titulo:'Como correu a nossa intervenção?',introducao:'A sua opinião ajuda-nos a melhorar o nosso serviço.',perguntas:fixed.map(x=>({...x})),versao:0});
let state=null,dirty=false;
const editing=()=>canEdit()&&!$('tgSurveyConfigDialog')?.classList.contains('tg-survey-readonly');
function notify(message,error=false){const node=$('tgSurveyConfigStatus');if(node){node.textContent=message;node.classList.toggle('error',error);}}
async function load(){
 if(!org()||!db())throw Error('Sem sessão válida.');
 const {data,error}=await db().from('configuracoes_inquerito_os').select('titulo,introducao,perguntas,versao').eq('admin_id',org()).maybeSingle();
 if(error)throw error;
 const value=data||defaults(),p=Array.isArray(value.perguntas)?value.perguntas:[];
 state={titulo:value.titulo||defaults().titulo,introducao:value.introducao??defaults().introducao,
  perguntas:fixed.map(d=>({...d,label:String(p.find(x=>x.id===d.id)?.label||d.label)})).concat(
   p.filter(x=>!fixed.some(k=>k.id===x.id)&&/^[a-z0-9_-]{6,80}$/.test(String(x.id))&&['rating','yesno','text'].includes(x.type))
    .map(x=>({id:x.id,type:x.type,label:String(x.label||'').slice(0,180),required:!!x.required}))
  ),versao:value.versao||0};dirty=false;
}
function render(){
 const panel=$('tgSurveyConfigDialog');if(!panel||!state)return;
 const allowed=canEdit();panel.classList.toggle('tg-survey-readonly',!allowed);
 const list=panel.querySelector('[data-config-questions]');
 const p=state.perguntas;
 list.innerHTML=p.map((q,i)=>{
  const isFixed=fixed.some(x=>x.id===q.id);
  return '<div class="tg-sqc-question" data-sqc-index="'+i+'">'+
   '<div class="tg-sqc-ord"><button type="button" data-sqc-up '+(i===0||!allowed?'disabled':'')+' aria-label="Subir pergunta">↑</button><button type="button" data-sqc-down '+(i===p.length-1||!allowed?'disabled':'')+' aria-label="Descer pergunta">↓</button></div>'+
   '<div class="tg-sqc-question-body"><label>Pergunta '+(i+1)+' <input data-sqc-label maxlength="180" value="'+esc(q.label)+'" '+(!allowed?'readonly':'')+'></label><div class="tg-sqc-controls"><label>Formato <select data-sqc-type '+(!allowed||isFixed?'disabled':'')+'><option value="rating" '+(q.type==='rating'?'selected':'')+'>Classificação 1 a 5</option><option value="yesno" '+(q.type==='yesno'?'selected':'')+'>Sim / Não</option><option value="text" '+(q.type==='text'?'selected':'')+'>Texto livre</option></select></label><label class="tg-sqc-required"><input type="checkbox" data-sqc-required '+(q.required?'checked':'')+' '+(!allowed||isFixed?'disabled':'')+'> Obrigatória</label></div>'+
   (isFixed?'<small>Questão-base do Dashboard · mantém a escala de 1 a 5</small>':'')+'</div>'+
   (!isFixed&&allowed?'<button type="button" class="tg-sqc-delete" data-sqc-delete aria-label="Eliminar pergunta">×</button>':'')+'</div>';
 }).join('');
 panel.querySelector('[data-sqc-add]').hidden=!allowed;
 panel.querySelector('[data-sqc-save]').hidden=!allowed;
 panel.querySelector('[data-sqc-reset]').hidden=!allowed;
 panel.querySelector('[data-sqc-version]').textContent=state.versao?'Versão publicada: '+state.versao:'Modelo padrão ainda não personalizado';
 preview();
}
function preview(){
 const target=$('tgSurveyConfigPreview');if(!target||!state)return;
 target.innerHTML='<div class="tg-sqc-preview-head"><i class="fas fa-building"></i><span>Logótipo da empresa no formulário enviado ao cliente</span></div><h3>'+esc(state.titulo)+'</h3><p>'+esc(state.introducao)+'</p>'+
 state.perguntas.map(x=>'<section class="tg-sqc-preview-item"><strong>'+esc(x.label)+(x.required?' *':'')+'</strong>'+
 (x.type==='rating'?'<div class="tg-sqc-stars">1 ★　2 ★　3 ★　4 ★　5 ★</div>':x.type==='yesno'?'<div class="tg-sqc-stars">○ Sim　○ Não</div>':'<div class="tg-sqc-preview-text">Escreva a sua resposta…</div>')+'</section>').join('');
}
function open(){
 if(!org()||!db())return;
 $('tgSurveyConfigDialog')?.remove();
 const overlay=document.createElement('div');overlay.id='tgSurveyConfigDialog';overlay.className='tg-sqc-overlay';
 overlay.innerHTML='<div class="tg-sqc-panel" role="dialog" aria-modal="true" aria-label="Configuração de inquéritos de satisfação"><header><div><small>CONFIGURAÇÕES E AJUDA</small><h2>Inquéritos de Satisfação</h2><p>Personalize as perguntas enviadas depois de cada OS.</p></div><button type="button" data-sqc-close aria-label="Fechar">✕</button></header><div class="tg-sqc-columns"><section><div class="tg-sqc-fields"><label>Título do formulário<input data-sqc-title maxlength="140"></label><label>Mensagem de introdução<textarea data-sqc-intro maxlength="600" rows="2"></textarea></label></div><div class="tg-sqc-list-head"><h3>Perguntas</h3><button type="button" class="btn btn-outline" data-sqc-add>+ Adicionar pergunta</button></div><div data-config-questions></div></section><aside><h3>Pré-visualização</h3><div id="tgSurveyConfigPreview" class="tg-sqc-preview"></div><p class="tg-sqc-tip">O logótipo apresentado no inquérito será o da empresa definido em Perfil e empresa. Cada OS conserva as perguntas da versão com que o link foi criado.</p></aside></div><footer><small data-sqc-version></small><span id="tgSurveyConfigStatus" role="status"></span><button type="button" class="btn btn-outline" data-sqc-reset>Restaurar perguntas</button><button type="button" class="btn btn-primary" data-sqc-save>Guardar e publicar</button></footer></div>';
 document.body.append(overlay);
 overlay.addEventListener('click',e=>{if(e.target===overlay||e.target.closest('[data-sqc-close]'))overlay.remove();});
 overlay.addEventListener('input',e=>{
  if(!state||!canEdit())return;
  if(e.target.matches('[data-sqc-title]'))state.titulo=e.target.value;
  else if(e.target.matches('[data-sqc-intro]'))state.introducao=e.target.value;
  else if(e.target.matches('[data-sqc-label]')){
   const i=Number(e.target.closest('[data-sqc-index]')?.dataset.sqcIndex);
   if(state.perguntas[i])state.perguntas[i].label=e.target.value;
  }
  dirty=true;preview();
 });
 overlay.addEventListener('change',e=>{
  const row=e.target.closest('[data-sqc-index]');if(!row||!canEdit())return;
  const i=Number(row.dataset.sqcIndex),question=state?.perguntas?.[i];if(!question)return;
  if(e.target.matches('[data-sqc-type]'))question.type=e.target.value;
  if(e.target.matches('[data-sqc-required]'))question.required=e.target.checked;
  dirty=true;preview();
 });
 overlay.addEventListener('click',async e=>{
  const button=e.target.closest('button');if(!button||!state||!canEdit())return;
  const row=button.closest('[data-sqc-index]'),i=Number(row?.dataset.sqcIndex);
  if(button.matches('[data-sqc-up]')&&i>0){[state.perguntas[i-1],state.perguntas[i]]=[state.perguntas[i],state.perguntas[i-1]];dirty=true;render();}
  if(button.matches('[data-sqc-down]')&&i<state.perguntas.length-1){[state.perguntas[i+1],state.perguntas[i]]=[state.perguntas[i],state.perguntas[i+1]];dirty=true;render();}
  if(button.matches('[data-sqc-delete]')&&!fixed.some(k=>k.id===state.perguntas[i]?.id)){state.perguntas.splice(i,1);dirty=true;render();}
  if(button.matches('[data-sqc-add]')){
   if(state.perguntas.length>=20){notify('Máximo de 20 perguntas.',true);return;}
   state.perguntas.push({id:'extra_'+crypto.randomUUID().replaceAll('-',''),label:'Nova pergunta',type:'rating',required:false});dirty=true;render();
  }
  if(button.matches('[data-sqc-reset]')){state.perguntas=fixed.map(q=>({...q}));dirty=true;render();}
  if(button.matches('[data-sqc-save]'))await save(button);
 });
 const close=overlay.querySelector('[data-sqc-close]');close.focus();
 load().then(()=>{if(!overlay.isConnected)return;overlay.querySelector('[data-sqc-title]').value=state.titulo;overlay.querySelector('[data-sqc-intro]').value=state.introducao;render();})
 .catch(e=>notify('Não foi possível carregar a configuração: '+e.message,true));
}
async function save(button){
 if(!canEdit()||!state)return;
 const title=state.titulo.trim(),intro=state.introducao.trim(),questions=state.perguntas.map(x=>({...x,label:x.label.trim()}));
 if(title.length<5||title.length>140)return notify('O título deve ter entre 5 e 140 caracteres.',true);
 if(intro.length>600)return notify('Introdução demasiado longa.',true);
 if(questions.length<5||questions.length>20||questions.some(q=>q.label.length<5||q.label.length>180||!['rating','yesno','text'].includes(q.type)))return notify('Revise o texto e o tipo das perguntas.',true);
 if(new Set(questions.map(q=>q.id)).size!==questions.length)return notify('Foram encontradas perguntas duplicadas.',true);
 if(fixed.some(f=>!questions.some(q=>q.id===f.id&&q.type==='rating'&&q.required)))return notify('Mantenha as cinco perguntas-base obrigatórias.',true);
 button.disabled=true;notify('A guardar…');
 try{
  const tenant=org(),next=state.versao+1,payload={admin_id:tenant,titulo:title,introducao:intro,perguntas:questions,versao:next,atualizado_em:new Date().toISOString()};
  let query;
  if(state.versao===0)query=await db().from('configuracoes_inquerito_os').insert(payload).select('versao').single();
  else query=await db().from('configuracoes_inquerito_os').update(payload).eq('admin_id',tenant).eq('versao',state.versao).select('versao').maybeSingle();
  if(query.error)throw query.error;
  if(!query.data)throw Error('A configuração foi alterada por outra sessão. Feche e reabra para atualizar.');
  state.versao=query.data.versao;dirty=false;render();notify('Inquérito publicado. Os novos links utilizarão esta versão.');
 }catch(e){notify('Erro ao guardar: '+e.message,true);}
 finally{button.disabled=false;}
}
async function snapshot(){
 if(!org()||!db())return null;
 const {data,error}=await db().from('configuracoes_inquerito_os').select('titulo,introducao,perguntas,versao').eq('admin_id',org()).maybeSingle();
 if(error)throw error;
 const q=data||defaults();
 const questions=Array.isArray(q.perguntas)&&q.perguntas.length?q.perguntas:fixed;
 return {titulo:q.titulo,introducao:q.introducao,perguntas:questions,versao:q.versao||0};
}
window.TGSurveyConfig={open,snapshot,defaults,fixed};
})();
