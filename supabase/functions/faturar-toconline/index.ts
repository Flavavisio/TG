// ============================================================================
//  Edge Function: faturar-toconline
//  Trata da integração com a TOConline: troca do código OAuth2 pelo token de
//  acesso, e emissão de faturas a partir de uma OS concluída.
//
//  Espelha o padrão já usado em "faturar-moloni" — chamada sempre com
//  { admin_id, acao, ...resto }.
//
//  Deploy (painel Supabase):
//   Edge Functions > faturar-toconline > Code > colar isto > Deploy.
//   (Manter "Verify JWT" LIGADO — só utilizadores autenticados podem chamar.)
//
//  ⚠️ IMPORTANTE — confirma antes de usar a sério:
//  Os URLs da API da TOConline abaixo (TOCONLINE_OAUTH_URL, TOCONLINE_API_URL)
//  e os nomes exatos dos campos dos documentos de venda seguem a documentação
//  pública da TOConline, mas nunca foram testados contra a API real (não
//  tenho acesso para testar). Se a emissão de faturas falhar, o mais provável
//  é precisares de ajustar os nomes de campos abaixo, comparando com a
//  documentação em https://api-docs.toconline.pt — a estrutura geral
//  (autenticação, cliente, documento, PDF) deve estar certa.
// ============================================================================
import { createClient } from "npm:@supabase/supabase-js@2";
import { empresaDoPerfil, perfilAutenticado, tokenBearer } from "../_shared/acesso-servidor.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

const TOCONLINE_OAUTH_URL = "https://app.toconline.pt/oauth";
const TOCONLINE_API_URL = "https://api.toconline.pt/api";

async function obterAdmin(service, adminId: string) {
  const { data, error } = await service.from("administradores").select("id, integracao_faturacao").eq("id", adminId).eq("ativo", true).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Admin não encontrado");
  return data;
}

async function gravarConfigToconline(service, adminId: string, cfgAtual: any, novosToconline: any) {
  const novaConfig = { ...(cfgAtual || {}), provider: "toconline", toconline: { ...(cfgAtual?.toconline || {}), ...novosToconline } };
  const { error } = await service.from("administradores").update({ integracao_faturacao: novaConfig }).eq("id", adminId);
  if (error) throw error;
  return novaConfig;
}

// Troca o refresh_token por um access_token novo, sempre que o atual estiver
// perto de expirar (ou já tiver expirado) — evita ter de pedir ao utilizador
// para se voltar a ligar manualmente de cada vez que o token caduca.
async function garantirTokenValido(service, adminId: string, cfg: any) {
  const toc = cfg.toconline || {};
  const expiraEm = toc.tokenExpiraEm ? new Date(toc.tokenExpiraEm).getTime() : 0;
  const margemSeguranca = 2 * 60 * 1000; // renova com 2 min de antecedência
  if (toc.accessToken && expiraEm > Date.now() + margemSeguranca) {
    return toc; // ainda válido
  }
  if (!toc.refreshToken) throw new Error("Sem refresh_token — é preciso voltar a ligar a conta à TOConline (Financeiro → Integração do Software de Faturação → Editar → Ligar ao TOConline).");

  const resp = await fetch(`${TOCONLINE_OAUTH_URL}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: toc.refreshToken,
      client_id: toc.clientId,
      client_secret: toc.clientSecret,
    }),
  });
  const dados = await resp.json().catch(() => ({}));
  if (!resp.ok || !dados.access_token) {
    throw new Error("Não foi possível renovar o token da TOConline: " + (dados.error_description || dados.error || resp.status));
  }
  const novosToconline = {
    accessToken: dados.access_token,
    refreshToken: dados.refresh_token || toc.refreshToken,
    tokenExpiraEm: new Date(Date.now() + (dados.expires_in || 3600) * 1000).toISOString(),
  };
  await gravarConfigToconline(service, adminId, cfg, novosToconline);
  return { ...toc, ...novosToconline };
}

// Procura o cliente pelo NIF na TOConline; cria se não encontrar. Devolve o
// customer_id da TOConline, para ficar guardado no cliente do Total Gest e
// não duplicar da próxima vez.
async function obterOuCriarCliente(accessToken: string, cliente: any) {
  if (cliente.toconlineCustomerId) return cliente.toconlineCustomerId;

  if (cliente.nif) {
    const respBusca = await fetch(`${TOCONLINE_API_URL}/customers?filter[tax_registration_number]=${encodeURIComponent(cliente.nif)}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const dadosBusca = await respBusca.json().catch(() => ({}));
    const existente = Array.isArray(dadosBusca?.data) ? dadosBusca.data[0] : null;
    if (existente?.id) return existente.id;
  }

  const respCriar = await fetch(`${TOCONLINE_API_URL}/customers`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      data: {
        name: cliente.nome,
        tax_registration_number: cliente.nif || "999999990", // consumidor final, se não tiver NIF
        country: "PT",
        address_detail: cliente.morada || "",
        postal_code: cliente.codigoPostal || "",
        city: cliente.cidade || "",
        customer_type: "final_consumer",
        email: cliente.email || undefined,
      },
    }),
  });
  const dadosCriar = await respCriar.json().catch(() => ({}));
  if (!respCriar.ok || !dadosCriar?.data?.id) {
    throw new Error("Não foi possível criar o cliente na TOConline: " + JSON.stringify(dadosCriar));
  }
  return dadosCriar.data.id;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const token = tokenBearer(req);
    if (!token) return json({ erro: "Autenticação necessária." }, 401);
    const service = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
    const perfil = await perfilAutenticado(service, token);
    if (!perfil) return json({ erro: "Sessão inválida." }, 401);

    const body = await req.json().catch(() => ({}));
    const { admin_id, acao } = body;
    if (typeof admin_id !== "string" || !admin_id || admin_id.length > 128 ||
        !["oauth_callback", "emitir_fatura"].includes(acao)) return json({ erro: "Empresa ou ação inválida." }, 400);
    if (!["admin", "subadmin"].includes(perfil.papel) || empresaDoPerfil(perfil) !== admin_id) {
      return json({ erro: "Sem acesso à faturação desta empresa." }, 403);
    }

    const adminRow = await obterAdmin(service, admin_id);
    const cfg = adminRow.integracao_faturacao || {};

    // ------------------------------------------------------------------
    // OAUTH_CALLBACK — troca o "code" que a TOConline devolveu pelo par
    // access_token/refresh_token, e guarda-os na configuração do admin.
    // ------------------------------------------------------------------
    if (acao === "oauth_callback") {
      const { code, redirect_uri } = body;
      if (!code || !redirect_uri) return json({ erro: "Faltam dados (code, redirect_uri)" }, 400);
      const toc = cfg.toconline || {};
      if (!toc.clientId || !toc.clientSecret) return json({ erro: "Configura primeiro o Client ID e o Client Secret." }, 400);

      const resp = await fetch(`${TOCONLINE_OAUTH_URL}/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          redirect_uri,
          client_id: toc.clientId,
          client_secret: toc.clientSecret,
        }),
      });
      const dados = await resp.json().catch(() => ({}));
      if (!resp.ok || !dados.access_token) {
        return json({ erro: "TOConline recusou o código: " + (dados.error_description || dados.error || resp.status) }, 400);
      }
      await gravarConfigToconline(service, admin_id, cfg, {
        accessToken: dados.access_token,
        refreshToken: dados.refresh_token || null,
        tokenExpiraEm: new Date(Date.now() + (dados.expires_in || 3600) * 1000).toISOString(),
      });
      return json({ ok: true });
    }

    // ------------------------------------------------------------------
    // EMITIR_FATURA — cria/atualiza o cliente e emite o documento de venda.
    // ------------------------------------------------------------------
    if (acao === "emitir_fatura") {
      const { cliente, descricao, valor, valorMaoDeObra, materiais, data } = body;
      if (!cliente || valor == null) return json({ erro: "Faltam dados (cliente, valor)" }, 400);

      // Modo simulação — não chama a TOConline a sério, só confirma que os
      // dados chegaram bem formados, para testares sem risco.
      if (cfg.simulacao !== false) {
        return json({
          ok: true,
          mensagem: "✅ Simulação concluída — nada foi enviado à TOConline a sério.",
          documentId: null, pdfUrl: null, customerId: cliente.toconlineCustomerId || null,
        });
      }

      const toc = await garantirTokenValido(service, admin_id, cfg);
      const customerId = await obterOuCriarCliente(toc.accessToken, cliente);

      const linhas: any[] = [];
      (materiais || []).forEach((m: any) => {
        linhas.push({ description: m.nome, quantity: m.qty, unit_price: m.precoVenda, tax: { id: "NOR" } });
      });
      if (valorMaoDeObra > 0 || !linhas.length) {
        linhas.push({ description: descricao || "Mão de obra / Serviço prestado", quantity: 1, unit_price: valorMaoDeObra != null ? valorMaoDeObra : valor, tax: { id: "NOR" } });
      }

      const respDoc = await fetch(`${TOCONLINE_API_URL}/commercial_sales_documents`, {
        method: "POST",
        headers: { Authorization: `Bearer ${toc.accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          data: {
            document_type: { id: "FT" },
            customer_id: customerId,
            date: data || new Date().toISOString().slice(0, 10),
            lines: linhas,
          },
        }),
      });
      const dadosDoc = await respDoc.json().catch(() => ({}));
      if (!respDoc.ok || !dadosDoc?.data?.id) {
        return json({ erro: "TOConline recusou o documento: " + JSON.stringify(dadosDoc) }, 400);
      }
      const documentId = dadosDoc.data.id;

      // Comunica o documento à Autoridade Tributária — sem isto, a fatura fica
      // criada mas não comunicada, o que não é válido fiscalmente.
      await fetch(`${TOCONLINE_API_URL}/commercial_sales_documents/${documentId}/communicate`, {
        method: "POST",
        headers: { Authorization: `Bearer ${toc.accessToken}` },
      }).catch((e) => console.error("Falha ao comunicar documento à AT:", e));

      // Descarrega o link do PDF, se a API o devolver diretamente; senão, aponta
      // para o endpoint de PDF (a app pode usar isto para abrir/descarregar).
      const pdfUrl = dadosDoc?.data?.pdf_url || `${TOCONLINE_API_URL}/commercial_sales_documents/${documentId}/pdf`;

      return json({ ok: true, documentId, pdfUrl, customerId, mensagem: "✅ Fatura emitida e comunicada à Autoridade Tributária." });
    }

    return json({ erro: "Ação desconhecida: " + acao }, 400);
  } catch (e) {
    console.error("Erro em faturar-toconline:", e);
    return json({ erro: String(e) }, 500);
  }
});
