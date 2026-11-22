/* Total Gest — validação de importações e apresentação dos saldos de materiais. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.TGMateriaisPartilhados = Object.freeze(api);
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';
  const id = value => String(value == null ? '' : value).trim();
  const number = value => {
    const n = typeof value === 'string' ? Number(value.trim().replace(',', '.')) : Number(value);
    return Number.isFinite(n) && n >= 0 ? n : NaN;
  };
  const round = n => Math.round((n + Number.EPSILON) * 10000) / 10000;
  const key = row => id(row.artigoId || row.artigo_id || row.referencia || row.ref || row.codigo).toUpperCase();
  function normalizarPlano(row) {
    if (!row || typeof row !== 'object') throw Error('Linha de material inválida.');
    const referencia = key(row);
    const descricao = id(row.descricao || row.nome || row.artigo);
    const quantidade = number(row.quantidade ?? row.previsto ?? row.quantidadePrevista);
    if (!referencia && !descricao) throw Error('O material necessita de referência ou descrição.');
    if (!Number.isFinite(quantidade) || round(quantidade) <= 0) throw Error('Quantidade prevista inválida.');
    return { referencia, descricao, quantidade: round(quantidade), unidade: id(row.unidade || 'un.') };
  }
  function importarLinhas(linhas) {
    if (!Array.isArray(linhas)) throw Error('A importação deve conter linhas.');
    const validas = [], erros = [];
    linhas.forEach((linha, i) => {
      if (!linha || Object.values(linha).every(v => !id(v))) return;
      try { validas.push({ linha: i + 2, ...normalizarPlano(linha) }); }
      catch (e) { erros.push({ linha: i + 2, mensagem: e.message }); }
    });
    return { materiais: validas, erros, podeConfirmar: validas.length > 0 && erros.length === 0 };
  }
  function resumo(plano, movimentos) {
    const acumulado = new Map();
    (plano || []).forEach(item => {
      const p = normalizarPlano(item), k = p.referencia || p.descricao.toUpperCase();
      const anterior = acumulado.get(k);
      if (anterior) anterior.previsto = round(anterior.previsto + p.quantidade);
      else acumulado.set(k, { referencia: p.referencia, descricao: p.descricao, unidade: p.unidade, previsto: p.quantidade, consumido: 0 });
    });
    const vistos = new Set();
    (movimentos || []).forEach((item, index) => {
      const movId = id(item.id || item.movimentoId);
      if (movId && vistos.has(movId)) return;
      if (movId) vistos.add(movId);
      const q = number(item.quantidade ?? item.consumido);
      if (!Number.isFinite(q) || q <= 0) throw Error('Movimento com quantidade inválida na posição ' + (index + 1));
      const k = key(item) || id(item.descricao || item.nome || item.artigo).toUpperCase();
      if (!k) throw Error('Movimento sem material.');
      const p = acumulado.get(k) || { referencia: key(item), descricao: id(item.descricao || item.nome || item.artigo), unidade: id(item.unidade || 'un.'), previsto: 0, consumido: 0 };
      p.consumido = round(p.consumido + q);
      acumulado.set(k, p);
    });
    return Array.from(acumulado.values(), p => ({ ...p, faltaConsumir: round(Math.max(0, p.previsto - p.consumido)), extraNaoPrevisto: p.previsto === 0, excedente: round(Math.max(0, p.consumido - p.previsto)) }));
  }
  function destinoMovimento({ osId, obraId, tipo }) {
    if (tipo !== 'os' && tipo !== 'obra') throw Error('Tipo de intervenção inválido.');
    if (tipo === 'os' && !id(osId)) throw Error('OS não identificada.');
    if (tipo === 'obra' && !id(obraId)) throw Error('Obra não identificada.');
    // Uma OS pertencente a Obra mantém a OS como origem única de cada movimento.
    return { tipo, origemId: tipo === 'os' ? id(osId) : id(obraId), obraId: id(obraId) || null };
  }
  function movimentosDaObra(movimentos, obraId, idsOsDaObra) {
    const os = new Set((idsOsDaObra || []).map(id));
    const vistos = new Set();
    return (movimentos || []).filter(m => {
      const origem = id(m.origemId || m.origem_id);
      const tipo = id(m.tipo || m.origem_tipo).toLowerCase();
      const pertence = (tipo === 'obra' && origem === id(obraId)) || (tipo === 'os' && os.has(origem));
      if (!pertence) return false;
      const k = id(m.id || m.movimentoId);
      if (k && vistos.has(k)) return false;
      if (k) vistos.add(k);
      return true;
    });
  }

  function importarMatriz(cabecalhos, linhas) {
    if (!Array.isArray(cabecalhos) || !Array.isArray(linhas)) throw Error('Excel inválido.');
    const limpar = x => id(x).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
    const nomes = cabecalhos.map(limpar);
    const aliases = {
      referencia: ['referencia','ref','codigo','artigoid'],
      descricao: ['descricao','nome','artigo','produto'],
      quantidade: ['quantidade','qtd','qtdprevista','quantidadeprevista','previsto'],
      unidade: ['unidade','un','ud']
    };
    const index = campo => nomes.findIndex(n => aliases[campo].includes(n));
    if (index('quantidade') < 0 || (index('referencia') < 0 && index('descricao') < 0)) {
      return { materiais: [], erros: [{ linha: 1, mensagem: 'Cabeçalhos obrigatórios: Referência ou Descrição, e Quantidade.' }], podeConfirmar: false };
    }
    const objetos = linhas.map(row => {
      const item = {};
      for (const campo of Object.keys(aliases)) {
        const coluna = index(campo);
        if (coluna >= 0) item[campo] = Array.isArray(row) ? row[coluna] : undefined;
      }
      return item;
    });
    return importarLinhas(objetos);
  }
  function associarImportacaoAoCatalogo(resultado, artigos) {
    const normalizar = value => id(value).toLocaleLowerCase('pt-PT');
    const referencias = new Map(), nomes = new Map();
    for (const artigo of artigos) {
      for (const [chave, indice] of [[artigo.referencia, referencias], [artigo.nome, nomes]]) {
        const termo = normalizar(chave);
        if (termo) indice.set(termo, [...(indice.get(termo) || []), artigo]);
      }
    }
    const erros = resultado.erros.map(e => 'Linha ' + e.linha + ': ' + e.mensagem);
    const quantidades = new Map();
    for (const linha of resultado.materiais) {
      const ref = normalizar(linha.referencia), nome = normalizar(linha.descricao);
      const encontrados = referencias.get(ref) || referencias.get(nome) || nomes.get(nome || ref) || [];
      if (encontrados.length !== 1) {
        erros.push('Linha ' + linha.linha + ': artigo inexistente ou ambíguo (' + (linha.referencia || linha.descricao) + ').');
        continue;
      }
      const artigoId = encontrados[0].id;
      quantidades.set(artigoId, round((quantidades.get(artigoId) || 0) + linha.quantidade));
    }
    if (erros.length) throw Error(erros.slice(0, 8).join(' '));
    if (!quantidades.size) throw Error('O ficheiro não tem materiais para importar.');
    return quantidades;
  }

  function importarFolhaXlsx(workbook, xlsx) {
    if (!workbook || !xlsx || !xlsx.utils || typeof xlsx.utils.sheet_to_json !== 'function') throw Error('Leitor Excel indisponível.');
    const primeira = workbook.Sheets && workbook.Sheets[workbook.SheetNames && workbook.SheetNames[0]];
    if (!primeira) throw Error('O ficheiro Excel não tem folhas válidas.');
    const matriz = xlsx.utils.sheet_to_json(primeira, { header: 1, defval: '', raw: false });
    if (!matriz.length) return { materiais: [], erros: [{ linha: 1, mensagem: 'O Excel está vazio.' }], podeConfirmar: false };
    return importarMatriz(matriz[0], matriz.slice(1));
  }
  function renderizarSaldos(linhas) {
    const esc = v => id(v).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
    const val = x => new Intl.NumberFormat('pt-PT', { maximumFractionDigits: 4 }).format(x);
    return (linhas || []).map(x => {
      const unidade = esc(x.unidade || 'un.');
      const titulo = esc(x.descricao || x.referencia);
      return '<div class="tg-material-item"><strong class="tg-material-nome">' + titulo + '</strong>' +
        (x.referencia ? '<small class="tg-material-ref">' + esc(x.referencia) + '</small>' : '') +
        '<span class="tg-material-saldo">Previsto: ' + esc(val(x.previsto)) + ' ' + unidade + '</span>' +
        '<span class="tg-material-saldo">Consumido: ' + esc(val(x.consumido)) + ' ' + unidade + '</span>' +
        '<span class="tg-material-saldo">Falta consumir: ' + esc(val(x.faltaConsumir)) + ' ' + unidade + '</span>' +
        (x.excedente > 0 ? '<span class="tg-material-excedente">Excedente: ' + esc(val(x.excedente)) + ' ' + unidade + '</span>' : '') +
        (x.extraNaoPrevisto ? '<span class="tg-material-alerta">Material não previsto</span>' : '') +
        '</div>';
    }).join('');
  }

  function saldosDaObra({ obraId, adminId, obraMateriais, artigos }) {
    if (!id(obraId) || !id(adminId)) throw Error('Obra ou empresa não identificada.');
    const catalogo = new Map((artigos || []).filter(a => id(a.adminId) === id(adminId)).map(a => [id(a.id), a]));
    return (obraMateriais || []).filter(m => id(m.obraId) === id(obraId) && id(m.adminId) === id(adminId)).map(m => {
      const artigo = catalogo.get(id(m.artigoId));
      const previsto = number(m.qtdPrevista);
      const consumido = number(m.qtdConsumida);
      if (!Number.isFinite(previsto) || !Number.isFinite(consumido)) throw Error('Quantidades inválidas nos materiais desta obra.');
      return {
        referencia: id(artigo?.referencia || m.artigoId),
        descricao: id(artigo?.nome || '(artigo removido)'),
        unidade: id(artigo?.unidade || 'un.'),
        previsto: round(previsto),
        consumido: round(consumido),
        faltaConsumir: round(Math.max(0, previsto - consumido)),
        extraNaoPrevisto: previsto === 0,
        excedente: round(Math.max(0, consumido - previsto))
      };
    });
  }

  function atualizarPainelObra(elemento, contexto) {
    if (!elemento || typeof elemento.querySelector !== 'function') return false;
    const linhas = saldosDaObra(contexto);
    let painel = elemento.querySelector('#tg-materiais-saldo-obra');
    if (!painel) {
      painel = elemento.ownerDocument.createElement('section');
      painel.id = 'tg-materiais-saldo-obra';
      painel.setAttribute('aria-label','Resumo de materiais previstos e consumidos da obra');
      elemento.prepend(painel);
    }
    painel.innerHTML = '<h4>Materiais — previsto e consumido</h4>' +
      (linhas.length ? '<div class="tg-material-lista">' + renderizarSaldos(linhas) + '</div>' :
      '<p class="tg-material-vazio">Ainda não há materiais associados a esta obra.</p>');
    return true;
  }
  function atualizarPainelOS(elemento, contexto) {
    if (!elemento || typeof elemento.querySelector !== 'function' || !id(contexto?.obraId)) return false;
    const linhas = saldosDaObra(contexto);
    let painel = elemento.querySelector('#tg-materiais-saldo-os');
    if (!painel) {
      painel = elemento.ownerDocument.createElement('section');
      painel.id = 'tg-materiais-saldo-os';
      painel.className = 'tg-materiais-consulta-os';
      painel.setAttribute('aria-label','Materiais previstos da obra associada à OS');
      elemento.append(painel);
    }
    painel.innerHTML = '<div class="ff-secao-head">Materiais da obra associada</div>' +
      '<p class="tg-material-ajuda">Consulta dos materiais da obra. O consumo desta OS deve ser registado uma única vez na folha de obra.</p>' +
      (linhas.length ? '<div class="tg-material-lista">' + renderizarSaldos(linhas) + '</div>' :
      '<p class="tg-material-vazio">Esta obra ainda não tem materiais previstos.</p>');
    return true;
  }
  return { normalizarPlano, importarLinhas, importarMatriz, associarImportacaoAoCatalogo, importarFolhaXlsx, renderizarSaldos, saldosDaObra, atualizarPainelObra, atualizarPainelOS, resumo, destinoMovimento, movimentosDaObra };
});
