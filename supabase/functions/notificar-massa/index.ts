// ============================================================================
//  Edge Function: notificar-massa
//  Envia uma notificação (in-app + push) do Super Admin para um ou mais
//  grupos de destinatários, em TODAS as empresas — admins, sub-admins,
//  funcionários (inclui encarregados) e/ou clientes.
//
//  Isto é uma comunicação da própria plataforma, por isso NÃO depende do
//  add-on de Notificações de cada empresa (esse add-on rege as notificações
//  que uma empresa envia aos SEUS funcionários/clientes, não as da Total Gest).
//
//  Deploy (painel Supabase):
//   Edge Functions > notificar-massa > Editar > colar este código > Deploy.
//
//  Secrets necessários: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//
//  Corpo do pedido: { grupos: string[] (subconjunto de ['admins','subadmins',
//  'funcionarios','clientes']), titulo, mensagem }
// ============================================================================
import { createClient } from "npm:@supabase/supabase-js@2";
import { perfilAutenticado, tokenBearer } from "../_shared/acesso-servidor.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ erro: "Método não permitido." }, 405);

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!SUPABASE_URL || !SERVICE_KEY) return json({ erro: "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY não configurados." }, 500);
    const token = tokenBearer(req);
    if (!token) return json({ erro: "Autenticação necessária." }, 401);
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
    const perfil = await perfilAutenticado(supabase, token);
    if (!perfil) return json({ erro: "Sessão inválida." }, 401);
    if (perfil.papel !== "superadmin") return json({ erro: "Sem permissão para notificar em massa." }, 403);

    const body = await req.json().catch(() => ({}));
    const { grupos, titulo, mensagem } = body;
    if (!Array.isArray(grupos) || !grupos.length || grupos.length > 4 ||
        !grupos.every(grupo => ["admins", "subadmins", "funcionarios", "clientes"].includes(grupo)) ||
        typeof titulo !== "string" || !titulo.trim() || titulo.length > 160 ||
        typeof mensagem !== "string" || !mensagem.trim() || mensagem.length > 1500) {
      return json({ erro: "Faltam dados (grupos, titulo, mensagem)." }, 400);
    }

    // Reúne os destinatários: { id, admin_id } — admin_id é usado para o gate de
    // notificações do lado do cliente na app (não se aplica aqui, mas mantém a
    // consistência do registo).
    const destinatarios = [];

    if (grupos.includes("admins")) {
      const { data, error } = await supabase.from("administradores").select("id").neq("id", "superadmin");
      if (error) throw error;
      (data || []).forEach((a) => destinatarios.push({ id: a.id, admin_id: a.id }));
    }
    if (grupos.includes("subadmins")) {
      const { data, error } = await supabase.from("funcionarios").select("id, admin_id").eq("role", "subadmin");
      if (error) throw error;
      (data || []).forEach((f) => destinatarios.push({ id: f.id, admin_id: f.admin_id }));
    }
    if (grupos.includes("funcionarios")) {
      const { data, error } = await supabase.from("funcionarios").select("id, admin_id").in("role", ["funcionario", "encarregado"]);
      if (error) throw error;
      (data || []).forEach((f) => destinatarios.push({ id: f.id, admin_id: f.admin_id }));
    }
    if (grupos.includes("clientes")) {
      const { data, error } = await supabase.from("clientes").select("id, admin_id");
      if (error) throw error;
      (data || []).forEach((c) => destinatarios.push({ id: c.id, admin_id: c.admin_id }));
    }

    if (!destinatarios.length) return json({ ok: true, enviados: 0, motivo: "Nenhum destinatário encontrado para os grupos selecionados." });

    // Regista a notificação in-app para todos de uma vez (mais eficiente que um
    // insert por pessoa).
    const agora = new Date().toISOString();
    const linhas = destinatarios.map((d) => ({
      id: crypto.randomUUID(),
      admin_id: d.admin_id,
      destinatario_id: d.id,
      titulo,
      mensagem,
      lida: false,
      data_criacao: agora,
    }));
    // Insere em blocos de 500, para nunca ultrapassar limites do pedido.
    for (let i = 0; i < linhas.length; i += 500) {
      const { error: errNotif } = await supabase.from("notificacoes").insert(linhas.slice(i, i + 500));
      if (errNotif) console.error("Erro ao inserir bloco de notificações:", errNotif);
    }

    // Envia o push a cada um (best-effort — se uma pessoa não tiver dado
    // permissão de notificações, a função de push simplesmente ignora-a).
    let enviados = 0;
    for (const d of destinatarios) {
      try {
        await fetch(`${SUPABASE_URL}/functions/v1/enviar-push`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_KEY}` },
          body: JSON.stringify({ utilizador_id: d.id, titulo, corpo: mensagem }),
        });
        enviados++;
      } catch (e) {
        console.warn("push falhou para", d.id, e);
      }
    }

    return json({ ok: true, totalDestinatarios: destinatarios.length, pushTentados: enviados });
  } catch (e) {
    console.error("Erro em notificar-massa:", e);
    return json({ erro: "Não foi possível enviar as notificações." }, 500);
  }
});
