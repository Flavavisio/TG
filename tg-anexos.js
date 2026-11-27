/* Referências persistentes dos anexos do Total Gest. O URL assinado é só de apresentação. */
(function (root) {
    function criar(supa, base) {
        const origem = new URL(base).origin;
        const prefixo = '/storage/v1/object/public/';
        const privados = new Set(['ficheiros', 'anexos-privados']);
        const pendentes = new Map();
        let sessao = 0;
        let utilizador = null;

        function referencia(valor) {
            if (typeof valor !== 'string' || !valor.startsWith(origem + prefixo)) return null;
            let url;
            try { url = new URL(valor); } catch { return null; }
            if (url.origin !== origem || url.search || url.hash) return null;
            if (url.href !== valor) return null;
            const separado = url.pathname.slice(prefixo.length).split('/');
            const bucket = separado.shift();
            if (!privados.has(bucket) || separado.length < 2 ||
                separado.some(segmento => !/^[A-Za-z0-9_.-]+$/.test(segmento) || segmento === '.' || segmento === '..')) return null;
            return { bucket, caminho: separado.join('/') };
        }

        async function assinar(valor) {
            const ref = referencia(valor);
            if (!ref) return valor;
            const atual = sessao;
            const { data, error } = await supa.storage.from(ref.bucket).createSignedUrl(ref.caminho, 60);
            if (sessao !== atual || error || !data?.signedUrl) throw new Error('Não foi possível abrir este anexo.');
            return data.signedUrl;
        }

        async function urlImagem(valor) {
            if (!referencia(valor)) return valor;
            let pedido = pendentes.get(valor);
            if (!pedido) {
                const tarefa = assinar(valor);
                pedido = { tarefa };
                pendentes.set(valor, pedido);
                setTimeout(() => {
                    if (pendentes.get(valor) === pedido) pendentes.delete(valor);
                }, 35000);
            }
            return pedido.tarefa;
        }

        async function descarregar(valor) {
            const ref = referencia(valor);
            if (!ref) return fetch(valor);
            const atual = sessao;
            const { data, error } = await supa.storage.from(ref.bucket).download(ref.caminho);
            if (sessao !== atual || error || !data) throw new Error('Não foi possível descarregar este anexo.');
            return new Response(data, { headers: { 'Content-Type': data.type } });
        }

        function abrir(valor, alvo) {
            const ref = referencia(valor);
            const inline = /^data:(?:image\/(?:png|jpeg|webp|gif)|application\/pdf);base64,/i.test(valor);
            if (!ref && !inline) {
                if (typeof valor === 'string' && /^https?:\/\//i.test(valor)) return window.open(valor, alvo || '_blank', 'noopener');
                window.alert('O endereço do anexo é inválido.');
                return;
            }
            const aba = window.open('', '_blank');
            if (!aba) { window.alert('Permita abrir uma nova janela para ver o anexo.'); return; }
            aba.opener = null;
            const endereco = inline
                ? fetch(valor).then(resposta => resposta.blob()).then(blob => URL.createObjectURL(blob))
                : assinar(valor);
            endereco.then(url => {
                if (!aba.closed) aba.location.replace(url);
                if (inline) setTimeout(() => URL.revokeObjectURL(url), 60000);
            }).catch(error => {
                if (!aba.closed) aba.close();
                window.alert(error.message);
            });
        }

        function instalarRevisao(documento) {
            const perfil = documento.getElementById('perfilCampos');
            if (!perfil) return () => {};
            const botao = documento.createElement('button');
            botao.type = 'button';
            botao.className = 'btn btn-outline';
            botao.hidden = true;
            perfil.after(botao);
            let painel;
            let revisaoSessao = 0;

            function fechar() {
                if (!painel) return;
                painel.close();
                painel.remove();
                painel = null;
            }

            async function listar() {
                const { data, error } = await supa.rpc('tg_ficheiros_em_revisao');
                if (error) throw new Error('Não foi possível carregar os ficheiros em revisão.');
                return (data || []).filter(item => referencia(origem + prefixo + 'ficheiros/' + item.caminho));
            }

            function desenhar(items) {
                fechar();
                painel = documento.createElement('dialog');
                painel.setAttribute('aria-labelledby', 'tg-revisao-titulo');
                painel.style.cssText = 'width:min(34rem,calc(100% - 2rem));border:1px solid #cbd5e1;border-radius:14px;padding:1.25rem;color:#152a52;';
                const titulo = documento.createElement('h3');
                titulo.id = 'tg-revisao-titulo';
                titulo.textContent = 'Ficheiros em revisão';
                const descricao = documento.createElement('p');
                descricao.textContent = 'Ficheiros recuperados para a sua empresa. Confirme o conteúdo antes de os voltar a anexar.';
                const lista = documento.createElement('ul');
                lista.style.cssText = 'display:grid;gap:0.85rem;padding-left:1.25rem;';
                const formato = new Intl.DateTimeFormat('pt-PT', { dateStyle: 'medium', timeZone: 'Europe/Lisbon' });
                const tipos = {
                    passaportes: 'Ficheiro de passaporte técnico',
                    folhasObra: 'Anexo de folha de obra',
                    obras: 'Documento de obra',
                    pedidos: 'Anexo de pedido',
                    relatoriosEspecialidade: 'Imagem de relatório de especialidade',
                    veiculoDocumentos: 'Documento de viatura'
                };
                for (const item of items) {
                    const linha = documento.createElement('li');
                    const data = new Date(item.carregado_em);
                    const etiqueta = item.tipo === 'os_fotos'
                        ? 'Fotografia de ordem de serviço' + (item.numero_os ? ' ' + item.numero_os : '')
                        : (tipos[item.tipo] || 'Ficheiro recuperado');
                    linha.append(etiqueta + (Number.isFinite(data.getTime()) ? ' · ' + formato.format(data) : ''));
                    const abrirFicheiro = documento.createElement('button');
                    abrirFicheiro.type = 'button';
                    abrirFicheiro.className = 'btn btn-outline';
                    abrirFicheiro.style.marginLeft = '0.5rem';
                    abrirFicheiro.textContent = 'Abrir ficheiro';
                    abrirFicheiro.setAttribute('aria-label', 'Abrir ' + etiqueta);
                    abrirFicheiro.onclick = () => abrir(origem + prefixo + 'ficheiros/' + item.caminho, '_blank');
                    linha.append(abrirFicheiro);
                    lista.append(linha);
                }
                const fecharBotao = documento.createElement('button');
                fecharBotao.type = 'button';
                fecharBotao.className = 'btn btn-outline';
                fecharBotao.textContent = 'Fechar';
                fecharBotao.onclick = fechar;
                painel.append(titulo, descricao, lista, fecharBotao);
                painel.addEventListener('close', () => {
                    if (!painel || painel.open) return;
                    painel.remove();
                    painel = null;
                });
                documento.body.append(painel);
                painel.showModal();
            }

            botao.onclick = async () => {
                const atual = revisaoSessao;
                try {
                    const items = await listar();
                    if (atual !== revisaoSessao) return;
                    if (items.length) desenhar(items);
                    else { botao.hidden = true; window.alert('Já não há ficheiros disponíveis para revisão.'); }
                } catch (error) {
                    if (atual === revisaoSessao) window.alert(error.message);
                }
            };

            return id => {
                const atual = ++revisaoSessao;
                fechar();
                botao.hidden = true;
                if (!id) return;
                // Supabase auth listeners must finish before a new request uses the client.
                setTimeout(async () => {
                    try {
                        const items = await listar();
                        if (atual !== revisaoSessao || !items.length) return;
                        botao.textContent = 'Ficheiros em revisão (' + items.length + ')';
                        botao.hidden = false;
                    } catch (_) {}
                }, 0);
            };
        }

        function instalar(documento) {
            const atualizarRevisao = instalarRevisao(documento);
            const elementos = new WeakMap();
            const seletor = 'a[href], img[src]';
            function atualizar(el) {
                const attr = el.tagName === 'A' ? 'href' : 'src';
                const valor = el.getAttribute(attr);
                const estado = elementos.get(el);
                if (estado?.apresentacao === valor) return;
                if (!referencia(valor)) { elementos.delete(el); return; }
                // Don't leave the original reusable URL in the visible anchor.
                const novo = { valor, apresentacao: attr === 'href' ? '#' : '' };
                elementos.set(el, novo);
                el.setAttribute(attr, novo.apresentacao);
                if (attr === 'src') urlImagem(valor).then(url => {
                    if (elementos.get(el) !== novo) return;
                    novo.apresentacao = url;
                    el.setAttribute(attr, url);
                }).catch(() => {});
            }
            function processar(no) {
                if (no?.matches?.(seletor)) atualizar(no);
                no?.querySelectorAll?.(seletor).forEach(atualizar);
            }
            const observer = new MutationObserver(mudancas => mudancas.forEach(m => {
                if (m.type === 'attributes' && m.target.matches(seletor)) atualizar(m.target);
                else m.addedNodes.forEach(processar);
            }));
            observer.observe(documento.documentElement, {
                subtree: true, childList: true, attributes: true, attributeFilter: ['href', 'src']
            });
            processar(documento);

            function clique(evento) {
                const link = evento.target.closest?.('a[href]');
                if (!link || evento.button === 2) return;
                const original = elementos.get(link)?.valor || link.getAttribute('href');
                if (!referencia(original)) return;
                evento.preventDefault();
                if (!link.hasAttribute('download')) { abrir(original, '_blank'); return; }
                descarregar(original).then(resposta => resposta.blob()).then(blob => {
                    const url = URL.createObjectURL(blob);
                    const descarga = documento.createElement('a');
                    descarga.href = url;
                    descarga.download = link.getAttribute('download') || referencia(original).caminho.split('/').pop();
                    documento.body.appendChild(descarga);
                    descarga.click();
                    descarga.remove();
                    setTimeout(() => URL.revokeObjectURL(url), 4000);
                }).catch(error => window.alert(error.message));
            }
            documento.addEventListener('click', clique, true);
            documento.addEventListener('auxclick', clique, true);
            supa.auth.onAuthStateChange((evento, estado) => {
                if (!['INITIAL_SESSION', 'SIGNED_OUT', 'SIGNED_IN', 'USER_UPDATED'].includes(evento)) return;
                const id = estado?.user?.id || null;
                if (id === utilizador) return;
                const anterior = utilizador;
                utilizador = id;
                atualizarRevisao(id);
                sessao++;
                pendentes.clear();
                if (anterior) documento.querySelectorAll('img[src]').forEach(img => {
                    if (!elementos.has(img)) return;
                    elementos.delete(img);
                    img.removeAttribute('src');
                });
            });
        }

        return { referencia, assinar, urlImagem, descarregar, abrir, instalar };
    }

    if (typeof module === 'object' && module.exports) module.exports = { criar };
    else root.TGAnexos = { criar };
})(globalThis);
