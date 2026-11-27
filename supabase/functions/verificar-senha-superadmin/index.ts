import { createClient } from "npm:@supabase/supabase-js@2";

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  const resposta = (ok: boolean, status = 200) => Response.json({ ok }, { status, headers });
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (req.method !== "POST") return resposta(false, 405);
  try {
    const token = /^Bearer\s+(\S+)$/i.exec(req.headers.get("authorization") || "")?.[1];
    if (!token) return resposta(false, 401);
    const url = Deno.env.get("SUPABASE_URL")!;
    const opcoes = { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } };
    const service = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, opcoes);
    const { data: { user }, error: authError } = await service.auth.getUser(token);
    if (authError || !user?.email) return resposta(false, 401);
    const { data: perfil, error: perfilError } = await service.from("perfis")
      .select("papel").eq("id", user.id).maybeSingle();
    if (perfilError) throw perfilError;
    if (perfil?.papel !== "superadmin") return resposta(false, 403);
    const { senha } = await req.json().catch(() => ({}));
    if (typeof senha !== "string" || !senha || senha.length > 256) return resposta(false, 400);
    const auth = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, opcoes);
    const { data, error } = await auth.auth.signInWithPassword({ email: user.email, password: senha });
    if (error || data.user?.id !== user.id) return resposta(false);
    // Revoga apenas a sessão temporária criada pela confirmação.
    await auth.auth.signOut({ scope: "local" });
    return resposta(true);
  } catch (error) {
    console.error("Falha ao verificar credencial do Super Admin:", error);
    return resposta(false, 500);
  }
});
