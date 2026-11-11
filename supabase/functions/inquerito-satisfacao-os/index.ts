import { createClient } from 'npm:@supabase/supabase-js@2.57.0';
const endpoint=Deno.env.get('SUPABASE_URL')||'';
const secret=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
const db=createClient(endpoint,secret,{auth:{persistSession:false}});
const cors={'Access-Control-Allow-Origin':'https://www.totalgest.pt','Access-Control-Allow-Methods':'GET,POST,OPTIONS','Access-Control-Allow-Headers':'content-type,apikey','Cache-Control':'no-store','Content-Type':'application/json; charset=utf-8'};
const response=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:cors});
const valid=(t:unknown)=>typeof t==='string' && /^[a-f0-9]{64}$/.test(t);
const number=(n:unknown)=>Number.isInteger(n)&&Number(n)>=1&&Number(n)<=5;
Deno.serve(async(req:Request)=>{
 if(req.method==='OPTIONS')return new Response('',{headers:cors});
 if(!endpoint||!secret)return response({error:'Serviço temporariamente indisponível'},503);
 if(!['GET','POST'].includes(req.method))return response({error:'Método inválido'},405);
 let token='';
 let body:Record<string,unknown>={};
 try{
  if(req.method==='GET') token=new URL(req.url).searchParams.get('token')||'';
  else {body=await req.json();token=String(body.token||'');}
 }catch{return response({error:'Pedido inválido'},400);}
 if(!valid(token))return response({error:'Ligação inválida'},404);
 const {data:survey,error}=await db.from('inqueritos_satisfacao_os').select('id,admin_id,cliente_id,servico_id,expira_em,respondido_em').eq('token',token).maybeSingle();
 if(error)return response({error:'Não foi possível consultar o inquérito'},503);
 if(!survey)return response({error:'Inquérito não encontrado'},404);
 if(new Date(survey.expira_em).getTime()<Date.now())return response({error:'Este inquérito expirou'},410);
 if(req.method==='POST'){
  if(survey.respondido_em)return response({error:'Este inquérito já foi respondido'},409);
  for(const field of ['avaliacao_tecnico','avaliacao_execucao','avaliacao_pontualidade','avaliacao_limpeza','avaliacao_geral'])if(!number(body[field]))return response({error:'Preencha todas as avaliações de 1 a 5'},400);
  const comment=String(body.comentario||'').trim();if(comment.length>3000)return response({error:'Comentário demasiado longo'},400);
  const values=Object.fromEntries(['avaliacao_tecnico','avaliacao_execucao','avaliacao_pontualidade','avaliacao_limpeza','avaliacao_geral'].map(f=>[f,body[f]]));
  const {data:changed,error:saveError}=await db.from('inqueritos_satisfacao_os').update({...values,comentario:comment,respondido_em:new Date().toISOString()}).eq('id',survey.id).is('respondido_em',null).select('id').maybeSingle();
  if(saveError)return response({error:'Não foi possível guardar a resposta'},503);
  if(!changed)return response({error:'Este inquérito já foi respondido'},409);
  return response({ok:true});
 }
 if(survey.respondido_em)return response({respondido:true});
 const [cl,os]=await Promise.all([
  db.from('clientes').select('id,nome').eq('id',survey.cliente_id).eq('admin_id',survey.admin_id).maybeSingle(),
  db.from('servicos').select('id,numero_registo,cliente_id,admin_id,funcionario_id,data,descricao,local_id').eq('id',survey.servico_id).eq('admin_id',survey.admin_id).maybeSingle()
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
 return response({ok:true,cliente:cl.data.nome||'',instalacao,os:os.data.numero_registo||'',data:os.data.data||'',tecnico,descricao:os.data.descricao||''});
});