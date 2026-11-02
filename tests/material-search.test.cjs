const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');
const source = fs.readFileSync('app-principal.js', 'utf8');
const fn = name => source.match(new RegExp('        function ' + name + '\\([^]*?\\n        \\}'))[0];
const article = { id: 'existing', adminId: 'a', nome: 'Controlo de acesso autónomo facial', referencia: 'SF-AC124-FR-WIFI', marca: 'Safire', categoria: 'Controlo de acessos', unidade: 'un' };
const flows = [
  ['veros', '_verOsArtigosDisponiveisCache', '_verOsFiltrarArtigos', '_verOsEscolherArtigoBusca'],
  ['fo', '_foArtigosDisponiveisCache', '_foFiltrarArtigos', '_foEscolherArtigoBusca'],
  ['folhaobrig', '_folhaObrigArtigosDisponiveisCache', '_folhaObrigFiltrarArtigos', '_folhaObrigEscolherArtigoBusca'],
  ['qsa', '_qsaArtigosCache', '_quiosqueAgendaFiltrarArtigos', '_quiosqueAgendaEscolherArtigo']
];
function setup(prefix, cache, filter, choose) {
  const w = new JSDOM(`<input id="${prefix}_busca_artigo"><input id="${prefix}_artigo_escolhido_id"><div id="${prefix}_resultados_artigos"></div><div id="${prefix}_novo_artigo_campos"></div>`, { runScripts: 'outside-only' }).window;
  w[cache] = [{ id: 'empty', nome: '', referencia: null }, article];
  w.eval(['escapeHtmlSimples', '_artigoCorrespondePesquisa', filter, choose].map(fn).join('\n'));
  return w;
}
for (const [prefix, cache, filter, choose] of flows) {
  test(`${prefix}: full and partial reference, name, brand and category find the existing article`, () => {
    const w = setup(prefix, cache, filter, choose);
    try {
      const input = w.document.getElementById(prefix + '_busca_artigo');
      const results = w.document.getElementById(prefix + '_resultados_artigos');
      for (const query of ['SF-AC124-FR-WIFI', '  sf-ac124-fr-wifi  ', 'AC124', 'facial', 'SAFIRE', 'acessos']) {
        input.value = query;
        w[filter]();
        assert.equal(results.children.length, 1);
        assert.match(results.textContent, /SF-AC124-FR-WIFI/);
        assert.match(results.textContent, /Controlo de acesso/);
        assert.equal(results.querySelector('strong').textContent, article.referencia);
        assert.match(results.firstChild.getAttribute('onmousedown'), /existing/);
      }
      w[choose](article.id, article.nome);
      assert.equal(input.value, article.nome);
      assert.equal(prefix === 'qsa' ? input.dataset.id : w.document.getElementById(prefix + '_artigo_escolhido_id').value, article.id);
      assert.equal(results.style.display, 'none');
      input.value = 'unknown-reference'; w[filter]();
      assert.match(results.textContent, /Nenhum/);
    } finally { w.close(); }
  });
  test(`${prefix}: suggestions escape references and retain the eight-result limit`, () => {
    const w = setup(prefix, cache, filter, choose);
    try {
      w[cache] = Array.from({ length: 12 }, (_, i) => ({ ...article, id: String(i), referencia: '<img src=x onerror=alert(1)>' }));
      w.document.getElementById(prefix + '_busca_artigo').value = '<img';
      w[filter]();
      const results = w.document.getElementById(prefix + '_resultados_artigos');
      assert.equal(results.children.length, 8);
      assert.equal(results.querySelector('img'), null);
      assert.match(results.textContent, /<img src=x/);
    } finally { w.close(); }
  });
}
test('OS reference selection registers consumption against the existing article and preserves tenant scope', () => {
  const w = setup(...flows[0]);
  try {
    w.document.body.insertAdjacentHTML('beforeend', '<div id="verOsConteudo"></div>');
    w.usuarioLogado = { id: 'a', role: 'admin' };
    w.dados = { servicos: [{ id: 'os', adminId: 'a' }], artigos: [article, { ...article, id: 'foreign', adminId: 'b' }], folhasObra: [], movimentosStock: [] };
    Object.assign(w, { gerarId: () => 'movement', getDataHoje: () => '2026-11-02', _armazemPrincipalId: () => 'warehouse', guardarDados: () => {} });
    w.eval(['_verOsMostrar', '_verOsAdicionarMaterial'].map(fn).join('\n'));
    w._verOsMostrar('os', 'materiais');
    assert.deepEqual(Array.from(w._verOsArtigosDisponiveisCache, a => a.id), ['existing']);
    w.document.getElementById('veros_busca_artigo').value = article.referencia;
    w._verOsFiltrarArtigos();
    w._verOsEscolherArtigoBusca(article.id, article.nome);
    w.document.getElementById('veros_novo_qtd').value = '2';
    w._verOsAdicionarMaterial('os');
    assert.equal(w.dados.artigos.length, 2, 'no duplicate article is created');
    assert.equal(w.dados.movimentosStock.length, 1);
    assert.equal(w.dados.movimentosStock[0].artigoId, 'existing');
    assert.equal(w.dados.movimentosStock[0].quantidade, 2);
    assert.equal(w.dados.movimentosStock[0].origemId, 'os');
    assert.equal(w.dados.movimentosStock[0].adminId, 'a');
  } finally { w.close(); }
});
