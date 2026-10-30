// Edge Function: confirmar-trial
// Deploy: supabase functions deploy confirmar-trial --no-verify-jwt
// (--no-verify-jwt porque é chamada por um link de email, sem sessão iniciada)
//
// Precisa de duas variáveis de ambiente (a service role key NUNCA deve ir para o frontend):
// supabase secrets set SUPABASE_URL=https://xxxx.supabase.co
// supabase secrets set SUPABASE_SERVICE_ROLE_KEY=xxxxx   (Project Settings → API → service_role)
//
// A pessoa já escolheu a password no formulário (guardada em pedidos_trial.senha_pendente).
// Esta função só confirma o email e cria a conta já com essa password — não há
// segundo email nenhum a enviar, a pessoa pode entrar logo a seguir.
//
// ALTERAÇÃO (checkout com plano/add-ons): o formulário de signup agora deixa a pessoa escolher
// já um plano (nº de funcionários) e marcar add-ons de interesse. Se `criar_pedido_trial` gravar
// isso em pedidos_trial.plano e pedidos_trial.addons (colunas novas — ver migração em baixo),
// esta função usa o plano para definir o limite de funcionários correto da licença de trial (em
// vez do 5 fixo que tinha antes), e grava o que a pessoa pretendia em administradores, para o
// Super Admin ver isso ao acompanhar a conversão do trial em plano pago. Se essas colunas ainda
// não existirem ou vierem vazias, o comportamento cai sempre no que já era antes (5 lugares,
// nada de pretendido gravado) — não faz a função falhar.

import { serve } from "https://deno.land/std@0.192.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { validarPackTrial, direitosPackTrial } from '../_shared/packs.ts';

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

function gerarId() {
  return 'a' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
function resposta(titulo: string, mensagem: string, sucesso: boolean, status: number) {
  return new Response(JSON.stringify({ titulo, mensagem, sucesso }), {
    status,
    headers: { ...cors, "Content-Type": "application/json; charset=utf-8" },
  });
}

// Nº de funcionários incluído em cada plano escolhido no checkout — usado só para definir o
// limite (max_funcionarios) da licença de trial. Sem plano reconhecido, mantém o valor de sempre
// (5), que é o mínimo de qualquer um deles.
const MAX_FUNC_POR_PLANO: Record<string, number> = {
  "5": 5,
  "10": 10,
  "25": 25,
  "50": 50,
  "100": 100,
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const url = new URL(req.url);
  const token = url.searchParams.get("token");

  if (!token) {
    return resposta("Falta o token", "Este link não é válido.", false, 400);
  }

  const { data: pedido, error: errPedido } = await admin
    .from("pedidos_trial").select("*").eq("token", token).maybeSingle();

  if (errPedido || !pedido) {
    return resposta("Link inválido", "Não encontrámos este pedido. Pode já ter sido usado, ou o link expirou.", false, 404);
  }
  if (pedido.confirmado) {
    return resposta("Já confirmado", "Esta conta já foi ativada anteriormente. Pode entrar normalmente com o email e a password que escolheu.", true, 200);
  }
  if (!pedido.senha_pendente) {
    return resposta("Ocorreu um erro", "Não encontrámos a password escolhida para este pedido. Contacte-nos e resolvemos manualmente.", false, 500);
  }

  const HORAS_VALIDADE = 48;
  const criadoEm = new Date(pedido.criado_em).getTime();
  const horasPassadas = (Date.now() - criadoEm) / (1000 * 60 * 60);
  if (horasPassadas > HORAS_VALIDADE) {
    return resposta(
      "Link expirado",
      "Este link de confirmação já não é válido — passaram mais de 48 horas desde o pedido. Volta ao site e preenche o formulário novamente para pedires um novo link.",
      false,
      410
    );
  }

  try {
    const agora = new Date();
    const expiracao = new Date(agora.getTime() + 14 * 24 * 60 * 60 * 1000);
    const pack = validarPackTrial(pedido.plano, pedido.pack_escalao, pedido.pack_blocos);
    const maxFuncionarios = pack?.maxFuncionarios || MAX_FUNC_POR_PLANO[pedido.plano as string] || 5;

    let userId: string;
    const { data: authUser, error: errAuth } = await admin.auth.admin.createUser({
      email: pedido.email,
      password: pedido.senha_pendente,
      email_confirm: true,
    });

    if (errAuth) {
      const jaExiste = /already.*registered|already been registered/i.test(errAuth.message || "");
      if (!jaExiste) throw errAuth;
      const { data: listaUsers, error: errLista } = await admin.auth.admin.listUsers();
      if (errLista) throw errLista;
      const existente = listaUsers.users.find(u => (u.email || "").toLowerCase() === pedido.email.toLowerCase());
      if (!existente) throw new Error("utilizador diz que já existe mas não foi encontrado");
      userId = existente.id;
      const { error: errUpdatePw } = await admin.auth.admin.updateUserById(userId, { password: pedido.senha_pendente });
      if (errUpdatePw) throw errUpdatePw;
    } else {
      if (!authUser?.user) throw new Error("falha ao criar utilizador de autenticação");
      userId = authUser.user.id;
    }

    const { data: perfilExistente, error: errPerfilLer } = await admin
      .from("perfis").select("registo_id").eq("id", userId).maybeSingle();
    if (errPerfilLer) throw errPerfilLer;

    const novoAdminId = perfilExistente?.registo_id || gerarId();

    if (!perfilExistente) {
      const { error: errPerfil } = await admin.from("perfis").insert([{ id: userId, papel: "admin", registo_id: novoAdminId }]);
      if (errPerfil) throw errPerfil;
    }

    // No trial, os add-ons ficam ativos durante os 14 dias para a pessoa experimentar a app
    // completa, independentemente dos que marcou como "de interesse" no checkout — isso fica
    // só registado em plano_pretendido/addons_pretendidos, para o Super Admin saber o que
    // propor quando o trial acabar (não é isso que decide o que fica ligado agora).
    const { error: errAdmin } = await admin.from("administradores").upsert([{
      id: novoAdminId,
      nome: pedido.nome,
      email: pedido.email,
      senha: "",
      empresa: pedido.empresa,
      ativo: true,
      data_criacao: agora.toISOString(),
      contratos_plano: "demo",
      contratos_expiracao: expiracao.toISOString(),
      frota_plano: "demo",
      frota_expiracao: expiracao.toISOString(),
      armazem_plano: "demo",
      armazem_expiracao: expiracao.toISOString(),
      crm_plano: "demo",
      crm_expiracao: expiracao.toISOString(),
      assist_plano: "demo",
      assist_expiracao: expiracao.toISOString(),
      plano_pretendido: pedido.plano || null,
      addons_pretendidos: pedido.addons || null,
      // Ao escolher um pack, o teste tem os direitos exatos desse pack.
      ...(pack ? {
        contratos_plano: null, contratos_expiracao: null,
        frota_plano: null, frota_expiracao: null,
        armazem_plano: null, armazem_expiracao: null,
        crm_plano: null, crm_expiracao: null,
        assist_plano: null, assist_expiracao: null,
        pack_atual: pack.plano, pack_escalao: pack.escalao, pack_blocos: pack.blocos,
        ...direitosPackTrial(pack.plano, expiracao.toISOString()),
      } : {}),
    }], { onConflict: "id" });
    if (errAdmin) throw errAdmin;

    // Mantém o identificador interno "demo_30" por compatibilidade com a app;
    // a duração efetiva do trial é agora de 14 dias. max_funcionarios reflete agora o plano
    // escolhido no checkout (5 por defeito, se não vier nenhum reconhecido).
    const { error: errLic } = await admin.from("licencas").upsert([{
      admin_id: novoAdminId,
      codigo: "TRIAL-" + novoAdminId.slice(-6).toUpperCase(),
      plano: "demo_30",
      data_inicio: agora.toISOString(),
      data_expiracao: expiracao.toISOString(),
      dias: 14,
      max_funcionarios: maxFuncionarios,
      ativa: true
    }], { onConflict: "admin_id" });
    if (errLic) throw errLic;

    await admin.from("pedidos_trial").update({
      confirmado: true,
      confirmado_em: agora.toISOString(),
      admin_id: novoAdminId,
      senha_pendente: null,
    }).eq("token", token);

    return resposta(
      "Conta ativada! 🎉",
      "A sua conta está pronta. Já pode entrar com o email e a password que escolheu no formulário.",
      true,
      200
    );

  } catch (e) {
    console.error(e);
    return resposta("Ocorreu um erro", "Não foi possível ativar a conta agora. Contacte-nos e resolvemos manualmente.", false, 500);
  }
});
