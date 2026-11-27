create table public.cra_configuracoes (
    admin_id text primary key references public.administradores(id) on delete cascade,
    ativo boolean not null default false,
    frequencia text not null default 'sem' check (frequencia in ('sem', 'diario', 'semanal')),
    hora time,
    dia_semana integer,
    check ((frequencia = 'sem' and hora is null and dia_semana is null)
        or (frequencia = 'diario' and hora is not null and hora < time '24:00' and dia_semana is null)
        or (frequencia = 'semanal' and hora is not null and hora < time '24:00'
            and dia_semana is not null and dia_semana between 1 and 5)),
    check (ativo or frequencia = 'sem')
);

create function tg_private.cra_area_elegivel(empresa text)
returns boolean language sql stable security definer set search_path = '' as $$
    select empresa = public.tg_admin_id() and exists (
        select 1 from public.administradores a
        where a.id = empresa and a.areas_negocio @> '["seguranca"]'::jsonb
    );
$$;

create function tg_private.cra_ativo(empresa text)
returns boolean language sql stable security definer set search_path = '' as $$
    select tg_private.cra_area_elegivel(empresa) and exists (
        select 1 from public.cra_configuracoes c where c.admin_id = empresa and c.ativo
    );
$$;

create table public.cra_modelos (
    id uuid primary key default gen_random_uuid(),
    admin_id text not null references public.administradores(id) on delete cascade,
    nome text not null check (char_length(btrim(nome)) between 1 and 120),
    checklists jsonb not null,
    versao integer not null default 1,
    ativo boolean not null default true
);
create unique index cra_modelos_nome_idx on public.cra_modelos (admin_id, lower(btrim(nome)));

create function tg_private.validar_cra_modelo()
returns trigger language plpgsql set search_path = '' as $$
declare
    grupo jsonb;
    item jsonb;
    chave text;
    chaves text[] := array[]::text[];
begin
    if jsonb_typeof(new.checklists) is distinct from 'array' then
        raise exception 'Indique as checklists do modelo.';
    end if;
    if jsonb_array_length(new.checklists) not between 1 and 20 then
        raise exception 'Adicione entre 1 e 20 checklists.';
    end if;
    for grupo in select value from pg_catalog.jsonb_array_elements(new.checklists) loop
        if not coalesce(jsonb_typeof(grupo->'nome') = 'string'
            and char_length(btrim(grupo->>'nome')) between 1 and 120
            and jsonb_typeof(grupo->'itens') = 'array', false) then
            raise exception 'Preencha o nome e os itens de cada checklist.';
        end if;
        if jsonb_array_length(grupo->'itens') not between 1 and 30 then
            raise exception 'Cada checklist deve ter entre 1 e 30 itens.';
        end if;
        for item in select value from pg_catalog.jsonb_array_elements(grupo->'itens') loop
            chave := item->>'id';
            if not coalesce(chave ~ '^[a-z0-9_-]{1,80}$' and not (chave = any(chaves))
                and jsonb_typeof(item->'nome') = 'string'
                and char_length(btrim(item->>'nome')) between 1 and 120
                and item->>'tipo' in ('texto', 'confirmacao', 'documento')
                and jsonb_typeof(item->'obrigatorio') = 'boolean', false) then
                raise exception 'Revise os nomes, tipos e identificadores dos itens.';
            end if;
            chaves := array_append(chaves, chave);
        end loop;
    end loop;
    if tg_op = 'UPDATE' then
        new.versao := old.versao + 1;
    else
        new.versao := 1;
    end if;
    return new;
end;
$$;
create trigger cra_validar_modelo before insert or update on public.cra_modelos
    for each row execute function tg_private.validar_cra_modelo();

create function tg_private.criar_cra_modelo_inicial()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
    if new.ativo and not exists (select 1 from public.cra_modelos where admin_id = new.admin_id) then
        insert into public.cra_modelos (admin_id, nome, checklists) values
            (new.admin_id, 'Ligação à CRA', '[
                {"nome":"Documentação","itens":[
                    {"id":"contacto","nome":"Contacto de emergência","tipo":"texto","obrigatorio":true}
                ]},
                {"nome":"Ativação","itens":[
                    {"id":"codigo_cra","nome":"Código de cliente na CRA","tipo":"texto","obrigatorio":true},
                    {"id":"teste_comunicacao","nome":"Teste de comunicação confirmado","tipo":"confirmacao","obrigatorio":true}
                ]}
            ]'::jsonb);
    end if;
    return new;
end;
$$;
create trigger cra_modelo_inicial after insert or update of ativo on public.cra_configuracoes
    for each row execute function tg_private.criar_cra_modelo_inicial();

create table public.cra_contratos (
    id uuid primary key default gen_random_uuid(),
    admin_id text not null references public.administradores(id) on delete cascade,
    cliente_id text not null references public.clientes(id) on delete cascade,
    local_id text references public.locais(id) on delete set null,
    modelo_id uuid not null references public.cra_modelos(id),
    modelo_versao integer not null,
    modelo_nome text not null,
    checklists jsonb not null,
    nome text not null check (char_length(btrim(nome)) between 1 and 120),
    estado text not null default 'preparacao' check (estado in ('preparacao', 'vigente', 'terminado')),
    documento text,
    respostas jsonb not null default '{}'::jsonb,
    revisao integer not null default 1
);
create index cra_contratos_cliente_idx on public.cra_contratos (admin_id, cliente_id, local_id, nome);
create index cra_contratos_vigentes_idx on public.cra_contratos (admin_id) where estado = 'vigente';

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('contratos-prestacao-servicos', 'contratos-prestacao-servicos', false, 15728640,
    array['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']);

create function tg_private.cra_ficheiro_valido(caminho text, empresa text, contrato uuid)
returns boolean language sql stable set search_path = '' as $$
    select split_part(caminho, '/', 1) = empresa
        and split_part(caminho, '/', 2) = contrato::text
        and caminho ~ '/[a-f0-9-]{36}_[^/]+\.(pdf|doc|docx)$'
        and array_length(string_to_array(caminho, '/'), 1) = 3
        and exists (
            select 1 from storage.objects o where o.bucket_id = 'contratos-prestacao-servicos' and o.name = caminho
        );
$$;

create function tg_private.validar_cra_contrato()
returns trigger language plpgsql set search_path = '' as $$
declare
    modelo public.cra_modelos;
    item jsonb;
    resposta jsonb;
    respostas_validas jsonb := '{}'::jsonb;
    mudar_modelo boolean;
begin
    if tg_op = 'INSERT' then
        if not exists (select 1 from public.clientes c where c.id = new.cliente_id and c.admin_id = new.admin_id)
           or (new.local_id is not null and not exists (select 1 from public.locais l
                where l.id = new.local_id and l.admin_id = new.admin_id and l.cliente_id = new.cliente_id)) then
            raise exception 'A instalação deve pertencer ao cliente e à empresa do contrato.';
        end if;
        mudar_modelo := true;
        new.revisao := 1;
    else
        new.revisao := old.revisao + 1;
        if new.local_id is distinct from old.local_id and new.local_id is null then
            -- A eliminação de uma instalação preserva os contratos na sede.
            return new;
        end if;
        mudar_modelo := new.modelo_versao is distinct from old.modelo_versao;
        if mudar_modelo and public.tg_papel() is distinct from 'admin' then
            raise exception 'Só o administrador pode atualizar o modelo num contrato.' using errcode = '42501';
        end if;
    end if;
    if mudar_modelo then
        select * into modelo from public.cra_modelos
        where id = new.modelo_id and admin_id = new.admin_id and ativo and versao = new.modelo_versao;
        if not found then
            raise exception 'O modelo foi alterado. Volte a abrir o formulário.';
        end if;
        new.modelo_nome := modelo.nome;
        new.checklists := modelo.checklists;
    end if;
    if new.documento is not null and not coalesce(tg_private.cra_ficheiro_valido(new.documento, new.admin_id, new.id), false) then
        raise exception 'O documento do contrato está indisponível.';
    end if;
    if jsonb_typeof(new.respostas) is distinct from 'object' then
        raise exception 'Respostas da checklist inválidas.';
    end if;
    for item in select i.value from pg_catalog.jsonb_array_elements(new.checklists) g
        cross join lateral pg_catalog.jsonb_array_elements(g.value->'itens') i loop
        resposta := new.respostas->(item->>'id');
        if resposta is null then continue; end if;
        if not coalesce(case item->>'tipo'
            when 'texto' then jsonb_typeof(resposta) = 'string' and char_length(resposta #>> '{}') <= 2000
            when 'confirmacao' then jsonb_typeof(resposta) = 'boolean'
            when 'documento' then jsonb_typeof(resposta) = 'string'
                and tg_private.cra_ficheiro_valido(resposta #>> '{}', new.admin_id, new.id)
        end, false) then
            raise exception 'Resposta ou documento inválido no item %.', item->>'nome';
        end if;
        respostas_validas := respostas_validas || jsonb_build_object(item->>'id', resposta);
    end loop;
    new.respostas := respostas_validas;
    return new;
end;
$$;
create trigger cra_validar_contrato before insert or update on public.cra_contratos
    for each row execute function tg_private.validar_cra_contrato();

alter table public.cra_configuracoes enable row level security;
alter table public.cra_modelos enable row level security;
alter table public.cra_contratos enable row level security;
revoke all on public.cra_configuracoes, public.cra_modelos, public.cra_contratos from public, anon, authenticated;
grant select, insert on public.cra_configuracoes to authenticated;
grant update (ativo, frequencia, hora, dia_semana) on public.cra_configuracoes to authenticated;
grant select on public.cra_modelos, public.cra_contratos to authenticated;
grant insert (id, admin_id, nome, checklists, ativo), update (nome, checklists, ativo) on public.cra_modelos to authenticated;
grant insert (id, admin_id, cliente_id, local_id, modelo_id, modelo_versao, nome, estado, documento, respostas),
      update (modelo_versao, nome, estado, documento, respostas) on public.cra_contratos to authenticated;

create policy cra_config_ler on public.cra_configuracoes for select to authenticated
    using (tg_private.cra_area_elegivel(admin_id) and (select public.tg_papel()) in ('admin', 'subadmin'));
create policy cra_config_criar on public.cra_configuracoes for insert to authenticated
    with check (tg_private.cra_area_elegivel(admin_id) and (select public.tg_papel()) = 'admin');
create policy cra_config_editar on public.cra_configuracoes for update to authenticated
    using (tg_private.cra_area_elegivel(admin_id) and (select public.tg_papel()) = 'admin')
    with check (tg_private.cra_area_elegivel(admin_id) and (select public.tg_papel()) = 'admin');
create policy cra_modelos_ler on public.cra_modelos for select to authenticated
    using (tg_private.cra_ativo(admin_id) and (select public.tg_papel()) in ('admin', 'subadmin'));
create policy cra_modelos_criar on public.cra_modelos for insert to authenticated
    with check (tg_private.cra_ativo(admin_id) and (select public.tg_papel()) = 'admin');
create policy cra_modelos_editar on public.cra_modelos for update to authenticated
    using (tg_private.cra_ativo(admin_id) and (select public.tg_papel()) = 'admin')
    with check (tg_private.cra_ativo(admin_id) and (select public.tg_papel()) = 'admin');
create policy cra_contratos_ler on public.cra_contratos for select to authenticated
    using (tg_private.cra_ativo(admin_id) and (select public.tg_papel()) in ('admin', 'subadmin'));
create policy cra_contratos_criar on public.cra_contratos for insert to authenticated
    with check (tg_private.cra_ativo(admin_id) and (select public.tg_papel()) in ('admin', 'subadmin'));
create policy cra_contratos_editar on public.cra_contratos for update to authenticated
    using (tg_private.cra_ativo(admin_id) and (select public.tg_papel()) in ('admin', 'subadmin'))
    with check (tg_private.cra_ativo(admin_id) and (select public.tg_papel()) in ('admin', 'subadmin'));

create policy cra_documentos_ler on storage.objects for select to authenticated
    using (bucket_id = 'contratos-prestacao-servicos'
        and tg_private.cra_ativo((storage.foldername(name))[1])
        and (select public.tg_papel()) in ('admin', 'subadmin'));
create policy cra_documentos_carregar on storage.objects for insert to authenticated
    with check (bucket_id = 'contratos-prestacao-servicos'
        and cardinality(storage.foldername(name)) = 2 and (storage.foldername(name))[2] ~ '^[a-f0-9-]{36}$'
        and tg_private.cra_ativo((storage.foldername(name))[1])
        and (select public.tg_papel()) in ('admin', 'subadmin'));
create policy cra_documentos_remover_nao_associados on storage.objects for delete to authenticated
    using (bucket_id = 'contratos-prestacao-servicos'
        and tg_private.cra_ativo((storage.foldername(name))[1])
        and (select public.tg_papel()) in ('admin', 'subadmin')
        and not exists (
            select 1 from public.cra_contratos c
            where c.id::text = (storage.foldername(objects.name))[2]
                and (c.documento = objects.name or exists (
                    select 1 from jsonb_each_text(c.respostas) r where r.value = objects.name
                ))
        ));

create view public.cra_pendencias with (security_invoker = true) as
select c.id, c.admin_id, c.cliente_id, c.local_id, c.nome, c.modelo_nome, faltas.itens
from public.cra_contratos c
cross join lateral (
    select array(
        select 'Documento do contrato' where c.documento is null or
            not coalesce(tg_private.cra_ficheiro_valido(c.documento, c.admin_id, c.id), false)
        union all
        select (g.value->>'nome') || ' · ' || (i.value->>'nome')
        from jsonb_array_elements(c.checklists) g
        cross join lateral jsonb_array_elements(g.value->'itens') i
        where i.value->'obrigatorio' = 'true'::jsonb and
            case i.value->>'tipo'
                when 'confirmacao' then c.respostas->(i.value->>'id') is distinct from 'true'::jsonb
                when 'documento' then not coalesce(
                    tg_private.cra_ficheiro_valido(c.respostas->>(i.value->>'id'), c.admin_id, c.id), false)
                else coalesce(btrim(c.respostas->>(i.value->>'id')), '') = ''
            end
    ) as itens
) faltas
where c.estado = 'vigente' and cardinality(faltas.itens) > 0;
revoke all on public.cra_pendencias from public, anon, authenticated;
grant select on public.cra_pendencias to authenticated;

create table tg_private.cra_alertas_mostrados (
    admin_id text not null references public.administradores(id) on delete cascade,
    usuario_id uuid not null references auth.users(id) on delete cascade,
    frequencia text not null,
    periodo date not null,
    primary key (admin_id, usuario_id, frequencia, periodo)
);
revoke all on tg_private.cra_alertas_mostrados from public, anon, authenticated;

create function public.tg_cra_reservar_alerta()
returns boolean language plpgsql security definer set search_path = '' as $$
declare
    empresa text := public.tg_admin_id();
    utilizador uuid := auth.uid();
    config public.cra_configuracoes;
    agora timestamp := statement_timestamp() at time zone 'Europe/Lisbon';
    periodo date := agora::date;
begin
    if utilizador is null or coalesce(public.tg_papel(), '') not in ('admin', 'subadmin')
        or not coalesce(tg_private.cra_ativo(empresa), false) then
        return false;
    end if;
    select * into config from public.cra_configuracoes where admin_id = empresa and ativo;
    if not found or config.frequencia = 'sem' or agora::time < config.hora then return false; end if;
    if config.frequencia = 'semanal' then
        if extract(isodow from agora) <> config.dia_semana then return false; end if;
        periodo := date_trunc('week', agora)::date;
    end if;
    if not exists (select 1 from public.cra_pendencias where admin_id = empresa) then return false; end if;
    insert into tg_private.cra_alertas_mostrados (admin_id, usuario_id, frequencia, periodo)
        values (empresa, utilizador, config.frequencia, periodo)
        on conflict do nothing;
    return found;
end;
$$;
revoke all on function public.tg_cra_reservar_alerta() from public, anon, authenticated;
grant execute on function public.tg_cra_reservar_alerta() to authenticated;
revoke all on function tg_private.cra_area_elegivel(text), tg_private.cra_ativo(text),
    tg_private.cra_ficheiro_valido(text, text, uuid), tg_private.criar_cra_modelo_inicial()
    from public, anon, authenticated;
grant execute on function tg_private.cra_area_elegivel(text), tg_private.cra_ativo(text),
    tg_private.cra_ficheiro_valido(text, text, uuid) to authenticated;
notify pgrst, 'reload schema';
