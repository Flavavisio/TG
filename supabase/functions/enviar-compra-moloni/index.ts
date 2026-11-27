// ============================================================================
//  Edge Function: enviar-compra-moloni
//  Regista uma encomenda recebida como documento de compra na Moloni, com o
//  fornecedor e os artigos/quantidades/preços da encomenda.
//
//  Deploy (painel Supabase):
//   Edge Functions > enviar-compra-moloni > Editar > colar este código > Deploy.
//
//  Secrets necessários: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//  Usa as MESMAS credenciais já configuradas em "Financeiro → Faturação (Moloni)".
//
//  CORREÇÃO (vs. versão anterior): as linhas do documento de compra iam só como
//  texto livre (name/qty/price), SEM product_id — a Moloni não tinha forma de
//  saber a que artigo aquilo correspondia, por isso o stock por artigo na
//  Moloni nunca era reposto pelas compras (só era descontado pelas vendas, do
//  lado da função faturar-moloni, essa sim já ligada por referência). Agora,
//  tal como a faturar-moloni já fazia, cada item com referência é primeiro
//  procurado na Moloni (products/getBySearch); se não existir lá, é criado na
//  hora; e a linha do documento de compra vai sempre com o product_id certo,
//  para a Moloni repor o stock do artigo correto.
//
//  Body esperado: { admin_id, fornecedor: {...}, data, itens: [{ referencia,
//  nome, qty, preco }] } — "referencia" é o novo campo, sem ele o item ainda
//  entra no documento (para não bloquear a compra), mas fica sem product_id,
//  logo sem repor stock de artigo nenhum na Moloni (a app já avisa disto).
//
//  IMPORTANTE: tal como nas outras funções da Moloni, os nomes exatos dos
//  campos de documentos de compra podem variar consoante a versão da API —
//  confirma em https://api.moloni.pt/v1/ se algo devolver "invalid parameter".
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

async function moloniEncontrarFornecedor(accessToken, companyId, nif) {
  if (!nif) return null;
  const resultado = await moloniPost("suppliers/getBySearch", accessToken, { company_id: companyId, search: nif });
  if (Array.isArray(resultado) && resultado.length) {
    const match = resultado.find((s) => String(s.vat) === String(nif)) || resultado[0];
    return match.supplier_id;
  }
  return null;
}

async function moloniCriarFornecedor(accessToken, companyId, fornecedor) {
  const body = {
    company_id: companyId,
    vat: fornecedor.nif || "999999990",
    name: fornecedor.nome || "Fornecedor",
    address: fornecedor.morada || "Desconhecida",
    city: fornecedor.cidade || "",
    zip_code: fornecedor.codigoPostal || "",
    country_id: 1,
    language_id: 1,
    email: fornecedor.email || "",
  };
  const resultado = await moloniPost("suppliers/insert", accessToken, body);
  if (!resultado || !resultado.supplier_id) {
    throw new Error("Não foi possível criar o fornecedor na Moloni: " + JSON.stringify(resultado));
  }
  return resultado.supplier_id;
}

// Procura um produto na Moloni pela referência; devolve o product_id, ou null se não encontrar.
async function moloniEncontrarProduto(accessToken, companyId, referencia) {
  if (!referencia) return null;
  const resultado = await moloniPost("products/getBySearch", accessToken, { company_id: companyId, search: referencia });
  if (Array.isArray(resultado) && resultado.length) {
    const match = resultado.find((p) => String(p.reference) === String(referencia)) || resultado[0];
    return match.product_id;
  }
  return null;
}

// A Moloni exige sempre uma categoria e uma unidade válidas para criar um produto — vai
// buscar a primeira disponível na conta (ou cria uma categoria "Geral" se não houver nenhuma).
async function moloniObterCategoriaEUnidadePadrao(accessToken, companyId) {
  let categorias = await moloniPost("productCategories/getAll", accessToken, { company_id: Number(companyId) });
  let categoriaId = Array.isArray(categorias) && categorias.length ? categorias[0].category_id : null;
  if (!categoriaId) {
    const nova = await moloniPost("productCategories/insert", accessToken, { company_id: Number(companyId), name: "Geral" });
    categoriaId = nova?.category_id || null;
  }
  const unidades = await moloniPost("measurementUnits/getAll", accessToken, { company_id: Number(companyId) });
  const unidadeId = Array.isArray(unidades) && unidades.length ? (unidades.find((u) => u.is_default === 1)?.unit_id || unidades[0].unit_id) : null;
  return { categoriaId, unidadeId };
}

// Vai buscar um imposto/taxa válido à conta da Moloni — sem isto, a Moloni exige um
// "exemption_reason" válido para cada linha sem imposto.
async function moloniObterImposto(accessToken, companyId, taxIdConfigurado) {
  const impostos = await moloniPost("taxes/getAll", accessToken, { company_id: Number(companyId) });
  if (!Array.isArray(impostos) || !impostos.length) return null;
  let imposto = null;
  if (taxIdConfigurado) imposto = impostos.find((t) => String(t.tax_id) === String(taxIdConfigurado));
  if (!imposto) imposto = impostos.find((t) => t.active_by_default === 1 || t.active_by_default === true) || impostos[0];
  return imposto;
}

// Cria um produto novo na Moloni (quando ainda não existe lá, mas já existe no TotalGest) —
// fica com stock 0 na Moloni ANTES desta compra entrar (o insert do documento de compra é
// que soma a quantidade comprada a seguir).
async function moloniCriarProduto(accessToken, companyId, item, categoriaId, unidadeId, imposto) {
  const body = {
    company_id: companyId,
    category_id: categoriaId,
    name: item.nome || "Artigo",
    reference: item.referencia,
    price: item.preco || 0,
    unit_id: unidadeId,
    has_stock: 1,
    stock: 0,
    type: 1, // produto (não serviço)
  };
  if (imposto) body.taxes = [{ tax_id: imposto.tax_id, order: 0, cumulative: 0 }];
  const resultado = await moloniPost("products/insert", accessToken, body);
  if (!resultado || !resultado.product_id) {
    throw new Error("Não foi possível criar o artigo \"" + item.nome + "\" na Moloni: " + JSON.stringify(resultado));
  }
  return resultado.product_id;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!SUPABASE_URL || !SERVICE_KEY) return json({ erro: "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY não configurados." }, 500);
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    const body = await req.json().catch(() => ({}));
    const { admin_id, fornecedor, data: dataCompra, itens } = body;
    if (!admin_id || !fornecedor || !Array.isArray(itens) || !itens.length) {
      return json({ erro: "Faltam dados (admin_id, fornecedor, itens)." }, 400);
    }

    const acesso = await autorizarMoloni(req, supabase, SERVICE_KEY, admin_id);
    if (acesso !== 200) return json({ erro: "Sem acesso à integração Moloni." }, acesso);

    const { data: adminRow, error: errAdmin } = await supabase
      .from("administradores")
      .select("integracao_faturacao")
      .eq("id", admin_id)
      .maybeSingle();
    if (errAdmin) throw errAdmin;
    const cfg = adminRow?.integracao_faturacao;
    if (!cfg || cfg.provider !== "moloni" || !cfg.moloni?.companyId) {
      return json({ erro: "Esta empresa ainda não tem a Moloni configurada." }, 400);
    }
    const mol = await obterMoloni(supabase, admin_id, cfg.moloni);
    const companyId = mol.companyId;
    const simulacao = cfg.simulacao !== false;

    if (simulacao) {
      const accessToken = await moloniAutenticar(mol);
      await moloniEncontrarFornecedor(accessToken, companyId, fornecedor.nif);
      let semReferencia = 0;
      itens.forEach((it) => { if (!it.referencia) semReferencia++; });
      return json({
        ok: true,
        simulacao: true,
        mensagem: "Ligação com a Moloni validada (modo simulação — nenhum documento de compra foi criado)."
          + (semReferencia ? ` ⚠️ ${semReferencia} item(ns) sem referência — entrariam sem ligação a nenhum artigo na Moloni, sem repor stock.` : ""),
      });
    }

    const accessToken = await moloniAutenticar(mol);
    let supplierId = await moloniEncontrarFornecedor(accessToken, companyId, fornecedor.nif);
    if (!supplierId) supplierId = await moloniCriarFornecedor(accessToken, companyId, fornecedor);

    // Liga cada item ao produto certo na Moloni pela referência — cria o produto lá se ainda
    // não existir. Sem referência, o item ainda entra no documento (não bloqueia a compra),
    // mas fica sem product_id, avisado no resultado devolvido à app.
    const imposto = await moloniObterImposto(accessToken, companyId, mol.taxId);
    let categoriaId = null, unidadeId = null;
    const semReferencia = [];
    const linhas = [];
    for (const it of itens) {
      if (!it.referencia) {
        semReferencia.push(it.nome || "Artigo");
        linhas.push({ name: it.nome || "Artigo", qty: it.qty || 1, price: it.preco || 0, ...(imposto ? { taxes: [{ tax_id: imposto.tax_id, order: 0, cumulative: 0 }] } : { exemption_reason: "M99" }) });
        continue;
      }
      let productId = await moloniEncontrarProduto(accessToken, companyId, it.referencia);
      if (!productId) {
        if (categoriaId == null) ({ categoriaId, unidadeId } = await moloniObterCategoriaEUnidadePadrao(accessToken, companyId));
        productId = await moloniCriarProduto(accessToken, companyId, it, categoriaId, unidadeId, imposto);
      }
      linhas.push({ product_id: productId, qty: it.qty || 1, price: it.preco || 0, ...(imposto ? { taxes: [{ tax_id: imposto.tax_id, order: 0, cumulative: 0 }] } : { exemption_reason: "M99" }) });
    }

    const hoje = dataCompra || new Date().toISOString().slice(0, 10);
    const documentoBody = {
      company_id: companyId,
      supplier_id: supplierId,
      date: hoje,
      products: linhas,
    };
    const resultado = await moloniPost("purchaseInvoices/insert", accessToken, documentoBody);
    if (!resultado || !resultado.document_id) {
      throw new Error("A Moloni não devolveu um documento de compra válido: " + JSON.stringify(resultado));
    }

    return json({
      ok: true,
      simulacao: false,
      documentId: resultado.document_id,
      itensSemReferencia: semReferencia, // para a app poder avisar quais ficaram sem ligação a stock
    });
  } catch (e) {
    console.error("Erro em enviar-compra-moloni:", e);
    return json({ erro: String(e && e.message ? e.message : e) }, 500);
  }
});