
function tgCalcularPoupanca(){
    var func = parseFloat(document.getElementById('tgc_func').value) || 0;
    var horas = parseFloat(document.getElementById('tgc_horas').value) || 0;
    var custo = parseFloat(document.getElementById('tgc_custo').value) || 0;
    document.getElementById('tgc_horas_val').textContent = horas.toLocaleString('pt-PT');
    // Semanas úteis por mês ~4.33; considera-se que centralizar tudo numa plataforma só
    // recupera cerca de 70% dessas horas perdidas (o resto continua a ser trabalho real de terreno).
    var horasRecuperadasMes = func * horas * 4.33 * 0.7;
    var poupancaMes = horasRecuperadasMes * custo;
    var poupancaAno = poupancaMes * 12;
    document.getElementById('tgc_resultado_mes').textContent = poupancaMes.toLocaleString('pt-PT', {maximumFractionDigits:0}) + ' €/mês';
    document.getElementById('tgc_resultado_ano').textContent = '≈ ' + poupancaAno.toLocaleString('pt-PT', {maximumFractionDigits:0}) + ' € por ano';
    var escaloes = [[5,29.99],[10,34.99],[25,39.99],[50,59.99],[100,89.99]];
    var plano = escaloes[escaloes.length-1];
    for (var i=0;i<escaloes.length;i++){ if (func <= escaloes[i][0]) { plano = escaloes[i]; break; } }
    var planoEl = document.getElementById('tgc_plano_sugerido');
    if (planoEl) {
        planoEl.innerHTML = 'Para ' + func + ' pessoa' + (func===1?'':'s') + ', o plano de ' + plano[0] + ' funcionários fica em <b>' + plano[1].toFixed(2).replace('.',',') + ' €/mês</b> — a poupança estimada cobre isso ' + (poupancaMes>0 ? (poupancaMes/plano[1]).toFixed(1).replace('.',',') : '0') + 'x.';
    }
}
document.addEventListener('DOMContentLoaded', function(){ if (document.getElementById('tgc_func')) tgCalcularPoupanca(); });
if (document.getElementById('tgc_func')) tgCalcularPoupanca();
function atualizarLanding(){var l=document.getElementById('tg-landing');if(l)l.style.display=(typeof usuarioLogado!=='undefined'&&usuarioLogado)?'none':'block';}
async function loginLanding(e){e.preventDefault();var em=document.getElementById('landEmail').value;var pw=document.getElementById('landSenha').value;document.getElementById('loginEmail').value=em;document.getElementById('loginSenha').value=pw;return login(e);}

// Poupa espaço no ficheiro: o logo só está gravado uma vez (no cabeçalho);
// aqui é copiado para os outros sítios onde aparece (rodapé, sidebar, formulário de signup).
(function () {
    const master = document.getElementById('tg-logo-master');
    if (!master) return;
    function clonarLogo() {
        const src = master.src;
        document.querySelectorAll('.tg-logo-clone').forEach(img => { img.src = src; });
    }
    if (master.complete) clonarLogo(); else master.addEventListener('load', clonarLogo, { once: true });
})();

function abrirDetalheAddon(el) {
    const nome = el.querySelector('h3')?.childNodes[0]?.textContent?.trim() || el.querySelector('h3')?.textContent?.trim() || '';
    const desc = el.querySelector('p')?.textContent?.trim() || '';
    const icHtml = el.querySelector('.ic svg')?.outerHTML || '';
    const elPreco = el.querySelector('.pa .m');
    const precoM = elPreco?.getAttribute('data-m') || elPreco?.textContent?.trim() || '';
    const precoA = elPreco?.getAttribute('data-a') || '';
    document.getElementById('tg-addon-ic').innerHTML = icHtml;
    document.getElementById('tg-addon-nome').textContent = nome;
    document.getElementById('tg-addon-desc').textContent = desc;
    document.getElementById('tg-addon-precos').innerHTML = `
        <div><div class="lbl">Mensal</div><div class="val">${precoM}</div></div>
        <div><div class="lbl">Anual (-10%)</div><div class="val">${precoA}</div></div>
    `;
    document.getElementById('tg-addon-overlay').classList.add('open');
}
function fecharDetalheAddon() {
    document.getElementById('tg-addon-overlay').classList.remove('open');
}
// ===== Wizard: Calcule o seu sistema =====
const TCW_ADDONS = {
    frota:     { nome: 'Frota',                              m: 9.99,  a: 107.89 },
    contratos: { nome: 'Contratos de Manutenção / SCIE',      m: 14.99, a: 161.89 },
    armazem:   { nome: 'Obras / Stock / Armazém',             m: 9.99,  a: 107.89 },
    crm:       { nome: 'CRM Comercial + Assist',              m: 19.99, a: 215.89 },
    erp:       { nome: 'Integração com ERP (Moloni)',         m: 29.99, a: 323.89 },
};
// Os escalões da calculadora pública usam sempre o mesmo PLANOS que gera as licenças a sério
// (definido mais acima, na parte da app) — nunca valores escritos aqui à parte, para nunca
// ficarem dessincronizados se o preço de um plano mudar.
const TCW_ESCALOES = [5, 10, 25, 50, 100].map(n => [n, PLANOS['30_' + n].preco]);
let _tcwPasso = 1;
function abrirWizardCalc() {
    _tgRegistarEvento('wizard_calc_abrir', null);
    _tcwPasso = 1;
    // Os preços mostrados nos cartões vêm sempre do PLANOS (a mesma fonte que gera as
    // licenças a sério) — nunca escritos à parte no HTML, para nunca desalinhar.
    document.querySelectorAll('#tcw-func-chips [data-preco-de]').forEach(el => {
        const chave = el.getAttribute('data-preco-de');
        const preco = PLANOS[chave]?.preco;
        el.textContent = preco != null ? preco.toFixed(2).replace('.', ',') + ' €/mês' : '—';
    });
    document.querySelectorAll('.tcw-passo').forEach((el, i) => el.style.display = i === 0 ? '' : 'none');
    _tcwRenderCabecalho();
    document.getElementById('tg-calc-wizard-overlay').classList.add('open');
    document.body.style.overflow = 'hidden';
}
function fecharWizardCalc() {
    document.getElementById('tg-calc-wizard-overlay').classList.remove('open');
    document.body.style.overflow = '';
}
function _tcwSyncFuncInput() {
    document.querySelectorAll('#tcw-func-chips button').forEach(b => b.classList.remove('on'));
}
document.addEventListener('click', e => {
    const chip = e.target.closest('#tcw-func-chips button');
    if (!chip) return;
    document.querySelectorAll('#tcw-func-chips button').forEach(b => b.classList.remove('on'));
    chip.classList.add('on');
    document.getElementById('tcw_func').value = chip.dataset.v;
});
const TCW_TITULOS = [
    'Quantos funcionários tem a sua equipa?',
    'Que necessidades tem?',
    'Quanto tempo perde hoje com papéis e WhatsApp?',
    'O resultado',
];
function _tcwRenderCabecalho() {
    document.getElementById('tcw-titulo-passo').textContent = TCW_TITULOS[_tcwPasso - 1];
    document.getElementById('tcw-progress-fill').style.width = ((_tcwPasso / 4) * 100) + '%';
    document.getElementById('tcw-btn-voltar').style.visibility = _tcwPasso === 1 ? 'hidden' : 'visible';
    document.getElementById('tcw-btn-seguinte').style.display = _tcwPasso === 4 ? 'none' : 'inline-flex';
}
function _tcwSeguinte() {
    if (_tcwPasso === 1) {
        const v = parseFloat(document.getElementById('tcw_func').value) || 0;
        if (v < 1) { alert('Indica quantos funcionários tem, pelo menos 1.'); return; }
        const perdemEl = document.getElementById('tcw_func_perdem');
        if (perdemEl) perdemEl.value = v; // valor por omissão, o utilizador pode ajustar no passo 3
    }
    document.getElementById('tcw-passo-' + _tcwPasso).style.display = 'none';
    _tcwPasso++;
    if (_tcwPasso === 4) { _tcwCalcularResultado(); _tgRegistarEvento('wizard_calc_resultado', Array.from(document.querySelectorAll('.tcw-addon input:checked')).map(c => c.value).join(',') || 'sem_addons'); }
    else _tgRegistarEvento('wizard_calc_passo', 'passo_' + _tcwPasso);
    document.getElementById('tcw-passo-' + _tcwPasso).style.display = '';
    _tcwRenderCabecalho();
}
function _tcwVoltar() {
    if (_tcwPasso === 1) return;
    document.getElementById('tcw-passo-' + _tcwPasso).style.display = 'none';
    _tcwPasso--;
    document.getElementById('tcw-passo-' + _tcwPasso).style.display = '';
    _tcwRenderCabecalho();
}
function _tcwCalcularResultado() {
    const func = parseFloat(document.getElementById('tcw_func').value) || 1;
    const horas = parseFloat(document.getElementById('tcw_horas').value) || 0;
    const funcPerdem = parseFloat(document.getElementById('tcw_func_perdem').value) || 0;
    const custo = parseFloat(document.getElementById('tcw_custo').value) || 0;
    const addonsEscolhidos = Array.from(document.querySelectorAll('.tcw-addon input:checked')).map(c => c.value);

    let plano = TCW_ESCALOES[TCW_ESCALOES.length - 1];
    for (const e of TCW_ESCALOES) { if (func <= e[0]) { plano = e; break; } }
    const precoBase = plano[1];
    const precoAddons = addonsEscolhidos.reduce((s, k) => s + TCW_ADDONS[k].m, 0);
    const precoTotalGest = precoBase + precoAddons;

    // Mesma fórmula da calculadora da secção de Preços: recupera-se ~70% das horas perdidas.
    const horasRecuperadasMes = funcPerdem * horas * 4.33 * 0.7;
    const custoPerdaMes = horasRecuperadasMes * custo;
    const poupancaLiquida = custoPerdaMes - precoTotalGest;

    const listaAddons = addonsEscolhidos.length
        ? '<ul class="tcw-lista-addons">' + addonsEscolhidos.map(k => `<li>${TCW_ADDONS[k].nome} — ${TCW_ADDONS[k].m.toFixed(2).replace('.', ',')} €/mês</li>`).join('') + '</ul>'
        : '<p class="tcw-sub" style="margin:0;">Nenhum add-on selecionado — só a Licença Base.</p>';

    document.getElementById('tcw-resultado-conteudo').innerHTML = `
        <div class="tcw-result-linha"><span>Está a perder hoje, em tempo administrativo</span><b class="neg">${custoPerdaMes.toLocaleString('pt-PT', { maximumFractionDigits: 0 })} €/mês</b></div>
        <div class="tcw-result-linha"><span>Total Gest para ${func} funcionário${func === 1 ? '' : 's'} (Licença Base + add-ons)</span><b>${precoTotalGest.toLocaleString('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €/mês</b></div>
        ${listaAddons}
        <div class="tcw-result-final ${poupancaLiquida >= 0 ? 'pos' : 'neg'}">
            ${poupancaLiquida >= 0
                ? `Mesmo a pagar a Total Gest, fica com <b>${poupancaLiquida.toLocaleString('pt-PT', { maximumFractionDigits: 0 })} € a mais no bolso, por mês</b> — cerca de <b>${(poupancaLiquida * 12).toLocaleString('pt-PT', { maximumFractionDigits: 0 })} € por ano</b>.`
                : `Com os números indicados, o custo da plataforma fica perto da poupança administrativa — a poupança real tende a ser maior, porque isto não conta menos deslocações a mais nem menos erros de faturação.`}
        </div>
        <a class="btn btn-orange" href="#" style="width:100%;justify-content:center;margin-top:16px;" onclick="_tgRegistarEvento('clique_cta','wizard_calc');fecharWizardCalc();abrirModalSignup();return false;">Começar 14 dias grátis <span style="margin-left:4px;">→</span></a>
    `;
}
// Planos e add-ons mostrados no checkout — os preços têm de bater sempre certo com os cartões
// da página e com os add-ons lá em baixo (PRECO_CRM_MENSAL etc., em app-principal.js); como esta
// página não carrega app-principal.js, os valores ficam também aqui, à mão.
const SU_PLANOS = {
    '5': { nome: '5 funcionários', valor: 29.99 },
    '10': { nome: '10 funcionários', valor: 34.99 },
    '25': { nome: '25 funcionários', valor: 49.99 },
    '50': { nome: '50 funcionários', valor: 89.99 },
    '100': { nome: '100 funcionários', valor: 179.90 },
};
const SU_ADDONS = [
    { key: 'frota', label: 'Frota', valor: 9.99 },
    { key: 'contratos', label: 'Contratos de Manutenção', valor: 14.99 },
    { key: 'armazem', label: 'Armazém / Stock', valor: 9.99 },
    { key: 'crm', label: 'CRM Comercial', valor: 9.99 },
    { key: 'assist', label: 'Total Gest Assist', valor: 9.99 },
];
function _suFormatarEuro(v) { return v.toLocaleString('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'; }
let _suPlanoSelecionado = null;
function abrirModalSignup(planoChave) {
    _suPlanoSelecionado = planoChave && SU_PLANOS[planoChave] ? planoChave : null;
    const resumo = document.getElementById('su_plano_resumo');
    const wrapColab = document.getElementById('su_colaboradores_wrap');
    const inputColab = document.getElementById('su_colaboradores');
    if (_suPlanoSelecionado) {
        const p = SU_PLANOS[_suPlanoSelecionado];
        document.getElementById('su_plano_nome').textContent = p.nome;
        resumo.style.display = 'flex';
        // O plano já diz quantos colaboradores é — o campo de texto livre fica escondido, e
        // continua preenchido por trás com o mesmo valor, para não faltar nada ao validar/enviar.
        inputColab.value = p.nome;
        wrapColab.style.display = 'none';
        inputColab.required = false;
    } else {
        resumo.style.display = 'none';
        wrapColab.style.display = '';
        inputColab.required = true;
        inputColab.value = '';
    }
    const lista = document.getElementById('su_addons_lista');
    document.getElementById('su_addons_label').innerHTML = _suPlanoSelecionado
        ? 'Quer já juntar algum add-on? <span style="font-weight:400;color:#5a6781;">(soma ao valor mensal acima — dá sempre para adicionar mais tarde)</span>'
        : 'Quer testar também algum destes add-ons? <span style="font-weight:400;color:#5a6781;">(incluídos sem custo durante os 14 dias — decide só no fim se quer manter)</span>';
    // Com um plano escolhido (veio de um cartão de preço) é uma compra a sério — mostra o preço
    // real de cada add-on, e cada vez que se marca/desmarca soma logo ao total ali em cima. Sem
    // plano (veio do CTA genérico "14 dias grátis"), é só para experimentar — mostra "Grátis no
    // teste" em vez de preço, porque durante o trial fica tudo incluído sem custo nenhum.
    lista.innerHTML = SU_ADDONS.map(a => `
        <label style="display:flex;align-items:center;gap:8px;font-size:.82rem;font-weight:400;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:8px 10px;cursor:pointer;">
            <input type="checkbox" value="${a.key}" style="width:auto;margin:0;" onchange="_suAtualizarTotal()" />
            <span style="flex:1;">${a.label}</span>
            <span style="${_suPlanoSelecionado ? 'color:#5a6781;' : 'color:#16a34a;font-weight:600;'}font-size:.72rem;white-space:nowrap;">${_suPlanoSelecionado ? '+ ' + _suFormatarEuro(a.valor) + '/mês' : 'Grátis no teste'}</span>
        </label>
    `).join('');
    _suAtualizarTotal();
    document.getElementById('tg-signup-overlay').classList.add('open');
    document.body.style.overflow = 'hidden';
}
// Recalcula e mostra o preço total (plano + add-ons marcados) — só quando há um plano escolhido
// a sério (veio de um cartão de preço). No CTA genérico do trial não há total nenhum a mostrar,
// está tudo grátis durante o teste.
function _suAtualizarTotal() {
    const preco = document.getElementById('su_plano_preco');
    const detalhe = document.getElementById('su_plano_detalhe');
    if (!_suPlanoSelecionado) { preco.textContent = ''; detalhe.textContent = ''; return; }
    const base = SU_PLANOS[_suPlanoSelecionado].valor;
    const marcados = [...document.querySelectorAll('#su_addons_lista input:checked')].map(v => SU_ADDONS.find(a => a.key === v.value));
    const totalAddons = marcados.reduce((s, a) => s + a.valor, 0);
    preco.textContent = _suFormatarEuro(base + totalAddons) + '/mês';
    detalhe.textContent = marcados.length ? `${_suFormatarEuro(base)} plano + ${marcados.length} add-on${marcados.length > 1 ? 's' : ''}` : '';
}
// "mudar" no resumo do plano — volta ao campo de texto livre, para quem afinal quer escrever um
// número diferente do cartão em que clicou (ex.: "6-8", não bate certo com nenhum dos 5 planos).
function _suMudarPlano() {
    _suPlanoSelecionado = null;
    document.getElementById('su_plano_resumo').style.display = 'none';
    document.getElementById('su_colaboradores_wrap').style.display = '';
    const inputColab = document.getElementById('su_colaboradores');
    inputColab.required = true;
    inputColab.value = '';
    inputColab.focus();
}
function fecharModalSignup() {
    document.getElementById('tg-signup-overlay').classList.remove('open');
    document.body.style.overflow = '';
}
function _suAlternarOlho(idCampo, btn) {
    const campo = document.getElementById(idCampo);
    const icone = btn.querySelector('i');
    if (campo.type === 'password') { campo.type = 'text'; icone.className = 'fas fa-eye-slash'; }
    else { campo.type = 'password'; icone.className = 'fas fa-eye'; }
}
function _suSenhaValida(senha) {
    return senha.length >= 9 && /[A-Z]/.test(senha) && /[^A-Za-z0-9]/.test(senha);
}
function _suValidarSenha() {
    const s1 = document.getElementById('su_senha').value;
    const s2 = document.getElementById('su_senha2').value;
    const msg = document.getElementById('su_senha_msg');
    if (!s1) { msg.textContent = ''; return; }
    if (!_suSenhaValida(s1)) {
        msg.textContent = 'Precisa de pelo menos 9 caracteres, 1 maiúscula e 1 símbolo (ex: ! @ # $ %).';
        msg.style.color = '#dc2626';
        return;
    }
    if (s2 && s1 !== s2) {
        msg.textContent = 'As palavras-passe não coincidem.';
        msg.style.color = '#dc2626';
        return;
    }
    msg.textContent = s2 ? '✓ Palavra-passe válida.' : 'Palavra-passe válida — confirme-a abaixo.';
    msg.style.color = '#16a34a';
}

async function submeterSignup(e) {
    e.preventDefault();
    const btn = document.getElementById('su_btn');
    const addonsEscolhidos = [...document.querySelectorAll('#su_addons_lista input:checked')].map(c => c.value);
    const dadosPedido = {
        empresa: document.getElementById('su_empresa').value.trim(),
        nome: document.getElementById('su_nome').value.trim(),
        email: document.getElementById('su_email').value.trim().toLowerCase(),
        telefone: document.getElementById('su_telefone').value.trim(),
        colaboradores: document.getElementById('su_colaboradores').value.trim() || null,
        nif: document.getElementById('su_nif').value.trim() || null,
        senha: document.getElementById('su_senha').value,
        plano: _suPlanoSelecionado || null,
        addons: addonsEscolhidos,
    };
    const senha2 = document.getElementById('su_senha2').value;
    if (!dadosPedido.empresa || !dadosPedido.nome || !dadosPedido.email || !dadosPedido.telefone || !dadosPedido.colaboradores || !dadosPedido.nif) {
        alert('Por favor preencha todos os campos — são todos obrigatórios.');
        return false;
    }
    if (!_suSenhaValida(dadosPedido.senha)) {
        alert('A palavra-passe precisa de pelo menos 9 caracteres, 1 maiúscula e 1 símbolo (ex: ! @ # $ %).');
        return false;
    }
    if (dadosPedido.senha !== senha2) {
        alert('As palavras-passe não coincidem.');
        return false;
    }
    btn.disabled = true;
    btn.textContent = 'A processar…';
    try {
        const { data, error } = await supa.functions.invoke('criar_pedido_trial', { body: dadosPedido });
        if (error) {
            // o supabase-js só dá uma mensagem genérica no "error.message";
            // a mensagem real que a função devolveu vem no corpo da resposta (error.context)
            let mensagemReal = '';
            try {
                if (error.context && typeof error.context.json === 'function') {
                    const corpo = await error.context.json();
                    mensagemReal = corpo?.erro || '';
                }
            } catch (e2) { /* ignora, usa mensagem genérica abaixo */ }
            throw new Error(mensagemReal || 'Não foi possível enviar o pedido. Tente novamente ou contacte-nos por WhatsApp.');
        }
        if (!data || data.erro) throw new Error(data?.erro || 'Falha ao criar o pedido.');
        const token = data.token;
        _tgRegistarEvento('signup', dadosPedido.empresa);
        _tgIdentificarVisitante(dadosPedido.nome, dadosPedido.email);
        document.getElementById('tg-signup-body').innerHTML = `
            <div class="signup-msg">
                <i class="fas fa-envelope-circle-check"></i>
                <h2>Confirme o seu email</h2>
                <p class="signup-sub">Enviámos um link de confirmação para <b>${dadosPedido.email}</b>.<br>A sua conta de teste (14 dias) fica ativa assim que confirmar.</p>
            </div>`;
    } catch (err) {
        console.error('signup trial:', err);
        alert(err && err.message ? err.message : 'Não foi possível enviar o pedido. Tente novamente ou contacte-nos por WhatsApp.');
        btn.disabled = false;
        btn.textContent = 'Ativar Conta Agora';
    }
    return false;
}
// ===================== Analytics da página pública (visitas + conversões) =====================
// Só corre uma vez por sessão do browser (sessionStorage) — não regista cliques dentro da app já
// autenticada, só a página de marketing pública, antes do login. Falha em silêncio se a Edge
// Function não estiver disponível — nunca deve travar a página por causa disto.
let _tgVisitaId = null;
function _tgSessaoId() {
    let s = sessionStorage.getItem('tg_sessao_analytics');
    if (!s) { s = gerarId() + gerarId(); sessionStorage.setItem('tg_sessao_analytics', s); }
    return s;
}
// Ao contrário do sessao_id (reinicia a cada aba/sessão nova), este fica gravado no telemóvel/PC
// entre visitas diferentes — é o que permite saber se alguém é "novo" ou "já cá esteve".
function _tgVisitanteId() {
    let v = localStorage.getItem('tg_visitante_analytics');
    if (!v) { v = gerarId() + gerarId(); localStorage.setItem('tg_visitante_analytics', v); }
    return v;
}
// Lê utm_source/utm_medium/utm_campaign da própria URL, se vierem lá (ex: de um anúncio ou
// campanha de email) — funciona mesmo que o link não tenha esses parâmetros, fica tudo a null.
function _tgLerUTM() {
    const params = new URLSearchParams(location.search);
    return {
        utmSource: params.get('utm_source') || null,
        utmMedium: params.get('utm_medium') || null,
        utmCampaign: params.get('utm_campaign') || null,
    };
}
async function _tgRegistarVisita() {
    try {
        const utm = _tgLerUTM();
        const { data } = await supa.functions.invoke('registar-visita', {
            body: {
                acao: 'visita',
                sessaoId: _tgSessaoId(),
                visitanteId: _tgVisitanteId(),
                paginaAtual: location.pathname + location.search,
                referrer: document.referrer || null,
                dispositivo: /Mobi|Android|iPhone/i.test(navigator.userAgent) ? 'mobile' : 'desktop',
                resolucaoEcra: window.screen ? `${window.screen.width}x${window.screen.height}` : null,
                utmSource: utm.utmSource,
                utmMedium: utm.utmMedium,
                utmCampaign: utm.utmCampaign
            }
        });
        if (data?.visitaId) _tgVisitaId = data.visitaId;
    } catch (e) { /* silencioso — analytics nunca deve travar a página pública */ }
}
function _tgRegistarEvento(tipo, detalhe) {
    try {
        supa.functions.invoke('registar-visita', { body: { acao: 'evento', tipo, detalhe: detalhe || null, sessaoId: _tgSessaoId(), visitaId: _tgVisitaId } }).catch(() => {});
    } catch (e) { /* silencioso */ }
}
// Só é chamada quando a própria pessoa se identifica (ex: preenche o formulário de signup) —
// nunca tenta adivinhar quem é a partir do dispositivo.
function _tgIdentificarVisitante(nome, email) {
    try {
        supa.functions.invoke('registar-visita', { body: { acao: 'identificar', sessaoId: _tgSessaoId(), visitaId: _tgVisitaId, nome: nome || null, email: email || null } }).catch(() => {});
    } catch (e) { /* silencioso */ }
}
// Duração da visita e profundidade de scroll — o que interessa aqui não é a cada X segundos, é
// o valor MÁXIMO ao longo de toda a visita (scroll pode subir e descer; duração só cresce).
// Manda pelo sendBeacon ao sair, porque nessa altura a página pode fechar a qualquer instante —
// um fetch normal arriscava-se a nunca chegar a partir.
let _tgInicioVisita = Date.now();
let _tgScrollMaximo = 0;
function _tgAtualizarScrollMaximo() {
    const doc = document.documentElement;
    const alturaTotal = doc.scrollHeight - doc.clientHeight;
    if (alturaTotal <= 0) { _tgScrollMaximo = 100; return; }
    const pct = Math.round(Math.min(100, (window.scrollY / alturaTotal) * 100));
    if (pct > _tgScrollMaximo) _tgScrollMaximo = pct;
}
function _tgEnviarDuracaoFinal() {
    try {
        if (!_tgVisitaId) return; // visita nem chegou a ficar registada, nada a atualizar
        const duracaoSegundos = Math.round((Date.now() - _tgInicioVisita) / 1000);
        const payload = JSON.stringify({ acao: 'duracao', sessaoId: _tgSessaoId(), visitaId: _tgVisitaId, duracaoSegundos, scrollMaximoPct: _tgScrollMaximo });
        const url = `${SUPABASE_URL}/functions/v1/registar-visita`;
        // Nota: usa fetch(keepalive) em vez de sendBeacon — o sendBeacon não deixa mandar
        // cabeçalhos, e esta função (como todas as outras chamadas à Supabase) precisa da apikey
        // para aceitar o pedido. O keepalive garante o mesmo comportamento essencial do beacon:
        // o pedido continua a ser enviado mesmo que a página feche logo a seguir.
        fetch(url, {
            method: 'POST',
            keepalive: true,
            headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON_KEY, 'Authorization': 'Bearer ' + SUPABASE_ANON_KEY },
            body: payload,
        }).catch(() => {});
    } catch (e) { /* silencioso */ }
}
window.addEventListener('scroll', _tgAtualizarScrollMaximo, { passive: true });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') _tgEnviarDuracaoFinal(); });
window.addEventListener('pagehide', _tgEnviarDuracaoFinal);
if (document.getElementById('tg-landing')) {
    // O elemento "tg-landing" existe sempre no HTML (só fica escondido por CSS depois do login),
    // por isso não chega para saber se é mesmo um visitante novo — confirma com a sessão real do
    // Supabase antes de contar a visita, para não contar utilizadores já autenticados a recarregar a página.
    supa.auth.getSession().then(({ data }) => { if (!data.session) _tgRegistarVisita(); }).catch(() => {});
}
(function(){var grp=document.getElementById('tg-billing');if(grp){grp.addEventListener('click',function(e){var b=e.target.closest('button');if(!b)return;grp.querySelectorAll('button').forEach(function(x){x.classList.remove('on');});b.classList.add('on');var mode=b.dataset.mode;document.querySelectorAll('#tg-landing [data-m][data-a]').forEach(function(el){var v=mode==='anual'?el.dataset.a:el.dataset.m;el.textContent=(v&&v.length)?v:'\u00A0';});});}var ano=document.getElementById('tg-ano');if(ano)ano.textContent=new Date().getFullYear();atualizarLanding();})();
