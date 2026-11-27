// ============================================================================
//  Edge Function: sincronizar-moloni
//  Corre uma vez por dia (cron) e, para cada empresa com o add-on "Integração
//  com ERP's" ativo e a Moloni configurada, sincroniza:
//   - Preço de venda de cada artigo (atualizado diretamente)
//   - Stock atual de cada artigo (por AJUSTE — nunca reescreve o histórico de
//     movimentos, só regista a diferença como um novo movimento de ajuste,
//     ficando sempre auditável e reversível)
//
//  Direção única: Moloni → TotalGest. Nunca envia dados do TotalGest para a
//  Moloni aqui (isso é feito à parte, ao faturar). Isto evita sobrescrever
//  ajustes que tenhas feito manualmente no TotalGest sem quereres.
//
//  Corresponde apenas artigos cuja "Referência" no TotalGest seja igual à
//  referência do produto na Moloni — artigos sem referência preenchida, ou
//  sem correspondência na Moloni, não são tocados.
//
//  Deploy (painel Supabase):
//   Edge Functions > sincronizar-moloni > Editar > colar este código > Deploy.
//
//  Secrets necessários: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// ============================================================================
import { autorizarMoloni, obterMoloni } from "../_shared/moloni-acesso.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

const MOLONI_BASE = "https://api.moloni.pt/v1";

async function moloniAutenticar(mol) {
  const params = new URLSearchParams({
    grant_type: "password",
    client_id: mol.clientId,
    client_secret: mol.clientSecret,
    username: mol.username,
    password: mol.password,
  });
  const res = await fetch(`${MOLONI_BASE}/grant/?${params.toString()}`, { method: "GET" });
  const data = await res.json();
  if (!data || !data.access_token) throw new Error("Falha na autenticação com a Moloni: " + JSON.stringify(data));
  return data.access_token;
}

function _moloniFormEncode(obj, prefixo = "") {
  let partes = [];
  for (const chave in obj) {
    const valor = obj[chave];
    if (valor === null || valor === undefined) continue;
    const nomeCompleto = prefixo ? `${prefixo}[${chave}]` : chave;
    if (typeof valor === "object") {
      partes = partes.concat(_moloniFormEncode(valor, nomeCompleto));
    } else {
      partes.push(`${encodeURIComponent(nomeCompleto)}=${encodeURIComponent(valor)}`);
    }
  }
  return partes;
}
async function moloniPost(caminho, accessToken, body) {
  const corpo = _moloniFormEncode(body).join("&");
  const res = await fetch(`${MOLONI_BASE}/${caminho}/?access_token=${encodeURIComponent(accessToken)}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: corpo,
  });
  return await res.json();
}

async function moloniListarProdutos(accessToken, companyId) {
  const todos = [];
  let pagina = 1;
  while (pagina <= 200) {
    const resultado = await moloniPost("products/getAll", accessToken, { company_id: companyId, category_id: 0, qty: 50, offset: (pagina - 1) * 50 });
    if (!Array.isArray(resultado) || !resultado.length) break;
    todos.push(...resultado);
    if (resultado.length < 50) break;
    pagina++;
  }
  return todos;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!SUPABASE_URL || !SERVICE_KEY) return json({ erro: "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY não configurados." }, 500);
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    const acesso = await autorizarMoloni(req, supabase, SERVICE_KEY, null, true);
    if (acesso !== 200) return json({ erro: "Sem acesso à integração Moloni." }, acesso);

    const { data: admins, error: errAdmins } = await supabase
      .from("administradores")
      .select("id, erp_plano, erp_expiracao, integracao_faturacao")
      .not("integracao_faturacao", "is", null);
    if (errAdmins) throw errAdmins;

    const agora = Date.now();
    const empresasComErpAtivo = (admins || []).filter(
      (a) => a.erp_plano && a.erp_expiracao && new Date(a.erp_expiracao).getTime() > agora && a.integracao_faturacao?.provider === "moloni" && a.integracao_faturacao?.moloni?.companyId
    );

    let resumo = [];

    for (const admin of empresasComErpAtivo) {
      try {
        const mol = await obterMoloni(supabase, admin.id, admin.integracao_faturacao.moloni);
        const accessToken = await moloniAutenticar(mol);
        const produtos = await moloniListarProdutos(accessToken, mol.companyId);
        const porReferencia = new Map(produtos.filter((p) => p.reference).map((p) => [String(p.reference), p]));

        const { data: artigosLocais, error: errArt } = await supabase
          .from("artigos")
          .select("id, referencia, preco_venda, stock_inicial")
          .eq("admin_id", admin.id)
          .not("referencia", "is", null);
        if (errArt) throw errArt;

        const { data: movimentos, error: errMov } = await supabase
          .from("movimentos_stock")
          .select("artigo_id, tipo, quantidade")
          .eq("admin_id", admin.id);
        if (errMov) throw errMov;

        let precosAtualizados = 0, ajustesStock = 0;

        for (const artigo of artigosLocais || []) {
          const produtoMoloni = porReferencia.get(String(artigo.referencia));
          if (!produtoMoloni) continue;

          // Preço de venda: atualiza diretamente (a Moloni é a fonte da verdade para isto).
          const precoMoloni = produtoMoloni.price != null ? Number(produtoMoloni.price) : null;
          if (precoMoloni != null && precoMoloni !== Number(artigo.preco_venda)) {
            await supabase.from("artigos").update({ preco_venda: precoMoloni }).eq("id", artigo.id);
            precosAtualizados++;
          }

          // Stock: calcula o stock atual local (inicial + movimentos) e, se for
          // diferente do da Moloni, regista um movimento de AJUSTE com a diferença
          // — nunca reescreve o stock inicial nem apaga histórico.
          const stockMoloni = produtoMoloni.stock != null ? Number(produtoMoloni.stock) : null;
          if (stockMoloni != null) {
            let stockLocal = Number(artigo.stock_inicial) || 0;
            (movimentos || []).forEach((m) => {
              if (m.artigo_id !== artigo.id) return;
              const q = Number(m.quantidade) || 0;
              if (m.tipo === "entrada" || m.tipo === "devolucao") stockLocal += q;
              else if (m.tipo === "saida") stockLocal -= q;
              else if (m.tipo === "ajuste") stockLocal += q;
            });
            const diferenca = Math.round((stockMoloni - stockLocal) * 1000) / 1000;
            if (Math.abs(diferenca) >= 0.001) {
              await supabase.from("movimentos_stock").insert({
                id: crypto.randomUUID(),
                admin_id: admin.id,
                artigo_id: artigo.id,
                tipo: "ajuste",
                quantidade: diferenca,
                origem_tipo: "sync_moloni",
                nota: "Sincronização automática com a Moloni — ajuste para bater certo com o stock lá reportado.",
                data: new Date().toISOString().slice(0, 10),
                data_criacao: new Date().toISOString(),
              });
              ajustesStock++;
            }
          }
        }
        resumo.push({ admin_id: admin.id, precosAtualizados, ajustesStock, totalArtigosMoloni: produtos.length });
      } catch (e) {
        console.error(`Erro ao sincronizar admin ${admin.id}:`, e);
        resumo.push({ admin_id: admin.id, erro: String(e && e.message ? e.message : e) });
      }
    }

    return json({ ok: true, empresasProcessadas: empresasComErpAtivo.length, resumo });
  } catch (e) {
    console.error("Erro em sincronizar-moloni:", e);
    return json({ erro: String(e && e.message ? e.message : e) }, 500);
  }
});