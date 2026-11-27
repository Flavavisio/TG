// ============================================================================
//  Edge Function: quick-service  (nome interno/histórico: criar-utilizador)
//  Cria OU apaga uma conta Supabase Auth + perfil de um utilizador.
//  Pode ser chamada por: superadmin, admin, ou um funcionário com
//  role="subadmin" (tratado com as mesmas permissões do admin).
//  Também pode ser chamada por um admin marcado como distribuidor (coluna
//  eh_distribuidor na tabela administradores), mas SÓ para criar outro
//  admin independente (o cliente dele) — nunca para o resto.
//
//  IMPORTANTE: o nome que importa é o SLUG do deploy (visível no URL:
//  .../functions/v1/quick-service). A app (TOTALGEST_SUPABASE.html) chama
//  esta função como 'quick-service'. Este comentário/título é só descritivo.
//
//  Deploy (painel Supabase):
//   Edge Functions > quick-service > Code > colar isto > Deploy.
//   (Manter "Verify JWT" LIGADO.)
//
//  Body esperado:
//   - Para CRIAR (comportamento original, "acao" pode ser omitido):
//     { email, password, papel, adminId, registoId }
//   - Para APAGAR:
//     { acao: "apagar", email }
//
//  CORREÇÃO NESTA VERSÃO (addon Rondas / Vigilância):
//  A lista de papéis que um admin/subadmin pode criar estava presa a
//  "funcionario"/"encarregado"/"cliente"/"subadmin" — os dois papéis novos
//  do addon de Rondas ("vigilante" e "supervisor_vigilantes") caíam sempre
//  no 403 "Só pode criar funcionarios/encarregados/clientes/subadmins",
//  mesmo com a app já a permitir escolhê-los. O registo em "funcionarios"
//  ficava criado, mas sem conta de autenticação nem perfil correspondente.
// ============================================================================
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status, headers: { ...cors, "Content-Type": "application/json" },
  });
}

// Papéis que um admin/subadmin (não-distribuidor) pode criar dentro da própria
// empresa. Acrescentar aqui é o único sítio a mudar para dar suporte a mais um
// papel novo no futuro.
const PAPEIS_CRIAVEIS_POR_ADMIN = ["funcionario", "encarregado", "cliente", "subadmin", "vigilante", "supervisor_vigilantes"];

// Procura um utilizador em auth.users pelo email (a Admin API não tem um
// "getUserByEmail" direto, por isso paginamos listUsers à procura dele).
async function encontrarAuthUserPorEmail(service, email: string) {
  let page = 1;
  const perPage = 200;
  while (true) {
    const { data, error } = await service.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    if (!data?.users?.length) return null;
    const encontrado = data.users.find((u) => (u.email || "").toLowerCase() === email);
    if (encontrado) return encontrado;
    if (data.users.length < perPage) return null; // última página, não encontrou
    page++;
  }
}

// Confirma se um admin está marcado como distribuidor na tabela administradores.
// Usado só para decidir se pode criar OUTRO admin (o cliente dele) — nada mais.
async function callerEhDistribuidorAtivo(service, registoId: string) {
  const { data } = await service.from("administradores").select("eh_distribuidor").eq("id", registoId).maybeSingle();
  return data?.eh_distribuidor === true;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const URL = Deno.env.get("SUPABASE_URL")!;
    const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
    const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // 1) Identificar quem chama (pelo JWT enviado pela app)
    const authHeader = req.headers.get("Authorization") || "";
    const asCaller = createClient(URL, ANON, { global: { headers: { Authorization: authHeader } } });
    const { data: u, error: uErr } = await asCaller.auth.getUser();
    if (uErr || !u?.user) return json({ erro: "Nao autenticado" }, 401);

    const service = createClient(URL, SERVICE);
    const { data: callerPerfil } = await service.from("perfis").select("*").eq("id", u.user.id).single();
    if (!callerPerfil) return json({ erro: "Sem perfil de chamador" }, 403);
    const callerPapel = callerPerfil.papel;

    // Um funcionário com role="subadmin" tem as MESMAS permissões que um admin
    // (só a app é que restringe o que ele vê/faz dentro da própria empresa).
    const callerEhAdminOuSubadmin = callerPapel === "admin" || callerPapel === "subadmin";

    // Qual é a "empresa" de quem chama?
    //  - admin:    a empresa é o próprio registo dele (registo_id)
    //  - subadmin: a empresa é o admin a que ele pertence (admin_id do perfil)
    const empresaDoCaller = callerPapel === "admin" ? callerPerfil.registo_id : callerPerfil.admin_id;

    const body = await req.json().catch(() => ({}));

    // ---------------------------------------------------------------
    // APAGAR conta (login + perfil) de alguém — usado quando se
    // elimina um funcionário/encarregado/cliente/admin na app, para
    // não deixar contas "fantasma" para trás.
    // ---------------------------------------------------------------
    if (body.acao === "apagar") {
      const email = String(body.email || "").toLowerCase().trim();
      if (!email) return json({ erro: "Falta o email" }, 400);

      if (callerPapel !== "superadmin" && !callerEhAdminOuSubadmin) return json({ erro: "Sem permissão" }, 403);
      const conta = await encontrarAuthUserPorEmail(service, email);
      if (!conta) return json({ ok: true });
      const { data: alvoPerfil, error: errPerfil } = await service.from("perfis")
        .select("id, admin_id, papel").eq("id", conta.id).maybeSingle();
      if (errPerfil) throw errPerfil;
      if (callerPapel !== "superadmin" && (!alvoPerfil || !empresaDoCaller ||
          alvoPerfil.admin_id !== empresaDoCaller || ["admin", "superadmin"].includes(alvoPerfil.papel))) {
        return json({ erro: "Conta fora das suas permissões" }, 403);
      }
      const { error: delErr } = await service.auth.admin.deleteUser(conta.id);
      if (delErr) throw delErr;
      const { error: limpeza } = await service.from("perfis").delete().eq("id", conta.id);
      if (limpeza) throw limpeza;

      return json({ ok: true });
    }

    // ---------------------------------------------------------------
    // CRIAR conta (comportamento original)
    // ---------------------------------------------------------------
    const { password, papel, adminId, registoId } = body;
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    if (!email || !password || !papel || !registoId) return json({ erro: "Faltam dados" }, 400);

    if (callerPapel === "superadmin") {
      // pode criar qualquer utilizador
    } else if (callerEhAdminOuSubadmin) {
      // Caso especial: um distribuidor pode criar outro "admin" — o cliente dele.
      // Nesse caso o novo admin é uma empresa independente, por isso o admin_id
      // dele tem de ser o PRÓPRIO id (self-reference), nunca a empresa do
      // distribuidor — é assim que o resto da app já trata qualquer admin normal.
      if (papel === "admin") {
        if (callerPapel !== "admin") {
          return json({ erro: "So um admin distribuidor pode criar outro admin" }, 403);
        }
        const ehDistribuidor = await callerEhDistribuidorAtivo(service, empresaDoCaller);
        if (!ehDistribuidor) {
          return json({ erro: "So pode criar funcionarios/encarregados/clientes/subadmins" }, 403);
        }
        if (adminId !== registoId || registoId === empresaDoCaller) {
          return json({ erro: "Empresa de destino inválida" }, 400);
        }
        const { data: empresa, error } = await service.from("administradores").select("id, email")
          .eq("id", registoId).eq("distribuidor_id", empresaDoCaller).maybeSingle();
        if (error) throw error;
        if (!empresa || String(empresa.email || "").toLowerCase() !== email) {
          return json({ erro: "Empresa fora das suas permissões" }, 403);
        }
      } else {
        if (!PAPEIS_CRIAVEIS_POR_ADMIN.includes(papel)) {
          return json({ erro: "So pode criar funcionarios/encarregados/clientes/subadmins/vigilantes/supervisores de vigilantes" }, 403);
        }
        if (adminId !== empresaDoCaller) return json({ erro: "Fora da sua empresa" }, 403);
      }
    } else {
      return json({ erro: "Sem permissao" }, 403);
    }

    let userId;
    const { data: created, error: cErr } = await service.auth.admin.createUser({
      email: String(email).toLowerCase(), password: String(password), email_confirm: true,
    });

    if (cErr) {
      const m = (cErr.message || "").toLowerCase();
      if (!(m.includes("already") || m.includes("registered"))) {
        return json({ erro: cErr.message }, 400);
      }
      const existente = await encontrarAuthUserPorEmail(service, email);
      if (!existente) return json({ erro: "Esse email já tem conta" }, 409);
      const { data: perfilExistente, error } = await service.from("perfis")
        .select("papel, admin_id, registo_id").eq("id", existente.id).maybeSingle();
      if (error) throw error;
      const titular = (papel === "superadmin") ? null : adminId;
      if (!perfilExistente || perfilExistente.registo_id !== registoId ||
          perfilExistente.papel !== papel ||
          (perfilExistente.admin_id !== titular && !(papel === "admin" && perfilExistente.admin_id == null && titular === registoId))) {
        return json({ erro: "Esse email já pertence a outra conta" }, 409);
      }
      userId = existente.id;
      const { error: updErr } = await service.auth.admin.updateUserById(userId, { password: String(password) });
      if (updErr) return json({ erro: "Conta já existia e não foi possível atualizar a password: " + updErr.message }, 500);
    } else {
      userId = created.user.id;
    }

    const { error: pErr } = await service.from("perfis").upsert({
      id: userId,
      email: String(email).toLowerCase(),
      papel,
      admin_id: papel === "superadmin" ? null : adminId,
      registo_id: registoId,
    });
    if (pErr) return json({ erro: "perfil: " + pErr.message }, 500);

    return json({ ok: true, userId });
  } catch (e) {
    console.error("Erro ao gerir conta Auth:", e);
    return json({ erro: "Não foi possível gerir a conta de acesso." }, 500);
  }
});