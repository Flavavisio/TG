const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('app-principal.js', 'utf8');
const fn = name => source.match(new RegExp('        (?:async )?function ' + name + '\\([^]*?\\n        \\}'))[0];

test('customer codes accept up to 15 digits and preserve leading zeros', () => {
    const ctx = vm.createContext({});
    vm.runInContext(fn('_numeroClienteValido'), ctx);
    assert(ctx._numeroClienteValido('001234567890123'));
    assert(ctx._numeroClienteValido(''));
    assert(!ctx._numeroClienteValido('0012345678901234'));
    assert(!ctx._numeroClienteValido('00123456789012A'));
    assert.match(source, /id="c_numero_cliente".*maxlength="15"/);
});

test('OS deletion commits in the right tenant before changing the local list', async () => {
    const os = {id:'os', adminId:'a'};
    const linked = {id:'linked', servicoId:'os', adminId:'a'};
    const data = {servicos:[os], folhasObra:[linked], requisicoes:[{...linked}]};
    const calls = [];
    const ctx = vm.createContext({
        usuarioLogado:{id:'sub', adminId:'a', role:'subadmin'}, dados:data, _snap:{}, _syncChain:Promise.resolve(),
        _tenantId:() => 'a', tgConfirm:async () => true, tgAlert:alert => calls.push(alert),
        supa:{rpc:async (name, args) => {
            calls.push([name, args.p_os_id]);
            assert.equal(data.servicos.length, 1);
            return ctx.fail ? {error:{message:'Indisponível'}} : {data:true};
        }},
        _guardarCacheLocal() {}, registarAuditoria() {}, renderizarTudo() {}
    });
    vm.runInContext(['_podeGerirRegisto', '_apagarOSGestao', 'excluirEntidade'].map(fn).join('\n'), ctx);

    ctx.fail = true;
    await ctx.excluirEntidade('servico', 'os');
    assert.equal(data.servicos.length, 1);
    assert.equal(data.folhasObra.length, 1);
    assert.match(calls[1], /Indisponível/);
    ctx.fail = false;

    await ctx._apagarOSGestao({id:'exterior', adminId:'b'});
    assert.equal(calls.length, 2);
    assert.equal(await ctx.excluirEntidade('servico', 'os'), true);
    assert.deepEqual(calls[2], ['tg_apagar_ordem_servico', 'os']);
    assert.equal(data.servicos.length, 0);
    assert.equal(data.folhasObra.length, 0);
    assert.equal(data.requisicoes[0].servicoId, null);
});

test('work expenses are created and edited in cents without submitting the surrounding modal', async () => {
    const {JSDOM} = require('jsdom');
    const {window:w} = new JSDOM('<form><div id="gastos"></div></form>', {runScripts:'outside-only'});
    try {
        const writes = [];
        const cont = w.document.querySelector('#gastos');
        const obra = {id:'obra', adminId:'a'};
        let modalSubmit = 0;
        w.document.querySelector('form').addEventListener('submit', () => modalSubmit++);
        const query = {
            eq(column, value) { writes.push([column, value]); return this; },
            select() { return this; },
            async single() { return {data:{id:'saved'}}; }
        };
        Object.assign(w, {
            usuarioLogado:{role:'subadmin', adminId:'a'}, _tenantId:() => 'a',
            _finEur:n => n.toFixed(2) + ' €', escapeHtmlSimples:s => String(s), _abrirCustosObra:() => {},
            supa:{from(table) {
                assert.equal(table, 'obra_outros_gastos');
                return {
                    async upsert(row) { writes.push(row); return {}; },
                    update(row) { writes.push(row); return query; }
                };
            }}
        });
        w.eval(['_podeGerirRegisto', '_renderizarOutrosGastosObra'].map(fn).join('\n'));
        w._renderizarOutrosGastosObra(obra, cont, []);
        cont.querySelector('#obra-gasto-descricao').value = 'Hotel';
        cont.querySelector('#obra-gasto-valor').value = '125,40';
        const enter = new w.KeyboardEvent('keydown', {key:'Enter', cancelable:true, bubbles:true});
        cont.querySelector('#obra-gasto-valor').dispatchEvent(enter);
        assert(enter.defaultPrevented);
        assert.equal(modalSubmit, 0);
        assert.equal(writes[0].descricao, 'Hotel');
        assert.equal(writes[0].valor_centimos, 12540);
        assert.equal(writes[0].admin_id, 'a');

        await new Promise(resolve => setImmediate(resolve));
        w._renderizarOutrosGastosObra(obra, cont, [{id:'expense', descricao:'Hotel', valor_centimos:12540}]);
        cont.querySelector('[data-editar-gasto]').click();
        assert.equal(cont.querySelector('#obra-gasto-valor').value, '125,40');
        cont.querySelector('#obra-gasto-valor').value = '7.50';
        cont.querySelector('[data-guardar-gasto]').click();
        assert.equal(writes[1].valor_centimos, 750);
        assert.deepEqual(writes.slice(2), [['admin_id','a'], ['obra_id','obra'], ['id','expense']]);
    } finally { w.close(); }
});
