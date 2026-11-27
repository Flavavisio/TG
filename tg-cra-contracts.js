(function () {
    'use strict';

    const bucket = 'contratos-prestacao-servicos';
    const fileTypes = { pdf: 'application/pdf', doc: 'application/msword',
        docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };
    const itemTypes = { texto: 'Texto', confirmacao: 'Confirmação', documento: 'Documento' };
    const statuses = { preparacao: 'Em preparação', vigente: 'Em vigor', terminado: 'Terminado' };
    const days = ['Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira'];
    const defaults = { ativo: false, frequencia: 'sem', hora: null, dia_semana: null };
    const clock = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Europe/Lisbon', year: 'numeric', month: '2-digit', day: '2-digit',
        weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
    });
    const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
    const actor = () => usuarioLogado;
    const isAdmin = () => actor()?.role === 'admin';
    function eligible() {
        if (!['admin', 'subadmin'].includes(actor()?.role)) return false;
        const areas = adminDoUtilizador()?.areasNegocio;
        return Array.isArray(areas) && areas.includes('seguranca');
    }
    const company = () => isAdmin() ? actor()?.id : actor()?.adminId;
    const session = () => eligible() ? JSON.stringify([company(), actor().id, actor().role]) : '';
    const storage = () => supa.storage.from(bucket);
    const selectOptions = (options, current) => Object.entries(options)
        .map(([value, label]) => `<option value="${esc(value)}" ${String(current) === value ? 'selected' : ''}>${esc(label)}</option>`)
        .join('');
    const button = (label, attributes = '', kind = 'outline') =>
        `<button type="button" class="btn btn-${kind}" ${attributes}>${label}</button>`;
    const profileStates = new WeakMap();
    const installations = new Set();
    let snapshot = null;
    let refreshTask;

    async function result(promise) {
        const { data, error } = await promise;
        if (error) throw error;
        return data;
    }

    function message(node, value) {
        if (node) node.textContent = value;
    }

    function closeDialog(dialog) {
        dialog?.close();
    }

    function showDialog(title) {
        const dialog = document.createElement('dialog');
        const key = session();
        dialog.className = 'tg-cra-dialog';
        dialog.setAttribute('aria-label', title);
        dialog.innerHTML = `<header><h2>${esc(title)}</h2>${button('×', 'data-close aria-label="Fechar"')}</header>
            <div class="tg-cra-body"></div>`;
        const body = dialog.querySelector('.tg-cra-body');
        dialog.querySelector('[data-close]').onclick = () => { if (!dialog.dataset.busy) closeDialog(dialog); };
        dialog.addEventListener('cancel', event => { if (dialog.dataset.busy) event.preventDefault(); });
        dialog.addEventListener('close', () => dialog.remove(), { once: true });
        document.body.append(dialog);
        dialog.showModal();
        return { dialog, body, live: () => dialog.isConnected && key && session() === key };
    }

    async function configFor(tenant) {
        return await result(supa.from('cra_configuracoes').select('ativo,frequencia,hora,dia_semana')
            .eq('admin_id', tenant).maybeSingle());
    }

    function configureProfile(host) {
        if (!host || !eligible() || !isAdmin()) return;
        const key = session();
        const state = { original: null, dirty: false, busy: false };
        profileStates.set(host, state);
        host.textContent = 'A carregar opções CRA…';
        const load = async () => {
            try {
                const stored = await configFor(company());
                if (!host.isConnected || key !== session()) return;
                state.original = stored;
                const config = stored || defaults;
                host.innerHTML = `<label class="tg-cra-checkbox"><input type="checkbox" data-cra-enabled ${config.ativo ? 'checked' : ''}> CRA com alvará C</label>
                    <div data-cra-schedule class="tg-cra-stack">
                        <label>Pop-up de contratos incompletos <select data-cra-frequency>
                            ${selectOptions({ sem: 'Sem alerta', diario: 'Alerta diário', semanal: 'Alerta semanal' }, config.frequencia)}
                        </select></label>
                        <label data-cra-day-label>Dia da semana <select data-cra-day>${selectOptions(Object.fromEntries(days.map((day, i) => [i + 1, day])), config.dia_semana || 1)}</select></label>
                        <label data-cra-time-label>Hora do alerta (Portugal continental) <input type="time" data-cra-time value="${esc(config.hora?.slice(0, 5) || '09:00')}"></label>
                        ${button('Modelos de prestação de serviços', 'data-cra-models')}
                    </div><p role="status" data-cra-profile-status></p>`;
                const enabled = host.querySelector('[data-cra-enabled]');
                const frequency = host.querySelector('[data-cra-frequency]');
                const day = host.querySelector('[data-cra-day-label]');
                const time = host.querySelector('[data-cra-time-label]');
                const models = host.querySelector('[data-cra-models]');
                function updateVisibility() {
                    host.querySelector('[data-cra-schedule]').hidden = !enabled.checked;
                    day.hidden = frequency.value !== 'semanal';
                    time.hidden = frequency.value === 'sem';
                    models.hidden = !state.original?.ativo;
                }
                updateVisibility();
                host.onchange = () => {
                    state.dirty = true;
                    updateVisibility();
                };
                models.onclick = openModels;
            } catch {
                if (host.isConnected && key === session()) {
                    host.innerHTML = 'Não foi possível carregar as opções CRA. ' + button('Tentar novamente', 'data-cra-retry');
                    host.querySelector('[data-cra-retry]').onclick = load;
                }
            }
        };
        void load();
    }

    async function saveProfile(host) {
        const state = profileStates.get(host);
        if (!state?.dirty) return true;
        if (!isAdmin() || !eligible() || state.busy) return false;
        const tenant = company();
        const status = host.querySelector('[data-cra-profile-status]');
        const ativo = host.querySelector('[data-cra-enabled]').checked;
        const frequencia = ativo ? host.querySelector('[data-cra-frequency]').value : 'sem';
        const hora = frequencia === 'sem' ? null : host.querySelector('[data-cra-time]').value;
        const dia_semana = frequencia === 'semanal' ? Number(host.querySelector('[data-cra-day]').value) : null;
        if (frequencia !== 'sem' && !hora) {
            message(status, 'Indique a hora do alerta.');
            return false;
        }
        state.busy = true;
        const controls = [...host.querySelectorAll('input, select, button')];
        controls.forEach(control => { control.disabled = true; });
        try {
            const values = { ativo, frequencia, hora, dia_semana };
            const table = supa.from('cra_configuracoes');
            const query = state.original ? table.update(values).eq('admin_id', tenant)
                : table.insert({ admin_id: tenant, ...values });
            state.original = await result(query.select('ativo,frequencia,hora,dia_semana').single());
            state.dirty = false;
            void refreshAfterWrite();
            return true;
        } catch {
            message(status, 'Não foi possível guardar as opções CRA. Reabra o perfil e tente novamente.');
            return false;
        } finally {
            state.busy = false;
            controls.forEach(control => { control.disabled = false; });
        }
    }

    function modelsFor(tenant) {
        return result(supa.from('cra_modelos').select('id,nome,versao,checklists,ativo')
            .eq('admin_id', tenant).order('nome'));
    }

    async function openModels() {
        if (!eligible() || !isAdmin()) return;
        const view = showDialog('Modelos de prestação de serviços');
        const tenant = company();
        message(view.body, 'A carregar modelos…');
        try {
            const [config, models] = await Promise.all([configFor(tenant), modelsFor(tenant)]);
            if (!view.live()) return;
            if (!config?.ativo) {
                message(view.body, 'Ative CRA com alvará C em Perfil e empresa → Opcionais Extra.');
                return;
            }
            view.body.innerHTML = `${button('Novo modelo', 'data-model="novo"', 'primary')}
                <div class="tg-cra-stack">${models.map((model, index) =>
                    `<div class="tg-cra-row"><span><strong>${esc(model.nome)}</strong><small>Versão ${model.versao} · ${model.ativo ? 'Ativo' : 'Arquivado'}</small></span>
                    ${button('Configurar', `data-model="${index}"`)}</div>`).join('')}</div>`;
            view.body.onclick = event => {
                const target = event.target.closest('[data-model]');
                if (!target || !view.live()) return;
                closeDialog(view.dialog);
                editModel(target.dataset.model === 'novo' ? null : models[Number(target.dataset.model)]);
            };
        } catch {
            if (view.live()) message(view.body, 'Não foi possível carregar os modelos.');
        }
    }

    function editModel(model) {
        const tenant = company();
        const view = showDialog(model ? 'Configurar modelo' : 'Novo modelo');
        view.body.innerHTML = `<form class="tg-cra-stack">
            <label>Nome do tipo de contrato <input name="nome" required maxlength="120" value="${esc(model?.nome)}"></label>
            <label class="tg-cra-checkbox"><input type="checkbox" name="ativo" ${model?.ativo === false ? '' : 'checked'}> Disponível para novos contratos</label>
            <div class="tg-cra-stack" data-checklists></div>
            <div>${button('Adicionar checklist', 'data-add-group')}</div>
            <p class="help-text">As alterações criam uma nova versão. Nos contratos existentes, o administrador pode aplicar a versão mais recente.</p>
            <p data-status role="status"></p>
            <footer>${button('Voltar', 'data-back')}<button type="submit" class="btn btn-primary">Guardar modelo</button></footer></form>`;
        const form = view.body.querySelector('form');
        const groups = form.querySelector('[data-checklists]');
        const status = form.querySelector('[data-status]');

        function addItem(list, item = {}) {
            const row = document.createElement('div');
            row.className = 'tg-cra-item';
            row.dataset.item = item.id || crypto.randomUUID();
            row.dataset.originalType = item.tipo || 'texto';
            row.innerHTML = `<label>Item <input data-item-name required maxlength="120" value="${esc(item.nome)}"></label>
                <label>Tipo <select data-item-type>${selectOptions(itemTypes, item.tipo || 'texto')}</select></label>
                <label class="tg-cra-checkbox"><input type="checkbox" data-required ${item.obrigatorio !== false ? 'checked' : ''}> Obrigatório</label>
                ${button('Remover item', 'data-remove-item')}`;
            list.append(row);
        }

        function addGroup(group = {}) {
            const block = document.createElement('fieldset');
            block.className = 'tg-cra-stack';
            block.innerHTML = `<legend>Checklist</legend><label>Nome da checklist <input data-group-name required maxlength="120" value="${esc(group.nome)}"></label>
                <div class="tg-cra-stack" data-items></div><div class="tg-cra-actions">
                ${button('Adicionar item', 'data-add-item')}${button('Remover checklist', 'data-remove-group')}</div>`;
            groups.append(block);
            for (const item of group.itens || [{}]) addItem(block.querySelector('[data-items]'), item);
        }

        for (const group of model?.checklists || [{}]) addGroup(group);
        form.onclick = event => {
            const pressed = event.target.closest('button');
            if (!pressed || view.dialog.dataset.busy) return;
            const group = pressed.closest('fieldset');
            if (pressed.matches('[data-back]')) { closeDialog(view.dialog); void openModels(); }
            if (pressed.matches('[data-add-group]') && groups.children.length < 20) addGroup();
            if (pressed.matches('[data-remove-group]')) group.remove();
            if (pressed.matches('[data-add-item]') && group.querySelector('[data-items]').children.length < 30) addItem(group.querySelector('[data-items]'));
            if (pressed.matches('[data-remove-item]')) pressed.closest('[data-item]').remove();
        };

        form.onsubmit = async event => {
            event.preventDefault();
            if (!view.live() || !isAdmin() || view.dialog.dataset.busy) return;
            const checklists = [...groups.children].map(group => ({
                nome: group.querySelector('[data-group-name]').value.trim(),
                itens: [...group.querySelectorAll('[data-item]')].map(row => {
                    const tipo = row.querySelector('[data-item-type]').value;
                    return {
                        id: tipo === row.dataset.originalType ? row.dataset.item : crypto.randomUUID(),
                        nome: row.querySelector('[data-item-name]').value.trim(), tipo,
                        obrigatorio: row.querySelector('[data-required]').checked
                    };
                })
            }));
            const nome = form.elements.nome.value.trim();
            if (!nome || !checklists.length || checklists.some(group =>
                !group.nome || !group.itens.length || group.itens.some(item => !item.nome))) {
                message(status, 'Preencha os nomes e adicione pelo menos um item a cada checklist.');
                return;
            }
            const values = { nome, checklists, ativo: form.elements.ativo.checked };
            await locked(view, form, status, async () => {
                const table = supa.from('cra_modelos');
                const query = model ? table.update(values).eq('id', model.id).eq('versao', model.versao)
                    : table.insert({ ...values, admin_id: tenant });
                const saved = await result(query.select('id').maybeSingle());
                if (!saved) throw Error('Este modelo foi alterado. Reabra-o antes de guardar.');
                if (view.live()) { closeDialog(view.dialog); void openModels(); }
            });
        };
    }

    async function locked(view, form, status, action) {
        const controls = [...form.querySelectorAll('input, select, button, textarea')]
            .filter(control => !control.disabled);
        controls.forEach(control => { control.disabled = true; });
        view.dialog.dataset.busy = 'true';
        message(status, 'A guardar…');
        try {
            await action();
        } catch (error) {
            if (view.live()) message(status, error.code === '23505' ? 'Já existe um registo com esse nome ou identificador.'
                : error.message || 'Não foi possível guardar.');
        } finally {
            delete view.dialog.dataset.busy;
            controls.forEach(control => { control.disabled = false; });
        }
    }

    function installationLabel(clienteId, localId) {
        const customer = (dados.clientes || []).find(row => row.id === clienteId && row.adminId === company());
        const local = (dados.locais || []).find(row => row.id === localId && row.clienteId === clienteId && row.adminId === company());
        return [customer ? _clienteLabel(customer) : 'Cliente', localId ? local?.nome || 'Instalação' : 'Sede'].join(' · ');
    }

    function missingItems(contract) {
        const missing = contract.documento ? [] : ['Documento do contrato'];
        for (const group of contract.checklists) {
            for (const item of group.itens) {
                const value = contract.respostas[item.id];
                const complete = item.tipo === 'confirmacao' ? value === true : Boolean(String(value ?? '').trim());
                if (item.obrigatorio && !complete) missing.push(`${group.nome} · ${item.nome}`);
            }
        }
        return missing;
    }

    async function readInstallation(entry) {
        const { host, customerId, localId, key } = entry;
        const live = () => host.isConnected && session() === key;
        if (!live()) {
            installations.delete(entry);
            host.remove();
            return;
        }
        const generation = entry.generation = (entry.generation || 0) + 1;
        const current = () => live() && entry.generation === generation;
        if (!snapshot?.config?.ativo || snapshot.key !== key) {
            host.hidden = true;
            host.replaceChildren();
            return;
        }
        host.hidden = false;
        host.innerHTML = '<h4>Prestação de serviços</h4><p role="status">A carregar contratos…</p>';
        try {
            const rows = await readPages((from, to) => {
                const scoped = supa.from('cra_contratos').select('*').eq('admin_id', company()).eq('cliente_id', customerId);
                return (localId ? scoped.eq('local_id', localId) : scoped.is('local_id', null))
                    .order('nome').order('id').range(from, to);
            });
            if (!current()) return;
            host.innerHTML = `<div class="tg-cra-actions"><h4>Prestação de serviços</h4>${button('Novo contrato', 'data-contract="novo"')}</div>
                ${rows.length ? rows.map((row, index) => {
                    const missing = missingItems(row);
                    return `<div class="tg-cra-row"><span><strong>${esc(row.nome)}</strong>
                        <small>${esc(row.modelo_nome)} · ${statuses[row.estado]}
                            ${missing.length ? ` · ${missing.length} ${missing.length === 1 ? 'item em falta' : 'itens em falta'}` : ''}</small></span>
                        ${button('Abrir contrato', `data-contract="${index}"`)}</div>`;
                }).join('') : '<p class="help-text">Sem contratos de prestação de serviços nesta instalação.</p>'}`;
            host.onclick = event => {
                const pressed = event.target.closest('[data-contract]');
                if (!pressed || !current()) return;
                const row = pressed.dataset.contract === 'novo' ? null : rows[Number(pressed.dataset.contract)];
                void openContract(customerId, localId, row?.id);
            };
        } catch {
            if (current()) {
                host.innerHTML = '<h4>Prestação de serviços</h4><p role="status">Não foi possível carregar os contratos.</p>'
                    + button('Tentar novamente', 'data-retry');
                host.querySelector('[data-retry]').onclick = () => { void readInstallation(entry); };
            }
        }
    }

    function mount(host, customerId, localId) {
        const key = session();
        if (!key || !host) return;
        for (const entry of installations) {
            if (!entry.host.isConnected || host.contains(entry.host)) installations.delete(entry);
        }
        const section = document.createElement('div');
        section.className = 'tg-cra-installation';
        section.hidden = true;
        host.prepend(section);
        const entry = { host: section, customerId, localId: localId || null, key };
        installations.add(entry);
        void readInstallation(entry);
        if (snapshot?.key !== key) void refresh();
    }

    function fileName(path) {
        return path.split('/').pop().replace(/^[a-f0-9-]{36}_/, '');
    }

    function fileField(label, path, required) {
        return `<div class="tg-cra-stack" data-file-field>
            <label>${esc(label)}${required ? ' (obrigatório)' : ''}<input type="file" accept=".pdf,.doc,.docx"></label>
            ${path ? `<div class="tg-cra-actions"><span data-current-file>${esc(fileName(path))}</span>
                ${button('Descarregar', `data-download="${esc(path)}"`)}${button('Retirar', 'data-remove-file')}</div>` : ''}
        </div>`;
    }

    async function download(path) {
        const blob = await result(storage().download(path));
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = fileName(path);
        document.body.append(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 10000);
    }

    function makeUpload(input, tenant, id) {
        const file = input.querySelector('input[type="file"]').files[0];
        if (!file) return null;
        const extension = file.name.split('.').pop().toLowerCase();
        if (!Object.hasOwn(fileTypes, extension) || !file.size || file.size > 15 * 1024 * 1024) {
            throw Error('Selecione documentos PDF, DOC ou DOCX até 15 MB.');
        }
        const base = file.name.slice(0, -(extension.length + 1)).normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9._-]+/gi, '_').slice(0, 100) || 'Documento';
        return { file, type: fileTypes[extension], path: `${tenant}/${id}/${crypto.randomUUID()}_${base}.${extension}` };
    }

    async function openContract(customerId, localId, id) {
        if (!session()) return;
        const tenant = company();
        const view = showDialog(id ? 'Contrato de prestação de serviços' : 'Novo contrato de prestação de serviços');
        message(view.body, 'A carregar contrato…');
        try {
            const [models, row] = await Promise.all([modelsFor(tenant), id
                ? result(supa.from('cra_contratos').select('*').eq('admin_id', tenant).eq('id', id).single()) : null]);
            if (!view.live()) return;
            if (row && (row.cliente_id !== customerId || row.local_id !== localId)) {
                message(view.body, 'A instalação deste contrato mudou. Abra novamente a lista.');
                return;
            }
            const activeModels = models.filter(model => model.ativo);
            if (!row && !activeModels.length) {
                message(view.body, 'É necessário um modelo ativo em Configurações e ajuda → Modelos de prestação de serviços.');
                return;
            }
            contractForm(view, tenant, customerId, localId, row, activeModels);
        } catch {
            if (view.live()) message(view.body, 'Não foi possível carregar o contrato.');
        }
    }

    function contractForm(view, tenant, customerId, localId, row, models) {
        const latest = row && models.find(model => model.id === row.modelo_id);
        const savedModel = row && { id: row.modelo_id, nome: row.modelo_nome, versao: row.modelo_versao, checklists: row.checklists };
        let model = savedModel;
        const id = row?.id || crypto.randomUUID();
        view.body.innerHTML = `<p>${esc(installationLabel(customerId, localId))}</p><form class="tg-cra-stack">
            ${row ? '<div data-model-version></div>' : `<label>Tipo de contrato <select name="modelo" required>
                <option value="">Escolher modelo</option>${selectOptions(Object.fromEntries(models.map(item => [item.id, item.nome])), '')}</select></label>`}
            <label>Nome do contrato <input name="nome" required maxlength="120" value="${esc(row?.nome)}"></label>
            <label>Estado <select name="estado">${selectOptions(statuses, row?.estado || 'preparacao')}</select></label>
            <div data-main-document>${fileField('Documento do contrato', row?.documento, true)}</div>
            <p class="help-text">PDF, DOC ou DOCX até 15 MB por documento. As pendências são geradas nos contratos em vigor.</p>
            <div data-checklist-fields class="tg-cra-stack"></div>
            <p data-status role="status"></p><footer><button type="submit" class="btn btn-primary">Guardar contrato</button></footer></form>`;
        const form = view.body.querySelector('form');
        const status = form.querySelector('[data-status]');
        const checklist = form.querySelector('[data-checklist-fields]');
        const version = form.querySelector('[data-model-version]');
        const mainDocument = form.querySelector('[data-main-document] [data-file-field]');
        const originalItems = new Map((row?.checklists || []).flatMap(group => group.itens).map(item => [item.id, item.tipo]));
        let responses = { ...(row?.respostas || {}) };

        function renderItems() {
            if (version) {
                version.innerHTML = `<div class="tg-cra-actions"><strong>${esc(model.nome)} · Versão ${model.versao}</strong>
                    ${isAdmin() && latest && latest.versao > model.versao ? button('Aplicar versão ' + latest.versao, 'data-upgrade') : ''}</div>`;
            }
            checklist.innerHTML = (model?.checklists || []).map(group =>
                `<fieldset class="tg-cra-stack"><legend>${esc(group.nome)}</legend>${group.itens.map(item => {
                    const value = responses[item.id];
                    const label = esc(item.nome) + (item.obrigatorio ? ' (obrigatório)' : '');
                    const field = item.tipo === 'texto' ? `<label>${label}<textarea rows="2" maxlength="2000">${esc(value)}</textarea></label>`
                        : item.tipo === 'confirmacao' ? `<label class="tg-cra-checkbox"><input type="checkbox" ${value === true ? 'checked' : ''}> ${label}</label>`
                        : fileField(item.nome, value, item.obrigatorio);
                    return `<div data-answer="${item.id}">${field}</div>`;
                }).join('')}</fieldset>`).join('');
        }
        renderItems();

        form.elements.modelo?.addEventListener('change', event => {
            model = models.find(item => item.id === event.target.value);
            responses = {};
            if (!form.elements.nome.value.trim() && model) form.elements.nome.value = model.nome;
            renderItems();
        });

        form.onclick = async event => {
            if (!view.live() || view.dialog.dataset.busy) return;
            const pressed = event.target.closest('button');
            if (!pressed) return;
            if (pressed.matches('[data-download]')) {
                try { await download(pressed.dataset.download); }
                catch { if (view.live()) message(status, 'Não foi possível descarregar o documento.'); }
            }
            if (pressed.matches('[data-remove-file]')) {
                pressed.closest('[data-file-field]').dataset.removed = 'true';
                pressed.parentElement.hidden = true;
            }
            if (pressed.matches('[data-upgrade]') && latest && isAdmin()) {
                // A atualização muda os campos exibidos. Os novos documentos podem ser anexados a seguir.
                const current = collectResponses(false).answers;
                responses = Object.fromEntries(latest.checklists.flatMap(group => group.itens)
                    .filter(item => originalItems.get(item.id) === item.tipo && Object.hasOwn(current, item.id))
                    .map(item => [item.id, current[item.id]]));
                model = latest;
                renderItems();
                message(status, 'Modelo atualizado no formulário. Guarde o contrato para aplicar.');
            }
        };

        function collectResponses(includeUploads) {
            const answers = {};
            const uploads = [];
            for (const field of checklist.querySelectorAll('[data-answer]')) {
                const key = field.dataset.answer;
                const text = field.querySelector('textarea');
                const check = field.querySelector('input[type="checkbox"]');
                const file = field.querySelector('[data-file-field]');
                if (text) answers[key] = text.value.trim();
                if (check) answers[key] = check.checked;
                if (file) {
                    const upload = includeUploads ? makeUpload(file, tenant, id) : null;
                    if (upload) uploads.push(upload);
                    if (upload || (responses[key] && !file.dataset.removed)) answers[key] = upload?.path || responses[key];
                }
            }
            return { answers, uploads };
        }

        form.onsubmit = async event => {
            event.preventDefault();
            if (!view.live() || view.dialog.dataset.busy || !model) return;
            const nome = form.elements.nome.value.trim();
            if (!nome) { message(status, 'Indique o nome do contrato.'); return; }
            await locked(view, form, status, async () => {
                const { answers, uploads } = collectResponses(true);
                const contractUpload = makeUpload(mainDocument, tenant, id);
                if (contractUpload) uploads.push(contractUpload);
                const documento = contractUpload?.path || (!mainDocument.dataset.removed && row?.documento) || null;
                const values = { nome, estado: form.elements.estado.value, documento,
                    respostas: answers, modelo_versao: model.versao };
                const uploaded = [];
                try {
                    for (const upload of uploads) {
                        if (!view.live()) throw Error('A sessão mudou. Volte a abrir o contrato.');
                        await result(storage().upload(upload.path, upload.file, { contentType: upload.type, upsert: false }));
                        uploaded.push(upload.path);
                    }
                    if (!view.live()) throw Error('A sessão mudou. Volte a abrir o contrato.');
                    const table = supa.from('cra_contratos');
                    const query = row ? table.update(values).eq('id', id).eq('revisao', row.revisao)
                        : table.insert({ ...values, id, admin_id: tenant, cliente_id: customerId, local_id: localId, modelo_id: model.id });
                    const saved = await result(query.select('id').maybeSingle());
                    if (!saved) throw Error('O contrato foi alterado. Volte a abri-lo antes de guardar.');
                } catch (error) {
                    if (uploaded.length && view.live()) await storage().remove(uploaded);
                    throw error;
                }
                const previous = [row?.documento, ...Object.values(row?.respostas || {})];
                const retained = new Set([documento, ...Object.values(answers)]);
                const replaced = [...new Set(previous.filter(path =>
                    typeof path === 'string' && path.startsWith(`${tenant}/${id}/`) && !retained.has(path)))];
                if (replaced.length && view.live()) void storage().remove(replaced);
                if (view.live()) {
                    closeDialog(view.dialog);
                    for (const entry of installations) {
                        if (entry.customerId === customerId && entry.localId === localId) void readInstallation(entry);
                    }
                    void refreshAfterWrite();
                }
            });
        };
    }

    async function readPages(query) {
        const rows = [];
        const limit = 100;
        for (let start = 0; ; start += limit) {
            const page = await result(query(start, start + limit - 1));
            rows.push(...page);
            if (page.length < limit) return rows;
        }
    }

    function showPending(rows) {
        if (!session() || document.querySelector('dialog[data-cra-pending][open]')) return;
        const view = showDialog('🚨 Contratos com itens obrigatórios em falta');
        view.dialog.dataset.craPending = '';
        view.body.innerHTML = rows.length ? rows.map((row, index) => `<article class="tg-cra-row">
            <div><strong>${esc(row.nome)}</strong><small>${esc(installationLabel(row.cliente_id, row.local_id))}</small>
            <ul>${row.itens.map(item => `<li>${esc(item)}</li>`).join('')}</ul></div>
            ${button('Abrir contrato', `data-pending-index="${index}"`)}</article>`).join('')
            : '<p>Não há contratos em vigor com itens obrigatórios em falta.</p>';
        view.body.onclick = event => {
            const target = event.target.closest('[data-pending-index]');
            if (!target || !view.live()) return;
            const row = rows[Number(target.dataset.pendingIndex)];
            closeDialog(view.dialog);
            void openContract(row.cliente_id, row.local_id, row.id);
        };
    }

    function scheduledPeriod(config, now = new Date()) {
        if (!config?.ativo || config.frequencia === 'sem' || !config.hora) return '';
        const parts = Object.fromEntries(clock.formatToParts(now).map(part => [part.type, part.value]));
        if (`${parts.hour}:${parts.minute}` < config.hora.slice(0, 5)) return '';
        if (config.frequencia === 'semanal' && ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].indexOf(parts.weekday) + 1 !== config.dia_semana) return '';
        return `${config.frequencia}/${parts.year}-${parts.month}-${parts.day}`;
    }

    function pending() {
        return snapshot?.key === session() && snapshot.config?.ativo ? snapshot.rows : [];
    }

    function refresh() {
        const key = session();
        if (!key) {
            snapshot = null;
            for (const entry of installations) {
                entry.host.replaceChildren();
                entry.host.hidden = true;
            }
            installations.clear();
            document.querySelectorAll('dialog.tg-cra-dialog[open]').forEach(closeDialog);
            return Promise.resolve();
        }
        if (refreshTask?.key === key) return refreshTask.job;
        const tenant = company();
        const job = (async () => {
            try {
                const config = await configFor(tenant);
                const rows = config?.ativo ? await readPages((from, to) =>
                    supa.from('cra_pendencias').select('id,cliente_id,local_id,nome,itens')
                        .eq('admin_id', tenant).order('nome').order('id').range(from, to)) : [];
                if (key !== session()) return;
                const previous = snapshot?.key === key ? snapshot : null;
                const activationChanged = previous?.config?.ativo !== config?.ativo;
                const countChanged = previous?.rows.length !== rows.length;
                snapshot = { key, config, rows, checked: previous?.checked };
                if (activationChanged) {
                    for (const entry of installations) void readInstallation(entry);
                    if (!config?.ativo) document.querySelectorAll('dialog.tg-cra-dialog[open]').forEach(closeDialog);
                }
                if (countChanged) renderizarAlertas();
                const period = scheduledPeriod(config);
                if (!period || !rows.length || snapshot.checked === period || document.visibilityState !== 'visible') return;
                if (document.querySelector('dialog[open]')) return;
                const claimed = await result(supa.rpc('tg_cra_reservar_alerta'));
                if (key !== session() || snapshot?.key !== key) return;
                if (claimed) {
                    snapshot.checked = period;
                    showPending(rows);
                }
            } catch (error) {
                // As opções CRA e os alertas voltam a ser consultados na próxima tentativa.
                if (error.code !== 'PGRST205') console.warn('Contratos CRA:', error.message);
            }
        })().finally(() => { if (refreshTask?.job === job) refreshTask = null; });
        refreshTask = { key, job };
        return job;
    }

    async function refreshAfterWrite() {
        if (refreshTask?.key === session()) await refreshTask.job;
        return await refresh();
    }

    function start() {
        if (snapshot?.key !== session() && eligible()) void refresh();
    }

    setInterval(refresh, 30000);
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') void refresh();
    });
    window.addEventListener('focus', refresh);
    window.TGCraContracts = {
        configureProfile, saveProfile, openModels, mount, pending, start, refresh,
        canConfigureModels: () => eligible() && isAdmin(),
        openPending: () => showPending(pending())
    };
})();
