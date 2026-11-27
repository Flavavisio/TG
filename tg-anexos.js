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

        function instalar(documento) {
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
