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

            function criarBotao(texto, acao, classe = 'btn btn-outline') {
                const botao = documento.createElement('button');
                botao.type = 'button';
                botao.className = classe;
                botao.textContent = texto;
                botao.onclick = acao;
                return botao;
            }

            const atalho = criarBotao('Ficheiros em revisão');
            atalho.hidden = true;
            perfil.after(atalho);
            const revisao = { pendente: 'Por rever', validado: 'Validados', arquivado: 'Arquivo' };
            const triagem = { pendente: 'Por atribuir', duplicado: 'Duplicados', arquivado: 'Arquivo', encaminhado: 'Encaminhados' };
            const tipos = {
                'contratos-documentos': 'Documento de contrato',
                encomendas: 'Anexo de encomenda',
                passaportes: 'Ficheiro de passaporte técnico',
                folhasObra: 'Anexo de folha de obra',
                obras: 'Documento de obra',
                pedidos: 'Anexo de pedido',
                relatoriosEspecialidade: 'Imagem de relatório de especialidade',
                requisicoes: 'Anexo de requisição',
                veiculoDocumentos: 'Documento de viatura'
            };
            const formato = new Intl.DateTimeFormat('pt-PT', {
                dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Lisbon'
            });
            let painel;
            let revisaoSessao = 0;

            function fechar() {
                if (!painel) return;
                const anterior = painel;
                painel = null;
                anterior.close();
                anterior.remove();
            }

            async function listar() {
                const { data: fila } = await supa.rpc('tg_listar_ficheiros_triagem');
                const superadmin = Array.isArray(fila?.ficheiros);
                const resultado = superadmin ? { data: fila.ficheiros } : await supa.rpc('tg_listar_ficheiros_revisao');
                const { data, error } = resultado;
                if (error) throw new Error('Não foi possível carregar os ficheiros em revisão.');
                const secoes = superadmin ? triagem : revisao;
                const items = (data || []).filter(item =>
                    Object.hasOwn(secoes, item.estado) && referencia(origem + prefixo + 'ficheiros/' + item.caminho)
                );
                return { items, secoes, superadmin, empresas: superadmin ? fila.empresas : [] };
            }

            function secaoDoFicheiro(item) {
                return item.estado === 'pendente' && item.duplicado ? 'duplicado' : item.estado;
            }

            function mostrarAtalho({ items, superadmin }) {
                const pendentes = items.filter(item => secaoDoFicheiro(item) === 'pendente').length;
                atalho.textContent = (superadmin ? 'Ficheiros por atribuir' : 'Ficheiros em revisão')
                    + (pendentes ? ' (' + pendentes + ')' : '');
                atalho.hidden = !items.length;
            }

            function desenhar(fila) {
                fechar();
                let { items } = fila;
                const { secoes, superadmin, empresas } = fila;
                const dialogo = documento.createElement('dialog');
                painel = dialogo;
                dialogo.setAttribute('aria-labelledby', 'tg-revisao-titulo');
                dialogo.style.cssText = 'position:fixed;inset:0;margin:auto;box-sizing:border-box;width:min(42rem,calc(100% - 2rem));max-width:none;height:fit-content;max-height:calc(100dvh - 2rem);overflow:auto;border:1px solid #cbd5e1;border-radius:14px;padding:1.25rem;text-align:left;color:#152a52;';
                const titulo = documento.createElement('h3');
                titulo.id = 'tg-revisao-titulo';
                titulo.textContent = superadmin ? 'Ficheiros por atribuir' : 'Ficheiros em revisão';
                const descricao = documento.createElement('p');
                descricao.textContent = superadmin
                    ? 'Confirme a empresa antes de encaminhar o ficheiro para a revisão privada do respetivo administrador. Pode recuperar ficheiros no Arquivo.'
                    : 'Valide os ficheiros que reconhece. Pode recuperar um ficheiro arquivado. A validação não o anexa a um registo.';
                const navegacao = documento.createElement('div');
                navegacao.setAttribute('aria-label', 'Estado dos ficheiros');
                navegacao.style.cssText = 'display:flex;flex-wrap:wrap;gap:.4rem;margin:.75rem 0;';
                const lista = documento.createElement('ul');
                lista.style.cssText = 'display:grid;gap:.75rem;list-style:none;padding:0;margin:.75rem 0;';
                const informacao = documento.createElement('p');
                informacao.setAttribute('role', 'status');
                informacao.setAttribute('aria-live', 'polite');
                informacao.style.margin = '.5rem 0';
                const fecharBotao = criarBotao('Fechar', fechar);
                let secao = Object.keys(secoes).find(chave => items.some(item => secaoDoFicheiro(item) === chave));
                let ocupado = false;

                async function decidir(item, estado, empresa) {
                    const atual = revisaoSessao;
                    const estadoAnterior = item.estado;
                    ocupado = true;
                    informacao.textContent = 'A guardar decisão…';
                    dialogo.querySelectorAll('button, select').forEach(elemento => { elemento.disabled = true; });
                    try {
                        const argumentos = { p_caminho: item.caminho, p_anterior: estadoAnterior, p_estado: estado };
                        if (empresa) argumentos.p_empresa = empresa.id;
                        const { data, error } = await supa.rpc(
                            superadmin ? 'tg_decidir_ficheiro_triagem' : 'tg_decidir_ficheiro_revisao', argumentos
                        );
                        if (atual !== revisaoSessao || painel !== dialogo) return;
                        if (error) throw new Error('Não foi possível guardar a decisão.');
                        if (!data) {
                            items = (await listar()).items;
                            if (atual !== revisaoSessao || painel !== dialogo) return;
                            informacao.textContent = 'O estado mudou entretanto. A lista foi atualizada.';
                        } else {
                            item.estado = estado;
                            if (empresa) item.empresa_destino = empresa.nome;
                            informacao.textContent = {
                                validado: 'Ficheiro validado.',
                                arquivado: 'Ficheiro arquivado. Pode devolvê-lo à revisão no separador Arquivo.',
                                pendente: superadmin ? 'Ficheiro devolvido à triagem.' : 'Ficheiro devolvido à revisão.',
                                encaminhado: 'Ficheiro encaminhado para a revisão de ' + item.empresa_destino + '.'
                            }[estado];
                        }
                        mostrarAtalho({ items, superadmin });
                    } catch (error) {
                        if (atual === revisaoSessao && painel === dialogo) informacao.textContent = error.message;
                    } finally {
                        ocupado = false;
                        if (atual === revisaoSessao && painel === dialogo) {
                            fecharBotao.disabled = false;
                            renderizar();
                            informacao.tabIndex = -1;
                            informacao.focus({ preventScroll: true });
                        }
                    }
                }

                function criarEncaminhamento(item, acoes) {
                    const seletor = documento.createElement('select');
                    seletor.setAttribute('aria-label', 'Empresa de destino');
                    const placeholder = new Option('Selecionar empresa', '');
                    seletor.append(placeholder);
                    for (const empresa of empresas) seletor.append(new Option(empresa.nome, empresa.id));
                    const encaminhar = criarBotao('Encaminhar', () => {
                        const empresa = empresas.find(empresa => empresa.id === seletor.value);
                        if (empresa && window.confirm('Disponibilizar este ficheiro para revisão pelo administrador de ' + empresa.nome + '?')) {
                            decidir(item, 'encaminhado', empresa);
                        }
                    }, 'btn btn-primary');
                    encaminhar.disabled = true;
                    seletor.onchange = () => { encaminhar.disabled = !seletor.value; };
                    acoes.append(seletor, encaminhar);
                }

                function renderizar() {
                    navegacao.replaceChildren();
                    const contagens = {};
                    for (const [chave, nome] of Object.entries(secoes)) {
                        const total = items.filter(item => secaoDoFicheiro(item) === chave).length;
                        contagens[chave] = total;
                        const botao = criarBotao(nome + ' (' + total + ')', () => {
                            secao = chave;
                            informacao.textContent = '';
                            renderizar();
                            navegacao.querySelector('[aria-pressed="true"]').focus({ preventScroll: true });
                        }, chave === secao ? 'btn btn-primary' : 'btn btn-outline');
                        botao.setAttribute('aria-pressed', String(chave === secao));
                        botao.disabled = ocupado;
                        navegacao.append(botao);
                    }

                    lista.replaceChildren();
                    if (!contagens[secao]) {
                        const vazio = documento.createElement('li');
                        vazio.textContent = 'Sem ficheiros neste separador.';
                        lista.append(vazio);
                        return;
                    }

                    for (const item of items.filter(item => secaoDoFicheiro(item) === secao)) {
                        const linha = documento.createElement('li');
                        linha.style.cssText = 'border:1px solid #dbe3ed;border-radius:10px;padding:.8rem;overflow-wrap:anywhere;';
                        const data = new Date(item.carregado_em);
                        const etiqueta = item.tipo === 'os_fotos'
                            ? 'Fotografia de ordem de serviço' + (item.numero_os ? ' ' + item.numero_os : '')
                            : (tipos[item.tipo] || 'Ficheiro recuperado');
                        const nome = documento.createElement('strong');
                        nome.textContent = etiqueta + (Number.isFinite(data.getTime()) ? ' · ' + formato.format(data) : '');
                        const ficheiro = documento.createElement('small');
                        ficheiro.style.display = 'block';
                        ficheiro.textContent = item.caminho.split('/').pop();
                        const acoes = documento.createElement('div');
                        acoes.style.cssText = 'display:flex;flex-wrap:wrap;gap:.4rem;margin-top:.55rem;';
                        const abrirFicheiro = criarBotao('Abrir ficheiro', () =>
                            abrir(origem + prefixo + 'ficheiros/' + item.caminho, '_blank'));
                        acoes.append(abrirFicheiro);
                        linha.append(nome, ficheiro);
                        if (superadmin && (item.empresa_destino || item.empresa_sugerida)) {
                            const identificacao = documento.createElement('small');
                            identificacao.textContent = item.empresa_destino
                                ? 'Encaminhado para ' + item.empresa_destino
                                : 'Empresa sugerida: ' + item.empresa_sugerida;
                            linha.append(identificacao);
                        }
                        if (superadmin && secao === 'pendente') {
                            criarEncaminhamento(item, acoes);
                        }
                        if (secao === 'pendente' || secao === 'duplicado') {
                            if (!superadmin) acoes.append(criarBotao('Validar', () => decidir(item, 'validado'), 'btn btn-success'));
                            acoes.append(
                                criarBotao('Arquivar', () => decidir(item, 'arquivado'))
                            );
                        } else if (secao !== 'encaminhado') {
                            const texto = superadmin ? 'Voltar a pôr em triagem' : 'Voltar a pôr em revisão';
                            acoes.append(criarBotao(texto, () => decidir(item, 'pendente')));
                        }
                        linha.append(acoes);
                        lista.append(linha);
                    }
                }

                dialogo.addEventListener('cancel', evento => {
                    evento.preventDefault();
                    if (!ocupado) fechar();
                });
                dialogo.append(titulo, descricao, navegacao, lista, informacao, fecharBotao);
                renderizar();
                documento.body.append(dialogo);
                dialogo.showModal();
            }

            atalho.onclick = async () => {
                const atual = revisaoSessao;
                try {
                    const fila = await listar();
                    if (atual !== revisaoSessao) return;
                    mostrarAtalho(fila);
                    if (fila.items.length) desenhar(fila);
                    else window.alert('Já não há ficheiros disponíveis para revisão.');
                } catch (error) {
                    if (atual === revisaoSessao) window.alert(error.message);
                }
            };

            return id => {
                const atual = ++revisaoSessao;
                fechar();
                atalho.hidden = true;
                if (!id) return;
                // Supabase auth listeners must finish before a new request uses the client.
                setTimeout(async () => {
                    try {
                        const fila = await listar();
                        if (atual === revisaoSessao) mostrarAtalho(fila);
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
