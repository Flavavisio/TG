// Ativa o trial mediante o token enviado por email e guarda a palavra-passe apenas no Supabase Auth.
import { serve } from "https://deno.land/std@0.192.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { validarPackTrial, direitosPackTrial } from '../_shared/packs.ts';

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
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

  if (req.method !== "POST") {
    return resposta("Defina a sua palavra-passe", "Abra o link de confirmação numa janela atualizada.", false, 405);
  }
  const { token, senha } = await req.json().catch(() => ({}));
  if (typeof token !== "string" || !token || token.length > 128) {
    return resposta("Falta o token", "Este link não é válido.", false, 400);
  }
  if (typeof senha !== "string" || senha.length < 9 || new TextEncoder().encode(senha).length > 72 ||
      !/[A-Z]/.test(senha) || !/[^A-Za-z0-9]/.test(senha)) {
    return resposta("Palavra-passe inválida", "Use pelo menos 9 caracteres, uma maiúscula e um símbolo, até 72 bytes.", false, 400);
  }

  const { data: pedido, error: errPedido } = await admin
    .from("pedidos_trial").select("id, email, confirmado, criado_em, plano, pack_escalao, pack_blocos, nome, empresa, addons").eq("token", token).maybeSingle();

  if (errPedido || !pedido) {
    return resposta("Link inválido", "Não encontrámos este pedido. Pode já ter sido usado, ou o link expirou.", false, 404);
  }
  if (pedido.confirmado) {
    return resposta("Já confirmado", "Esta conta já foi ativada anteriormente. Pode entrar normalmente com o email e a password que escolheu.", true, 200);
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
    const pack = validarPackTrial(pedido.plano, pedido.pack_escalao, pedido.pack_blocos);
    const maxFuncionarios = pack?.maxFuncionarios || MAX_FUNC_POR_PLANO[pedido.plano as string] || 5;
    const novoAdminId = "trial_" + pedido.id;
    const { data: authUser, error: errAuth } = await admin.auth.admin.createUser({
      email: pedido.email,
      password: senha,
      email_confirm: true,
      app_metadata: { pedido_trial_id: pedido.id },
    });
    let userId = authUser?.user?.id;
    let ativadoEm = authUser?.user?.created_at;
    if (errAuth) {
      if (!["email_exists", "user_already_exists"].includes(errAuth.code || "")) throw errAuth;
      // A retoma só aceita a conta Auth criada para este pedido. Nunca redefine a
      // palavra-passe de uma conta existente, mesmo quando o email é o mesmo.
      const { data: conta, error } = await admin.rpc("tg_conta_auth_trial", { pedido: pedido.id }).maybeSingle();
      if (error) throw error;
      if (!conta) return resposta("Email já registado", "Entre na sua conta ou recupere a sua palavra-passe.", false, 409);
      userId = conta.id;
      ativadoEm = conta.created_at;
    }
    if (!userId || !ativadoEm) throw new Error("Conta Auth indisponível.");
    const agora = new Date(ativadoEm);
    const expiracao = new Date(agora.getTime() + 14 * 24 * 60 * 60 * 1000);

    // No trial, os add-ons ficam ativos durante os 14 dias para a pessoa experimentar a app
    // completa, independentemente dos que marcou como "de interesse" no checkout — isso fica
    // só registado em plano_pretendido/addons_pretendidos, para o Super Admin saber o que
    // propor quando o trial acabar (não é isso que decide o que fica ligado agora).
    const { error: errAdmin } = await admin.from("administradores").upsert([{
      id: novoAdminId,
      nome: pedido.nome,
      email: pedido.email,
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
    }], { onConflict: "id", ignoreDuplicates: true });
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
    }], { onConflict: "admin_id", ignoreDuplicates: true });
    if (errLic) throw errLic;

    const { error: errPerfil } = await admin.from("perfis").upsert(
      [{ id: userId, email: pedido.email, papel: "admin", admin_id: novoAdminId, registo_id: novoAdminId }],
      { onConflict: "id", ignoreDuplicates: true },
    );
    if (errPerfil) throw errPerfil;

    const { error: errConfirmacao } = await admin.from("pedidos_trial").update({
      confirmado: true,
      confirmado_em: agora.toISOString(),
      admin_id: novoAdminId,
    }).eq("token", token);
    if (errConfirmacao) throw errConfirmacao;

    return resposta(
      "Conta ativada! 🎉",
      "A sua conta está pronta. Já pode entrar com o email e a palavra-passe que definiu.",
      true,
      200
    );

  } catch (e) {
    console.error(e);
    return resposta("Ocorreu um erro", "Não foi possível ativar a conta agora. Contacte-nos e resolvemos manualmente.", false, 500);
  }
});
