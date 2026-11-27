// ============================================================================
//  Edge Function: importar-moloni
//  Vai buscar a lista de clientes ou de artigos/stock à Moloni, para a app
//  TotalGest poder importá-los (sem duplicar o que já existir localmente).
//
//  Deploy (painel Supabase):
//   Edge Functions > importar-moloni > Editar > colar este código > Deploy.
//
//  Secrets necessários (os mesmos já usados pelas outras funções):
//    SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//
//  Usa as MESMAS credenciais da Moloni já configuradas em "Financeiro →
//  Faturação (Moloni)" (administradores.integracao_faturacao) — não precisa
//  de nenhuma configuração extra.
//
//  Corpo do pedido: { admin_id, tipo: 'clientes' | 'artigos' | 'fornecedores' }
//
//  IMPORTANTE: tal como na função faturar-moloni, os nomes exatos dos campos
//  podem variar ligeiramente consoante a versão da API da Moloni — confirma
//  em https://api.moloni.pt/v1/ se algo devolver "invalid parameter".
//
//  NOTA (preço de custo): o "products/getAll" da Moloni só devolve o preço
//  de VENDA (price) — não tem preço de custo. Para o custo é preciso um
//  pedido extra por artigo a "products/getByReference", que devolve
//  suppliers[].cost_price. Por isso, ao importar artigos, fazemos essa
//  segunda chamada para cada artigo com referência (em pequenos lotes, para
//  não estourar o tempo/limite de pedidos da Moloni) e preenchemos
//  "precoCusto" quando existir. Se essa chamada falhar para algum artigo
//  (referência sem fornecedor associado, erro de rede, etc.), simplesmente
//  fica sem preço de custo — nunca interrompe a importação dos restantes.
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
  if (!data || !data.access_token) {
    throw new Error("Falha na autenticação com a Moloni: " + JSON.stringify(data));
  }
  return data.access_token;
}

// Converte um objeto (mesmo com arrays/objetos aninhados, como "products: [...]")
// para o formato "application/x-www-form-urlencoded" ao estilo PHP que a API da
// Moloni espera (ex.: products[0][name]=X&products[0][qty]=1).
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

// A Moloni pagina os resultados (normalmente 25 ou 50 por página) — percorre
// todas as páginas até já não vir mais nenhum resultado, com um limite de
// segurança para nunca ficar num ciclo sem fim.
async function moloniListarTudo(caminho, accessToken, companyId, extra = {}) {
  const todos = [];
  let pagina = 1;
  let ultimaRespostaCrua = null;
  while (pagina <= 200) {
    const resultado = await moloniPost(caminho, accessToken, { company_id: Number(companyId), qty: 50, offset: (pagina - 1) * 50, ...extra });
    ultimaRespostaCrua = resultado;
    if (!Array.isArray(resultado) || !resultado.length) break;
    todos.push(...resultado);
    if (resultado.length < 50) break;
    pagina++;
  }
  if (!todos.length) console.warn(`moloniListarTudo(${caminho}) devolveu vazio. Resposta crua da Moloni:`, JSON.stringify(ultimaRespostaCrua));
  todos._respostaCrua = ultimaRespostaCrua; // só para diagnóstico, não interfere no uso normal do array
  return todos;
}

// Vai buscar o preço de custo de UM artigo (pela referência) a
// "products/getByReference" — é o único endpoint que devolve o custo
// (suppliers[].cost_price). Devolve null em qualquer erro/ausência, nunca
// lança exceção — uma referência problemática não pode travar as restantes.
async function moloniPrecoCusto(accessToken, companyId, reference) {
  try {
    const resp = await moloniPost("products/getByReference", accessToken, { company_id: Number(companyId), reference });
    const fornecedores = resp && Array.isArray(resp.suppliers) ? resp.suppliers : [];
    const comCusto = fornecedores.find((s) => s && s.cost_price != null && Number(s.cost_price) > 0);
    return comCusto ? Number(comCusto.cost_price) : null;
  } catch (_e) {
    return null;
  }
}

// Corre uma lista de tarefas assíncronas com um limite de pedidos em
// simultâneo (para não sobrecarregar a API da Moloni nem estourar o tempo
// máximo da Edge Function quando há muitos artigos).
async function comConcorrenciaLimitada(itens, limite, tarefa) {
  const resultados = new Array(itens.length);
  let indice = 0;
  async function worker() {
    while (indice < itens.length) {
      const i = indice++;
      resultados[i] = await tarefa(itens[i], i);
    }
  }
  const workers = Array.from({ length: Math.min(limite, itens.length) }, () => worker());
  await Promise.all(workers);
  return resultados;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!SUPABASE_URL || !SERVICE_KEY) {
      return json({ erro: "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY não configurados." }, 500);
    }
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    const body = await req.json().catch(() => ({}));
    const { admin_id, tipo, referencia } = body;
    if (!admin_id || !tipo || !["clientes", "artigos", "fornecedores", "custo_artigo", "custos_em_lote"].includes(tipo)) {
      return json({ erro: "Faltam dados (admin_id, tipo='clientes'|'artigos'|'fornecedores'|'custo_artigo'|'custos_em_lote')." }, 400);
    }
    if (tipo === "custo_artigo" && !referencia) {
      return json({ erro: "Falta a referência do artigo (referencia)." }, 400);
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
    const accessToken = await moloniAutenticar(mol);

    if (tipo === "clientes") {
      const clientesMoloni = await moloniListarTudo("customers/getAll", accessToken, companyId);
      const lista = clientesMoloni.map((c) => ({
        numero: c.number || "",
        nomeMoloni: c.name || "",
        nif: c.vat || "",
        morada: c.address || "",
        codigoPostal: c.zip_code || "",
        cidade: c.city || "",
        email: c.email || "",
        telefone: c.phone || "",
      }));
      return json({ ok: true, tipo: "clientes", total: lista.length, itens: lista, diagnostico: lista.length ? undefined : clientesMoloni._respostaCrua });
    }

    if (tipo === "fornecedores") {
      const fornecedoresMoloni = await moloniListarTudo("suppliers/getAll", accessToken, companyId);
      const lista = fornecedoresMoloni.map((f) => ({
        nomeMoloni: f.name || "",
        nif: f.vat || "",
        email: f.email || "",
        telefone: f.phone || "",
      }));
      return json({ ok: true, tipo: "fornecedores", total: lista.length, itens: lista, diagnostico: lista.length ? undefined : fornecedoresMoloni._respostaCrua });
    }

    // Recalcular o custo de UM único artigo (botão "Recalcular custo" na tabela de Artigos) —
    // evita ter de correr a sincronização toda só para atualizar um preço de fornecedor.
    if (tipo === "custo_artigo") {
      const precoCusto = await moloniPrecoCusto(accessToken, companyId, referencia);
      return json({ ok: true, tipo: "custo_artigo", referencia, precoCusto });
    }

    // Recalcular o custo de VÁRIOS artigos de uma vez (botão geral "Recalcular custos" na
    // tabela de Artigos) — recebe a lista de referências já existentes no TotalGest e devolve
    // o custo atual de cada uma, sem tocar em nome/preço de venda/stock (isso é o que faz a
    // sincronização "artigos" normal).
    if (tipo === "custos_em_lote") {
      const referencias = Array.isArray(body.referencias) ? body.referencias.filter(Boolean).map(String) : [];
      const resultados = await comConcorrenciaLimitada(referencias, 5, async (ref) => ({
        referencia: ref,
        precoCusto: await moloniPrecoCusto(accessToken, companyId, ref),
      }));
      return json({ ok: true, tipo: "custos_em_lote", total: resultados.length, itens: resultados });
    }

    // tipo === 'artigos'
    //
    // IMPORTANTE: "products/getAll" da Moloni devolve só os artigos DE UMA categoria — não é um
    // "dá-me tudo". Passar category_id:0 apanha (no máximo) os artigos sem categoria — se o
    // catálogo estiver organizado em categorias (o normal), ficavam todos de fora, sem erro
    // nenhum visível (o pedido em si é válido, só devolve pouco ou nada).
    //
    // Por isso, primeiro vai-se buscar TODAS as categorias (percorrendo a árvore, já que podem
    // ter subcategorias — "productCategories/getAll" com category_id:0 só devolve as de topo),
    // e depois percorre-se o catálogo categoria a categoria, mais os "sem categoria" (0) e os
    // "órfãos" de uma categoria apagada (-1), juntando tudo sem duplicados por product_id.
    //
    // NOTA sobre categorias: o TotalGest não tem (nem precisa de ter) subcategorias — a
    // "categoria" de um artigo é só um campo de texto simples. Por isso aqui só se aproveita o
    // NOME da categoria de cada artigo na Moloni (não a árvore toda/caminho completo), para
    // servir de valor inicial nesse campo em vez do genérico "Geral". Quem quiser reorganizar
    // por categorias mais específicas do que a Moloni tem, continua a poder editar à mão — e o
    // botão "Arrumar categorias" do TotalGest já trata de nomes escritos de forma diferente.
    async function moloniTodasAsCategorias(): Promise<Map<number, string>> {
      const nomesPorId = new Map<number, string>();
      const porVisitar: number[] = [0];
      const visitados = new Set<number>([0]);
      while (porVisitar.length) {
        const catId = porVisitar.shift()!;
        const filhas = await moloniListarTudo("productCategories/getAll", accessToken, companyId, { category_id: catId });
        for (const c of filhas) {
          if (c.category_id == null || visitados.has(c.category_id)) continue;
          visitados.add(c.category_id);
          nomesPorId.set(c.category_id, c.name || "");
          porVisitar.push(c.category_id);
        }
      }
      return nomesPorId;
    }
    const nomesCategorias = await moloniTodasAsCategorias();
    const idsAPercorrer = [0, -1, ...nomesCategorias.keys()]; // 0 = sem categoria, -1 = órfãos
    const porProdutoId = new Map<number, any>();
    await comConcorrenciaLimitada(idsAPercorrer, 5, async (catId) => {
      const produtos = await moloniListarTudo("products/getAll", accessToken, companyId, { category_id: catId });
      for (const p of produtos) {
        if (p.product_id == null || porProdutoId.has(p.product_id)) continue; // já visto por outra categoria — mantém a primeira
        porProdutoId.set(p.product_id, { ...p, __categoriaId: catId });
      }
    });
    const produtosMoloni = [...porProdutoId.values()];
    const lista = produtosMoloni.map((p) => ({
      nomeMoloni: p.name || "",
      referencia: p.reference || "",
      categoria: p.__categoriaId > 0 ? (nomesCategorias.get(p.__categoriaId) || "") : (p.__categoriaId === -1 ? "Sem categoria (órfão na Moloni)" : ""),
      precoVenda: p.price != null ? Number(p.price) : null,
      stockAtual: p.stock != null ? Number(p.stock) : 0,
      unidade: (p.measurement_unit && p.measurement_unit.name) || p.unit || "un",
      precoCusto: null, // preenchido a seguir
    }));

    // Preço de custo: pedido extra por artigo (só quem tem referência), em
    // lotes de 5 em simultâneo para não sobrecarregar a Moloni nem estourar
    // o tempo máximo da function. Com muitos artigos isto demora mais um
    // pouco — é normal.
    const comReferencia = lista.filter((it) => it.referencia);
    if (comReferencia.length) {
      await comConcorrenciaLimitada(comReferencia, 5, async (it) => {
        it.precoCusto = await moloniPrecoCusto(accessToken, companyId, it.referencia);
      });
    }

    return json({ ok: true, tipo: "artigos", total: lista.length, itens: lista, diagnostico: lista.length ? undefined : { categoriasEncontradas: nomesCategorias.size, idsPercorridos: idsAPercorrer } });
  } catch (e) {
    console.error("Erro em importar-moloni:", e);
    return json({ erro: String(e && e.message ? e.message : e) }, 500);
  }
});