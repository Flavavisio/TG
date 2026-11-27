// Edge Function: enviar-push
//
// Função genérica: recebe um utilizador_id + título + corpo, e manda a
// notificação push a todos os telemóveis/browsers inscritos dessa pessoa.
// Usada para avisos imediatos (ex: férias aprovadas), ao contrário do
// enviar-lembrete-ponto, que corre uma vez por dia agendado.
//
// Usa os MESMOS secrets já configurados: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
// VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY — não precisas de configurar nada de novo.
//
// NOVO: aceita também um campo opcional "icone" (URL do logo da empresa, vindo do
// perfil do administrador) e reencaminha-o no payload do push. O sw.js usa esse
// campo como ícone da notificação, caindo no ícone do TotalGest se vier vazio.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import webpush from "https://esm.sh/web-push@3.6.7";

import { empresaDoPerfil, perfilAutenticado, tokenBearer } from "../_shared/acesso-servidor.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY")!;
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY")!;

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
webpush.setVapidDetails("mailto:geral@totalgest.pt", VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: cors });
}

function endpointPushValido(endpoint: string): boolean {
  try {
    const url = new URL(endpoint);
    const host = url.hostname.toLowerCase();
    return url.protocol === "https:" && !url.username && !url.password &&
      (!url.port || url.port === "443") && (
        host === "fcm.googleapis.com" || host.endsWith(".push.apple.com") ||
        host.endsWith(".notify.windows.com") || host.endsWith(".push.services.mozilla.com")
      );
  } catch {
    return false;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ erro: "Método não permitido." }, 405);

  try {
    const token = tokenBearer(req);
    if (!token) return json({ erro: "Autenticação necessária." }, 401);
    let empresa: string | null = null;
    if (token !== SERVICE_ROLE_KEY) {
      const perfil = await perfilAutenticado(admin, token);
      if (!perfil) return json({ erro: "Sessão inválida." }, 401);
      empresa = empresaDoPerfil(perfil);
      if (perfil.papel !== "superadmin" && (!empresa || perfil.papel === "cliente")) {
        return json({ erro: "Sem permissão para enviar notificações." }, 403);
      }
      if (perfil.papel === "superadmin") empresa = null;
    }

    const { utilizador_id, titulo, corpo, icone } = await req.json().catch(() => ({}));
    if (typeof utilizador_id !== "string" || !utilizador_id || utilizador_id.length > 128 ||
        typeof titulo !== "string" || !titulo.trim() || titulo.length > 160 ||
        (corpo != null && (typeof corpo !== "string" || corpo.length > 1500)) ||
        (icone != null && (typeof icone !== "string" || icone.length > 2048))) {
      return json({ erro: "Dados da notificação inválidos." }, 400);
    }
    let inscricoes = admin.from("push_subscriptions").select("id,endpoint,p256dh,auth").eq("utilizador_id", utilizador_id);
    if (empresa) inscricoes = inscricoes.eq("admin_id", empresa);
    const { data: subs, error: erroInscricoes } = await inscricoes;
    if (erroInscricoes) throw erroInscricoes;
    if (!subs || !subs.length) {
      return new Response(JSON.stringify({ ok: true, enviados: 0, motivo: "sem inscrição push" }), { status: 200, headers: cors });
    }

    let enviados = 0, falhas = 0;
    for (const sub of subs) {
      if (!endpointPushValido(sub.endpoint)) { falhas++; continue; }
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify({ titulo, corpo: corpo || "", icone: icone || "" })
        );
        enviados++;
      } catch (e: any) {
        falhas++;
        if (e?.statusCode === 404 || e?.statusCode === 410) {
          await admin.from("push_subscriptions").delete().eq("id", sub.id);
        } else {
          console.error("erro a enviar push:", e);
        }
      }
    }

    return new Response(JSON.stringify({ ok: true, enviados, falhas }), { status: 200, headers: cors });
  } catch (e) {
    console.error(e);
    return json({ erro: "Não foi possível enviar a notificação." }, 500);
  }
});
