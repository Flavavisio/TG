// ============================================================================
//  Edge Function: faturar-moloni
//  Recebe os dados de uma OS concluída (cliente, valor, descrição, materiais
//  gastos) e emite uma fatura na Moloni, em nome da empresa (admin) que a
//  está a faturar. Também regista o recibo de pagamento associado a uma
//  fatura já emitida, quando uma OS é marcada como "Pago" no TotalGest
//  (corpo com acao:'recibo').
//
//  Deploy (painel Supabase):
//   Edge Functions > faturar-moloni > Editar > colar este código > Deploy.
//
//  Secrets necessários (os mesmos já usados pelas outras funções):
//    SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//
//  As credenciais da Moloni NÃO são secrets globais — são guardadas por
//  empresa, no campo administradores.integracao_faturacao (JSONB), e só
//  esta função (com a service role key) as lê.
//
//  NOVIDADE NESTA VERSÃO — faturar por artigos reais:
//   Antes, cada fatura tinha só UMA linha genérica ("Serviço prestado"), sem
//   nunca descontar stock na Moloni. Agora, se o pedido incluir "materiais"
//   (lista de {referencia, nome, qty, precoVenda}), cada um vira uma linha
//   própria na fatura, ligada ao PRODUTO certo na Moloni (encontrado pela
//   referência — criado automaticamente lá se ainda não existir). O
//   restante do valor (valorMaoDeObra) continua a ir como uma linha de
//   serviço, tal como antes.
//
//  NOVIDADE — ligar clientes por ID, não só por NIF:
//   Se o pedido incluir cliente.moloniCustomerId (guardado de uma fatura
//   anterior), usa-se esse ID diretamente, sem procurar pelo NIF — mais
//   rápido, e continua a bater certo mesmo que o nome/morada do cliente
//   tenham sido corrigidos diretamente na Moloni entretanto. A resposta
//   inclui sempre "customerId", para a app guardar e reutilizar da próxima vez.
//
//  NOVIDADE — Guias de Transporte (acao:'guia_transporte'):
//   Emite uma guia de transporte na Moloni para os materiais indicados,
//   ligados aos artigos certos (criados automaticamente lá se preciso).
//   Precisa da morada de destino (moradaDestino/cidadeDestino/cpDestino); a
//   morada de partida é obtida automaticamente da própria empresa na Moloni.
//
//  NOVIDADE — Notas de Crédito (acao:'nota_credito'):
//   Anula uma fatura já emitida por completo (document_id), replicando as
//   mesmas linhas de produtos da fatura original como crédito.
//
//  NOVIDADE — Consultar NIF (acao:'consultar_nif'):
//   Procura, entre os CLIENTES JÁ REGISTADOS NESTA CONTA MOLONI, um cliente
//   com o NIF indicado, e devolve nome/morada/código postal/cidade para
//   pré-preencher o formulário de cliente na app. IMPORTANTE: a Moloni não
//   é um serviço de consulta ao registo comercial — só encontra clientes
//   que a empresa já tenha faturado antes (nesta conta Moloni). Para um NIF
//   totalmente novo, devolve encontrado:false, e a app deixa a pessoa
//   preencher à mão como já fazia.
//
//  NOVIDADE — Verificar Pagamento (acao:'verificar_pagamento'):
//   Consulta na Moloni o estado atual de uma fatura já emitida (document_id)
//   e diz se já está paga ("closed"), devolvendo também o recibo associado
//   (se existir), para a app atualizar o estado "Pago" sem ser preciso ir
//   confirmar manualmente à Moloni.
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
  const data = await res.json();
  return data;
}

// Procura o cliente na Moloni pelo NIF; devolve o customer_id, ou null se não encontrar.
async function moloniEncontrarCliente(accessToken, companyId, nif) {
  if (!nif) return null;
  const resultado = await moloniPost("customers/getBySearch", accessToken, { company_id: companyId, search: nif });
  if (Array.isArray(resultado) && resultado.length) {
    const match = resultado.find((c) => String(c.vat) === String(nif)) || resultado[0];
    return match.customer_id;
  }
  return null;
}

// Igual à anterior, mas devolve o registo completo do cliente (não só o ID) — usado por
// "consultar_nif" para pré-preencher nome/morada no formulário da app.
async function moloniEncontrarClienteCompleto(accessToken, companyId, nif) {
  if (!nif) return null;
  const resultado = await moloniPost("customers/getBySearch", accessToken, { company_id: companyId, search: nif });
  if (Array.isArray(resultado) && resultado.length) {
    return resultado.find((c) => String(c.vat) === String(nif)) || null;
  }
  return null;
}

async function moloniCriarCliente(accessToken, companyId, cliente) {
  const body = {
    company_id: companyId,
    vat: cliente.nif || "999999990", // "Consumidor final" quando não há NIF
    name: cliente.nome || "Cliente",
    address: cliente.morada || "Desconhecida",
    city: cliente.cidade || "",
    zip_code: cliente.codigoPostal || "",
    country_id: 1, // Portugal
    language_id: 1,
    email: cliente.email || "",
  };
  const resultado = await moloniPost("customers/insert", accessToken, body);
  if (!resultado || !resultado.customer_id) {
    throw new Error("Não foi possível criar o cliente na Moloni: " + JSON.stringify(resultado));
  }
  return resultado.customer_id;
}

async function moloniListarEmpresas(accessToken) {
  try {
    const res = await moloniPost("companies/getAll", accessToken, {});
    if (Array.isArray(res)) return res.map((c) => ({ id: c.company_id, nome: c.name }));
    return [];
  } catch (e) {
    return [];
  }
}

// Vai buscar a "Série de Documentos" certa à própria conta da Moloni, em vez de
// obrigar a configurar isto à mão — a Moloni exige um document_set_id válido
// para poder emitir faturas, e este valor é específico de cada conta/série.
async function moloniObterSerieDocumento(accessToken, companyId, documentSetIdConfigurado) {
  const series = await moloniPost("documentSets/getAll", accessToken, { company_id: Number(companyId) });
  if (!Array.isArray(series) || !series.length) {
    throw new Error("Não foi possível obter as séries de documentos da Moloni — confirma se já configuraste pelo menos uma série em Configurações > Séries, na Moloni.");
  }
  let serie = null;
  if (documentSetIdConfigurado) {
    serie = series.find((s) => String(s.document_set_id) === String(documentSetIdConfigurado));
  }
  // O campo correto da API para "série marcada como padrão" é "active_by_default"
  // (não "is_default" — esse nome não existe na resposta real da Moloni).
  if (!serie) serie = series.find((s) => s.active_by_default === 1 || s.active_by_default === true) || series[0];
  return serie;
}

// Vai buscar um imposto/taxa válido à conta da Moloni (ex.: "IVA normal 23%"), para usar
// nos artigos da fatura — sem isto, a Moloni exige um "exemption_reason" válido (um código
// fiscal de isenção), que não devemos inventar sem confirmar a situação fiscal da empresa.
async function moloniObterImposto(accessToken, companyId, taxIdConfigurado) {
  const impostos = await moloniPost("taxes/getAll", accessToken, { company_id: Number(companyId) });
  if (!Array.isArray(impostos) || !impostos.length) return null;
  let imposto = null;
  if (taxIdConfigurado) {
    imposto = impostos.find((t) => String(t.tax_id) === String(taxIdConfigurado));
  }
  if (!imposto) imposto = impostos.find((t) => t.active_by_default === 1 || t.active_by_default === true) || impostos[0];
  return imposto;
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

// Cria um produto novo na Moloni (quando ainda não existe lá, mas já existe no TotalGest) —
// fica com stock 0 na Moloni (ela só vai controlando a partir daqui, através das faturas).
async function moloniCriarProduto(accessToken, companyId, artigo, categoriaId, unidadeId, imposto) {
  const body = {
    company_id: companyId,
    category_id: categoriaId,
    name: artigo.nome || "Artigo",
    reference: artigo.referencia,
    price: artigo.precoVenda || 0,
    unit_id: unidadeId,
    has_stock: 1,
    stock: 0,
    type: 1, // produto (não serviço)
  };
  if (imposto) body.taxes = [{ tax_id: imposto.tax_id, order: 0, cumulative: 0 }];
  const resultado = await moloniPost("products/insert", accessToken, body);
  if (!resultado || !resultado.product_id) {
    throw new Error("Não foi possível criar o artigo \"" + artigo.nome + "\" na Moloni: " + JSON.stringify(resultado));
  }
  return resultado.product_id;
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

// Transforma uma lista de materiais (referencia, nome, qty, precoVenda) em linhas de
// "products" prontas para qualquer documento da Moloni — ligadas ao produto certo (criado
// automaticamente lá se ainda não existir).
async function moloniLinhasMateriais(accessToken, companyId, materiais, imposto) {
  const linhas = [];
  if (!Array.isArray(materiais) || !materiais.length) return linhas;
  const { categoriaId, unidadeId } = await moloniObterCategoriaEUnidadePadrao(accessToken, companyId);
  for (const mat of materiais) {
    if (!mat.referencia || !mat.qty) continue;
    let productId = await moloniEncontrarProduto(accessToken, companyId, mat.referencia);
    if (!productId) {
      productId = await moloniCriarProduto(accessToken, companyId, mat, categoriaId, unidadeId, imposto);
    }
    const linha = { product_id: productId, name: mat.nome || undefined, qty: mat.qty, price: mat.precoVenda || 0 };
    if (imposto) linha.taxes = [{ tax_id: imposto.tax_id, order: 0, cumulative: 0 }];
    else linha.exemption_reason = "M99";
    linhas.push(linha);
  }
  return linhas;
}

// Junta as linhas de produtos (materiais reais, ligados a artigos na Moloni) + a linha de
// mão de obra/serviço (o valor que sobra), prontas a incluir no pedido de fatura.
async function moloniMontarLinhasProdutos(accessToken, companyId, materiais, valorMaoDeObra, descricaoServico, imposto) {
  const linhas = await moloniLinhasMateriais(accessToken, companyId, materiais, imposto);
  if (valorMaoDeObra == null || valorMaoDeObra > 0) {
    const linhaServico = { name: descricaoServico || "Mão de obra / Serviço", qty: 1, price: valorMaoDeObra != null ? valorMaoDeObra : 0 };
    if (imposto) linhaServico.taxes = [{ tax_id: imposto.tax_id, order: 0, cumulative: 0 }];
    else linhaServico.exemption_reason = "M99";
    linhas.push(linhaServico);
  }
  return linhas;
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
    const { admin_id, cliente, descricao, valor, valorMaoDeObra, materiais, moradaDestino, cidadeDestino, cpDestino, data: dataServico, acao, document_id, nif } = body;
    const acaoReal = acao || "fatura";
    if (!admin_id) return json({ erro: "Falta admin_id." }, 400);
    if ((acaoReal === "fatura" || acaoReal === "guia_transporte") && !cliente) {
      return json({ erro: "Falta o cliente." }, 400);
    }
    if (acaoReal === "fatura" && valor == null) {
      return json({ erro: "Falta o valor da fatura." }, 400);
    }
    if (acaoReal === "recibo" && !document_id) {
      return json({ erro: "Falta o document_id da fatura a que este recibo se associa." }, 400);
    }
    if (acaoReal === "nota_credito" && !document_id) {
      return json({ erro: "Falta o document_id da fatura a anular." }, 400);
    }
    if (acaoReal === "guia_transporte" && (!Array.isArray(materiais) || !materiais.length)) {
      return json({ erro: "Falta pelo menos um material para incluir na guia." }, 400);
    }
    if (acaoReal === "consultar_nif" && !nif) {
      return json({ erro: "Falta o NIF a consultar." }, 400);
    }
    if (acaoReal === "verificar_pagamento" && !document_id) {
      return json({ erro: "Falta o document_id da fatura a verificar." }, 400);
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
    const simulacao = cfg.simulacao !== false; // por omissão, simulação (mais seguro)

    // Consultar NIF: procura entre os clientes JÁ REGISTADOS nesta conta Moloni. Não é uma
    // consulta ao registo comercial nacional — só encontra quem a empresa já faturou antes.
    // Por isso funciona mesmo em modo simulação (não emite nenhum documento).
    if (acaoReal === "consultar_nif") {
      const accessToken = await moloniAutenticar(mol);
      const encontrado = await moloniEncontrarClienteCompleto(accessToken, companyId, nif);
      if (!encontrado) return json({ encontrado: false });
      return json({
        encontrado: true,
        nome: encontrado.name || null,
        morada: encontrado.address || null,
        codigoPostal: encontrado.zip_code || null,
        cidade: encontrado.city || null,
        moloniCustomerId: encontrado.customer_id || null,
      });
    }

    // Verificar Pagamento: consulta o estado atual de uma fatura já emitida. Funciona mesmo
    // em modo simulação, já que é só uma leitura (não emite nem altera nada).
    if (acaoReal === "verificar_pagamento") {
      const accessToken = await moloniAutenticar(mol);
      const doc = await moloniPost("invoices/getOne", accessToken, { company_id: Number(companyId), document_id: Number(document_id) });
      if (!doc || !doc.document_id) {
        return json({ erro: "Não foi possível encontrar esta fatura na Moloni (document_id " + document_id + ")." }, 400);
      }
      // "closed" é o campo padrão da Moloni para "documento já totalmente liquidado".
      const pago = doc.closed === 1 || doc.closed === true;
      let reciboId = null, reciboUrl = null;
      // Tenta identificar o recibo associado (se a Moloni o devolver na lista de documentos
      // associados) — feito com segurança extra: se algo falhar aqui, não impede a resposta
      // principal (pago/não pago) de chegar à app.
      try {
        const associados = doc.associated_documents_to || doc.associated_documents || [];
        const reciboAssociado = Array.isArray(associados) ? associados.find((a) => a && a.associated_id) : null;
        if (reciboAssociado) {
          reciboId = reciboAssociado.associated_id;
          const pdfResp = await moloniPost("receipts/getPDF", accessToken, { company_id: Number(companyId), document_id: Number(reciboId) });
          reciboUrl = pdfResp?.url || pdfResp?.pdf || null;
        }
      } catch (e) {
        console.warn("Não foi possível obter o recibo associado:", e);
      }
      return json({ pago, reciboId, reciboUrl });
    }

    // Nota de Crédito: caso à parte, porque trabalha a partir do document_id da fatura já
    // emitida (não precisa de cliente/materiais enviados de novo).
    if (acaoReal === "nota_credito") {
      const accessToken = await moloniAutenticar(mol);
      const faturaOriginal = await moloniPost("invoices/getOne", accessToken, { company_id: Number(companyId), document_id: Number(document_id) });
      if (!faturaOriginal || !faturaOriginal.document_id) {
        return json({ erro: "Não foi possível encontrar a fatura original na Moloni (document_id " + document_id + ")." }, 400);
      }
      if (simulacao) {
        return json({ ok: true, simulacao: true, mensagem: `Ligação com a Moloni validada com sucesso (modo simulação — nenhuma nota de crédito foi emitida). Fatura original: nº ${faturaOriginal.number || faturaOriginal.document_id}, valor ${faturaOriginal.net_value || "—"} €.` });
      }
      const serieCredito = await moloniObterSerieDocumento(accessToken, companyId, mol.documentSetIdNotaCredito);
      const produtosCredito = (faturaOriginal.products || []).map((p) => ({
        product_id: p.product_id,
        name: p.name,
        qty: p.qty,
        price: p.price,
        related_id: p.document_product_id,
        taxes: (p.taxes || []).map((t) => ({ tax_id: t.tax_id, value: t.value, order: t.order, cumulative: t.cumulative })),
        exemption_reason: (!p.taxes || !p.taxes.length) ? (p.exemption_reason || "M99") : undefined,
      }));
      if (!produtosCredito.length) {
        return json({ erro: "A fatura original não tem linhas de produtos para creditar." }, 400);
      }
      const notaCreditoBody = {
        company_id: companyId,
        customer_id: faturaOriginal.customer_id,
        date: new Date().toISOString().slice(0, 10),
        document_set_id: serieCredito.document_set_id,
        associated_documents: [{ associated_id: faturaOriginal.document_id, value: faturaOriginal.net_value }],
        products: produtosCredito,
      };
      const resultadoNC = await moloniPost("creditNotes/insert", accessToken, notaCreditoBody);
      if (!resultadoNC || !resultadoNC.document_id) {
        throw new Error("A Moloni não devolveu uma nota de crédito válida: " + JSON.stringify(resultadoNC));
      }
      let pdfUrlNC = null;
      try {
        const pdfResp = await moloniPost("creditNotes/getPDF", accessToken, { company_id: companyId, document_id: resultadoNC.document_id });
        pdfUrlNC = pdfResp?.url || pdfResp?.pdf || null;
      } catch (e) {
        console.warn("Não foi possível obter o PDF da nota de crédito:", e);
      }
      return json({ ok: true, simulacao: false, documentId: resultadoNC.document_id, pdfUrl: pdfUrlNC });
    }

    if (simulacao) {
      // Modo simulação: confirma que consegue autenticar e encontrar/criar o cliente, e que
      // consegue obter a série de documentos e o imposto a usar — mas NÃO cria nenhum
      // documento fiscal real, nem nenhum artigo novo na Moloni.
      const accessToken = await moloniAutenticar(mol);
      const empresasReais = await moloniListarEmpresas(accessToken);
      const idConfiguradoBate = empresasReais.some((e) => String(e.id) === String(companyId));
      let customerId = null;
      let serieEncontrada = null;
      let impostoEncontrado = null;
      let erroSerie = null;
      let materiaisEncontrados = 0, materiaisPorCriar = 0;
      if (idConfiguradoBate) {
        customerId = await moloniEncontrarCliente(accessToken, companyId, cliente.nif);
        try {
          serieEncontrada = await moloniObterSerieDocumento(accessToken, companyId, mol.documentSetId);
          impostoEncontrado = await moloniObterImposto(accessToken, companyId, mol.taxId);
          if (Array.isArray(materiais)) {
            for (const mat of materiais) {
              if (!mat.referencia) continue;
              const pid = await moloniEncontrarProduto(accessToken, companyId, mat.referencia);
              if (pid) materiaisEncontrados++; else materiaisPorCriar++;
            }
          }
        } catch (e) {
          erroSerie = e.message || String(e);
        }
      }
      const criadoAgora = !customerId;
      let mensagem;
      if (!idConfiguradoBate) {
        mensagem = `⚠️ O "ID da Empresa" configurado (${companyId}) não corresponde a nenhuma empresa desta conta Moloni. IDs reais disponíveis: ${empresasReais.map((e) => `${e.id} (${e.nome})`).join(", ") || "nenhum encontrado"}.`;
      } else if (erroSerie) {
        mensagem = `⚠️ ${erroSerie}`;
      } else {
        mensagem = (acaoReal === "recibo"
          ? "Ligação com a Moloni validada com sucesso (modo simulação — nenhum recibo foi emitido)."
          : acaoReal === "guia_transporte"
          ? "Ligação com a Moloni validada com sucesso (modo simulação — nenhuma guia foi emitida)."
          : "Ligação com a Moloni validada com sucesso (modo simulação — nenhuma fatura foi emitida).")
          + ` Série de documentos: ${serieEncontrada?.name || serieEncontrada?.document_set_id || "—"}. Imposto: ${impostoEncontrado ? impostoEncontrado.name + " (" + impostoEncontrado.value + "%)" : "nenhum encontrado na conta Moloni"}.`
          + (Array.isArray(materiais) && materiais.length ? ` Materiais: ${materiaisEncontrados} já existem na Moloni, ${materiaisPorCriar} seriam criados agora.` : "");
      }
      return json({
        ok: true,
        simulacao: true,
        clienteEncontrado: !criadoAgora,
        empresasDisponiveisNaMoloni: empresasReais,
        idConfiguradoBateComAlgumaEmpresa: idConfiguradoBate,
        mensagem,
      });
    }

    const accessToken = await moloniAutenticar(mol);
    // Se já sabemos o ID do cliente na Moloni (guardado de uma fatura anterior), usa-o
    // diretamente — mais rápido, e continua a bater certo mesmo que o nome/morada tenham
    // sido corrigidos diretamente na Moloni entretanto. Só se não tivermos o ID é que se
    // procura pelo NIF (e, no limite, se cria um cliente novo).
    let customerId = cliente.moloniCustomerId || null;
    if (!customerId) customerId = await moloniEncontrarCliente(accessToken, companyId, cliente.nif);
    if (!customerId) customerId = await moloniCriarCliente(accessToken, companyId, cliente);

    const hoje = dataServico || new Date().toISOString().slice(0, 10);

    if (acaoReal === "guia_transporte") {
      const serieGuia = await moloniObterSerieDocumento(accessToken, companyId, mol.documentSetIdGuia);
      const imposto = await moloniObterImposto(accessToken, companyId, mol.taxId);
      const produtosGuia = await moloniLinhasMateriais(accessToken, companyId, materiais, imposto);
      if (!produtosGuia.length) {
        return json({ erro: "Nenhum dos materiais indicados tem referência válida para ligar a um artigo na Moloni." }, 400);
      }
      // Morada de partida: usa a da própria empresa na Moloni (companies/getOne). Morada de
      // chegada: a da OS/obra, enviada pela app.
      let partida = {};
      try {
        const empresaInfo = await moloniPost("companies/getOne", accessToken, { company_id: Number(companyId) });
        partida = { address: empresaInfo?.address || "", city: empresaInfo?.city || "", zip_code: empresaInfo?.zip_code || "", country_id: empresaInfo?.country_id || 1 };
      } catch (e) {
        console.warn("Não foi possível obter a morada da empresa:", e);
      }
      const guiaBody = {
        company_id: companyId,
        customer_id: customerId,
        date: hoje,
        document_set_id: serieGuia.document_set_id,
        products: produtosGuia,
        delivery_datetime: hoje,
        delivery_departure_address: partida.address,
        delivery_departure_city: partida.city,
        delivery_departure_zip_code: partida.zip_code,
        delivery_departure_country: partida.country_id,
        delivery_destination_address: moradaDestino || "",
        delivery_destination_city: cidadeDestino || "",
        delivery_destination_zip_code: cpDestino || "",
        delivery_destination_country: 1,
      };
      const resultadoGuia = await moloniPost("billsOfLading/insert", accessToken, guiaBody);
      if (!resultadoGuia || !resultadoGuia.document_id) {
        throw new Error("A Moloni não devolveu uma guia válida: " + JSON.stringify(resultadoGuia));
      }
      let pdfUrlGuia = null;
      try {
        const pdfResp = await moloniPost("billsOfLading/getPDF", accessToken, { company_id: companyId, document_id: resultadoGuia.document_id });
        pdfUrlGuia = pdfResp?.url || pdfResp?.pdf || null;
      } catch (e) {
        console.warn("Não foi possível obter o PDF da guia:", e);
      }
      return json({ ok: true, simulacao: false, documentId: resultadoGuia.document_id, pdfUrl: pdfUrlGuia, customerId });
    }

    if (acaoReal === "recibo") {
      // Regista o recebimento (recibo/RC), associado à fatura já emitida — fecha o ciclo
      // fatura → pagamento sem precisar de ir à Moloni fazer isto à mão.
      const serieRecibo = await moloniObterSerieDocumento(accessToken, companyId, mol.documentSetIdRecibo);
      const reciboBody = {
        company_id: companyId,
        customer_id: customerId,
        date: hoje,
        document_set_id: serieRecibo.document_set_id,
        associated_documents: [
          { associated_id: document_id, value: Number(valor) },
        ],
      };
      const resultadoRecibo = await moloniPost("receipts/insert", accessToken, reciboBody);
      if (!resultadoRecibo || !resultadoRecibo.document_id) {
        throw new Error("A Moloni não devolveu um recibo válido: " + JSON.stringify(resultadoRecibo));
      }
      let pdfUrlRecibo = null;
      try {
        const pdfResp = await moloniPost("receipts/getPDF", accessToken, { company_id: companyId, document_id: resultadoRecibo.document_id });
        pdfUrlRecibo = pdfResp?.url || pdfResp?.pdf || null;
      } catch (e) {
        console.warn("Não foi possível obter o PDF do recibo:", e);
      }
      return json({ ok: true, simulacao: false, documentId: resultadoRecibo.document_id, pdfUrl: pdfUrlRecibo, customerId });
    }

    const serieFatura = await moloniObterSerieDocumento(accessToken, companyId, mol.documentSetId);
    const imposto = await moloniObterImposto(accessToken, companyId, mol.taxId);

    // Materiais reais gastos na OS (se vierem) + mão de obra/serviço com o valor restante —
    // em vez de uma única linha genérica com o valor todo.
    const valorMaoDeObraReal = valorMaoDeObra != null ? Number(valorMaoDeObra) : Number(valor);
    const produtos = await moloniMontarLinhasProdutos(accessToken, companyId, materiais, valorMaoDeObraReal, descricao, imposto);
    if (!produtos.length) {
      // Salvaguarda: nunca emitir uma fatura sem nenhuma linha.
      produtos.push({ name: descricao || "Serviço prestado", qty: 1, price: Number(valor), ...(imposto ? { taxes: [{ tax_id: imposto.tax_id, order: 0, cumulative: 0 }] } : { exemption_reason: "M99" }) });
    }

    const documentoBody = {
      company_id: companyId,
      customer_id: customerId,
      date: hoje,
      expiration_date: hoje,
      document_set_id: serieFatura.document_set_id,
      products: produtos,
    };
    const resultadoFatura = await moloniPost("invoices/insert", accessToken, documentoBody);
    if (!resultadoFatura || !resultadoFatura.document_id) {
      throw new Error("A Moloni não devolveu um documento válido: " + JSON.stringify(resultadoFatura));
    }

    let pdfUrl = null;
    try {
      const pdfResp = await moloniPost("invoices/getPDF", accessToken, { company_id: companyId, document_id: resultadoFatura.document_id });
      pdfUrl = pdfResp?.url || pdfResp?.pdf || null;
    } catch (e) {
      console.warn("Não foi possível obter o PDF da fatura:", e);
    }

    return json({ ok: true, simulacao: false, documentId: resultadoFatura.document_id, pdfUrl, customerId });
  } catch (e) {
    console.error("Erro em faturar-moloni:", e);
    return json({ erro: String(e && e.message ? e.message : e) }, 500);
  }
});