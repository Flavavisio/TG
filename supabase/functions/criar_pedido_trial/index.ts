// Edge Function: criar_pedido_trial
// ⚠️ VERSÃO TEMPORÁRIA PARA TESTES — o limite de 2 pedidos/dia por IP está DESATIVADO.
// Quando acabares de testar, volta a publicar o ficheiro original
// (criar_pedido_trial_edge_function.ts) para reativar a proteção.
//
// NOVO: além do email de confirmação enviado ao lead, esta versão também
// avisa o dono da plataforma (totalgestpro@gmail.com) sempre que alguém
// pede o trial de 30 dias, com os dados de quem se inscreveu.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { validarPackTrial, PACKS_TRIAL } from '../_shared/packs.ts';

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

function obterIp(req: Request): string {
  const cf = req.headers.get("cf-connecting-ip");
  if (cf) return cf;
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return "desconhecido";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const body = await req.json().catch(() => ({}));
    const { empresa, nome, email, telefone, colaboradores, nif, senha } = body;
    let pack;
    try {
      if (body.plano && !Object.hasOwn(PACKS_TRIAL, String(body.plano)) && !['5', '10', '25', '50', '100'].includes(String(body.plano))) {
        throw new Error('Pack inválido.');
      }
      pack = validarPackTrial(body.plano, body.escalao, body.blocosExtra);
    } catch (err) {
      return json({ erro: (err as Error).message }, 400);
    }

    if (!empresa || !nome || !email || !telefone || !senha) {
      return json({ erro: "Faltam dados obrigatórios (empresa, nome, email, telefone, senha)." }, 400);
    }
    const senhaValida = senha.length >= 9 && /[A-Z]/.test(senha) && /[^A-Za-z0-9]/.test(senha);
    if (!senhaValida) {
      return json({ erro: "A palavra-passe precisa de pelo menos 9 caracteres, 1 maiúscula e 1 símbolo." }, 400);
    }

    const ip = obterIp(req);

    // ------------------------------------------------------------------
    // LIMITE DE 2 PEDIDOS/DIA POR IP — TEMPORARIAMENTE DESATIVADO
    // Para reativar: descomenta o bloco abaixo (ou publica de novo o
    // ficheiro criar_pedido_trial_edge_function.ts original).
    // ------------------------------------------------------------------
    // const inicioDia = new Date();
    // inicioDia.setUTCHours(0, 0, 0, 0);
    // const { count, error: errContagem } = await admin
    //   .from("pedidos_trial")
    //   .select("id", { count: "exact", head: true })
    //   .eq("ip", ip)
    //   .gte("criado_em", inicioDia.toISOString());
    // if (errContagem) {
    //   console.error(errContagem);
    //   return json({ erro: "Erro ao validar o pedido. Tenta novamente." }, 500);
    // }
    // if ((count ?? 0) >= 2) {
    //   return json({ erro: "Já foram feitos 2 pedidos a partir desta ligação hoje. Tenta novamente amanhã, ou contacta-nos diretamente." }, 429);
    // }

    const emailNormalizado = String(email).toLowerCase();

    // Impede pedir trial com um email que já tem conta (ou já confirmou um trial antes)
    const { data: adminExistente, error: errAdmin } = await admin
      .from("administradores")
      .select("id")
      .eq("email", emailNormalizado)
      .maybeSingle();
    if (errAdmin) { console.error(errAdmin); return json({ erro: "Erro ao validar o pedido. Tenta novamente." }, 500); }
    if (adminExistente) {
      return json({ erro: "Este email já tem uma conta Total Gest. Usa outro email ou faz login na área de parceiro." }, 409);
    }

    const { data: pedidoConfirmado, error: errPedido } = await admin
      .from("pedidos_trial")
      .select("id")
      .eq("email", emailNormalizado)
      .eq("confirmado", true)
      .limit(1)
      .maybeSingle();
    if (errPedido) { console.error(errPedido); return json({ erro: "Erro ao validar o pedido. Tenta novamente." }, 500); }
    if (pedidoConfirmado) {
      return json({ erro: "Este email já ativou uma conta de teste anteriormente. Usa outro email ou faz login na área de parceiro." }, 409);
    }

    const token = crypto.randomUUID();

    const { error: errInsert } = await admin.from("pedidos_trial").insert([{
      empresa, nome, email: String(email).toLowerCase(), telefone,
      colaboradores: colaboradores || null,
      nif: nif || null,
      token,
      ip,
      confirmado: false,
      senha_pendente: senha,
      plano: body.plano || null,
      addons: Array.isArray(body.addons) ? body.addons.filter((v: unknown) => typeof v === 'string') : [],
      pack_escalao: pack?.escalao || null,
      pack_blocos: pack?.blocos || 0,
      criado_em: new Date().toISOString(),
    }]);

    if (errInsert) {
      console.error(errInsert);
      return json({ erro: "Não foi possível gravar o pedido. Tenta novamente." }, 500);
    }

    // Envia o email de confirmação já aqui, servidor-a-servidor — evita por completo
    // os problemas de CORS que aconteciam quando era o browser a chamar "enviar-mail".
    try {
      // busca o nome/logótipo reais da plataforma (antes estava fixo "Total Gest" sem logótipo)
      const { data: config } = await admin.from("config_superadmin").select("*").eq("id", true).maybeSingle();
      const plataforma = config?.nome || "Total Gest";
      const logo_url = config?.logo || "";

      const linkConfirmacao = `https://www.totalgest.pt/confirmar-trial.html?token=${encodeURIComponent(token)}`; // usa o domínio próprio (em vez do endereço direto do Supabase) para não cair em spam
      const respEmail = await fetch(`${SUPABASE_URL}/functions/v1/super-function`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${SERVICE_ROLE_KEY}`,
          "apikey": SERVICE_ROLE_KEY,
        },
        body: JSON.stringify({
          tipo: "confirmar_trial",
          to_email: String(email).toLowerCase(),
          to_name: nome,
          plataforma,
          logo_url,
          link_confirmacao: linkConfirmacao,
        }),
      });
      if (!respEmail.ok) console.error("enviar-mail respondeu com erro:", respEmail.status, await respEmail.text());
    } catch (e) {
      console.error("Falha ao chamar enviar-mail:", e);
      // não bloqueia o pedido — o registo já ficou gravado, só o email é que pode ter falhado
    }

    // NOVO: aviso interno para o dono da plataforma — sempre que alguém se inscreve
    // no trial. Também não bloqueia o pedido se falhar (só regista no log).
    try {
      const respAvisoInterno = await fetch(`${SUPABASE_URL}/functions/v1/super-function`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${SERVICE_ROLE_KEY}`,
          "apikey": SERVICE_ROLE_KEY,
        },
        body: JSON.stringify({
          tipo: "aviso_novo_trial",
          to_email: "totalgestpro@gmail.com",
          plataforma: "Total Gest",
          empresa, nome,
          email_lead: String(email).toLowerCase(),
          telefone, colaboradores, nif, ip,
        }),
      });
      if (!respAvisoInterno.ok) console.error("aviso interno de trial respondeu com erro:", respAvisoInterno.status, await respAvisoInterno.text());
    } catch (e) {
      console.error("Falha ao enviar aviso interno de novo trial:", e);
    }

    return json({ ok: true, token });
  } catch (e) {
    console.error(e);
    return json({ erro: String(e) }, 500);
  }
});
