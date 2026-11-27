import { createClient } from "npm:@supabase/supabase-js@2";
import { autorizarMoloni } from "../_shared/moloni-acesso.ts";

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  const json = (body, status) => Response.json(body, { status, headers });
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (req.method !== "POST") return json({ erro: "Método não permitido." }, 405);
  try {
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const url = Deno.env.get("SUPABASE_URL");
    if (!url || !key) return json({ erro: "Integração indisponível." }, 503);
    const service = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const body = await req.json().catch(() => null);
    const id = body?.admin_id;
    if (typeof id !== "string" || !id || id.length > 128) return json({ erro: "Empresa inválida." }, 400);
    const acesso = await autorizarMoloni(req, service, key, id);
    if (acesso !== 200) return json({ erro: "Sem acesso a esta empresa." }, acesso);

    const { companyId, documentSetId, simulacao } = body;
    if (typeof companyId !== "string" || !/^\d{1,16}$/.test(companyId) ||
        (documentSetId != null && (typeof documentSetId !== "string" || !/^\d{1,16}$/.test(documentSetId)))) {
      return json({ erro: "Verifique o ID da empresa e da série Moloni." }, 400);
    }
    let credenciais = null;
    if (body.credenciais != null) {
      const { clientId, clientSecret, username, password } = body.credenciais;
      if (![clientId, clientSecret, username, password].every(v => typeof v === "string" && v.trim() && v.length <= 512)) {
        return json({ erro: "Preencha todos os campos de acesso à Moloni." }, 400);
      }
      credenciais = { clientId, clientSecret, username, password };
    }
    const { data, error } = await service.rpc("tg_moloni_guardar", {
      admin: id, credenciais, configuracao: { companyId, documentSetId, simulacao: simulacao !== false },
    });
    if (error?.code === "22023") return json({ erro: "Introduza as credenciais da Moloni." }, 400);
    if (error) throw error;
    return json({ configuracao: data }, 200);
  } catch {
    return json({ erro: "Não foi possível guardar a integração Moloni." }, 500);
  }
});
