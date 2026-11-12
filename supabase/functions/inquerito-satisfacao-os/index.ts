import { createClient } from 'npm:@supabase/supabase-js@2.57.0';
const endpoint=Deno.env.get('SUPABASE_URL')||'';
const secret=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
const db=createClient(endpoint,secret,{auth:{persistSession:false}});
const cors={'Access-Control-Allow-Origin':'https://www.totalgest.pt','Access-Control-Allow-Methods':'GET,POST,OPTIONS','Access-Control-Allow-Headers':'content-type,apikey','Cache-Control':'no-store','Content-Type':'application/json; charset=utf-8'};
const response=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:cors});
const valid=(t:unknown)=>typeof t==='string'&&/^[a-f0-9]{64}$/.test(t);
const stars=(n:unknown)=>Number.isInteger(n)&&Number(n)>=1&&Number(n)<=5;
type Question={id:string;label:string;type:'rating'|'yesno'|'text';required:boolean};
const defaultQuestions:Question[]=[
 {id:'avaliacao_tecnico',label:'Atendimento e profissionalismo do técnico',type:'rating',required:true},
 {id:'avaliacao_execucao',label:'Qualidade da execução do serviço ou obra',type:'rating',required:true},
 {id:'avaliacao_pontualidade',label:'Pontualidade e cumprimento dos horários',type:'rating',required:true},
 {id:'avaliacao_limpeza',label:'Organização e limpeza no final da intervenção',type:'rating',required:true},
 {id:'avaliacao_geral',label:'Satisfação geral com o serviço',type:'rating',required:true}
];
const fallback={titulo:'Como correu a nossa intervenção?',introducao:'A sua opinião ajuda-nos a melhorar o nosso serviço.',versao:0,perguntas:defaultQuestions};
function form(snapshot:unknown){
 const s=snapshot&&typeof snapshot==='object'?snapshot as Record<string,unknown>:{};
 const qs=Array.isArray(s.perguntas)?s.perguntas:[];
 const allowed=qs.filter((v):v is Question=>!!v&&typeof v==='object'&&
  typeof v.id==='string'&&/^[a-z0-9_-]{6,80}$/.test(v.id)&&
  typeof v.label==='string'&&v.label.length>=5&&v.label.length<=180&&
  ['rating','yesno','text'].includes(v.type)).slice(0,20);
 const base=defaultQuestions.every(q=>allowed.some(x=>x.id===q.id&&x.type==='rating'&&x.required===true));
 return {titulo:typeof s.titulo==='string'?s.titulo.slice(0,140):fallback.titulo,
  introducao:typeof s.introducao==='string'?s.introducao.slice(0,600):fallback.introducao,
  versao:Number.isInteger(s.versao)?s.versao:0,perguntas:base?allowed:defaultQuestions};
}
function safeLogo(raw:unknown){
 if(typeof raw!=='string'||raw.length>600000)return '';
 if(/^https:\/\/[^\s"'<>]+$/i.test(raw))return raw;
 if(/^data:image\/(png|jpeg|webp|gif);base64,[a-z0-9+/=]+$/i.test(raw))return raw;
 return '';
}
Deno.serve(async(req:Request)=>{
 if(req.method==='OPTIONS')return new Response('',{headers:cors});
 if(!endpoint||!secret)return response({error:'Serviço temporariamente indisponível'},503);
 if(!['GET','POST'].includes(req.method))return response({error:'Método inválido'},405);
 let token='',body:Record<string,unknown>={};
 try{
  if(req.method==='GET')token=new URL(req.url).searchParams.get('token')||'';
  else{const raw=await req.text();if(raw.length>15000)return response({error:'Formulário demasiado extenso'},413);body=JSON.parse(raw);token=String(body.token||'');}
 }catch{return response({error:'Pedido inválido'},400);}
 if(!valid(token))return response({error:'Ligação inválida'},404);
 const {data:survey,error}=await db.from('inqueritos_satisfacao_os').select('id,admin_id,cliente_id,servico_id,expira_em,respondido_em,formulario_snapshot').eq('token',token).maybeSingle();
 if(error)return response({error:'Não foi possível consultar o inquérito'},503);
 if(!survey)return response({error:'Inquérito não encontrado'},404);
 if(new Date(survey.expira_em).getTime()<Date.now())return response({error:'Este inquérito expirou'},410);
 const snapshot=form(survey.formulario_snapshot);
 if(req.method==='POST'){
  if(survey.respondido_em)return response({error:'Este inquérito já foi respondido'},409);
  for(const f of defaultQuestions)if(!stars(body[f.id]))return response({error:'Preencha todas as avaliações de 1 a 5'},400);
  const extras=body.respostas_personalizadas;
  if(extras!==undefined&&(!extras||typeof extras!=='object'||Array.isArray(extras)))return response({error:'Respostas adicionais inválidas'},400);
  const submitted=(extras||{}) as Record<string,unknown>,clean:Record<string,unknown>={};
  const custom=snapshot.perguntas.filter(q=>!defaultQuestions.some(f=>f.id===q.id));
  if(Object.keys(submitted).length>custom.length)return response({error:'Respostas adicionais desconhecidas'},400);
  for(const q of custom){
   const value=submitted[q.id],empty=value===undefined||value===null||value==='';
   if(empty){if(q.required)return response({error:'Responda a todas as perguntas obrigatórias'},400);continue;}
   if(q.type==='rating'){if(!stars(value))return response({error:'Classificação adicional inválida'},400);clean[q.id]=value;}
   else if(q.type==='yesno'){if(typeof value!=='boolean')return response({error:'Resposta Sim/Não inválida'},400);clean[q.id]=value;}
   else {if(typeof value!=='string'||value.trim().length>1500)return response({error:'Texto demasiado longo'},400);clean[q.id]=value.trim();}
  }
  const comment=String(body.comentario||'').trim();if(comment.length>3000)return response({error:'Comentário demasiado longo'},400);
  const values=Object.fromEntries(defaultQuestions.map(f=>[f.id,body[f.id]]));
  const {data:changed,error:saveError}=await db.from('inqueritos_satisfacao_os').update({...values,respostas_personalizadas:clean,comentario:comment,respondido_em:new Date().toISOString()}).eq('id',survey.id).is('respondido_em',null).select('id').maybeSingle();
  if(saveError)return response({error:'Não foi possível guardar a resposta'},503);
  if(!changed)return response({error:'Este inquérito já foi respondido'},409);
  return response({ok:true});
 }
 if(survey.respondido_em)return response({respondido:true});
 const [cl,os,admin]=await Promise.all([
  db.from('clientes').select('id,nome').eq('id',survey.cliente_id).eq('admin_id',survey.admin_id).maybeSingle(),
  db.from('servicos').select('id,numero_registo,cliente_id,admin_id,funcionario_id,data,descricao,local_id').eq('id',survey.servico_id).eq('admin_id',survey.admin_id).maybeSingle(),
  db.from('administradores').select('empresa,logo').eq('id',survey.admin_id).maybeSingle()
 ]);
 if(cl.error||os.error||!cl.data||!os.data||os.data.cliente_id!==cl.data.id)return response({error:'Serviço não encontrado'},404);
 let tecnico='';
 if(os.data.funcionario_id){
  const t=await db.from('funcionarios').select('nome').eq('id',os.data.funcionario_id).eq('admin_id',survey.admin_id).maybeSingle();
  tecnico=t.data?.nome||'';
 }
 let instalacao='';
 if(os.data.local_id){
  const l=await db.from('locais').select('nome').eq('id',os.data.local_id).eq('admin_id',survey.admin_id).eq('cliente_id',survey.cliente_id).maybeSingle();
  instalacao=l.data?.nome||'';
 }
 return response({ok:true,cliente:cl.data.nome||'',instalacao,os:os.data.numero_registo||'',data:os.data.data||'',tecnico,descricao:os.data.descricao||'',
  formulario:snapshot,empresa:admin.data?.empresa||'',logo:safeLogo(admin.data?.logo)});
});