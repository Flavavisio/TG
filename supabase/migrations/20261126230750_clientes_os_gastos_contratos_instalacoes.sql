alter table public.clientes
    add constraint clientes_numero_cliente_15_digitos
    check (numero_cliente is null or numero_cliente = '' or numero_cliente ~ '^[0-9]{1,15}$');

create table public.obra_outros_gastos (
    id uuid primary key default gen_random_uuid(),
    obra_id text not null references public.obras (id) on delete cascade,
    admin_id text not null,
    descricao text not null check (char_length(btrim(descricao)) between 1 and 200),
    valor_centimos integer not null check (valor_centimos between 1 and 999999999),
    criado_em timestamptz not null default now()
);

create index obra_outros_gastos_obra_idx on public.obra_outros_gastos (obra_id, criado_em, id);
alter table public.obra_outros_gastos enable row level security;
revoke all on public.obra_outros_gastos from public, anon, authenticated;
grant select, delete on public.obra_outros_gastos to authenticated;
grant insert (id, obra_id, admin_id, descricao, valor_centimos),
      update (descricao, valor_centimos) on public.obra_outros_gastos to authenticated;

create policy obra_outros_gastos_gestores on public.obra_outros_gastos
    for all to authenticated
    using (
        admin_id = (select public.tg_admin_id())
        and (select public.tg_papel()) in ('admin', 'subadmin')
    )
    with check (
        admin_id = (select public.tg_admin_id())
        and (select public.tg_papel()) in ('admin', 'subadmin')
        and exists (
            select 1 from public.obras o
            where o.id = obra_outros_gastos.obra_id and o.admin_id = obra_outros_gastos.admin_id
        )
    );

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('contratos-instalacoes', 'contratos-instalacoes', false, 15728640,
    array['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']);

create policy contratos_instalacoes_gestores on storage.objects
    for all to authenticated
    using (
        bucket_id = 'contratos-instalacoes'
        and (storage.foldername(name))[1] = (select public.tg_admin_id())
        and (select public.tg_papel()) in ('admin', 'subadmin')
    )
    with check (
        bucket_id = 'contratos-instalacoes'
        and cardinality(storage.foldername(name)) = 3
        and (storage.foldername(name))[1] = (select public.tg_admin_id())
        and (select public.tg_papel()) in ('admin', 'subadmin')
        and exists (
            select 1 from public.clientes c
            where c.id = (storage.foldername(objects.name))[2]
              and c.admin_id = (storage.foldername(objects.name))[1]
              and ((storage.foldername(objects.name))[3] = '__sede' or exists (
                  select 1 from public.locais l
                  where l.id = (storage.foldername(objects.name))[3]
                    and l.cliente_id = c.id and l.admin_id = c.admin_id
              ))
        )
    );

-- Desvincula os inquéritos da OS apagada e preserva as respostas já recebidas.
alter table public.inqueritos_satisfacao_os
    alter column servico_id drop not null,
    drop constraint inqueritos_satisfacao_os_servico_id_fkey,
    add constraint inqueritos_satisfacao_os_servico_id_fkey
        foreign key (servico_id) references public.servicos (id) on delete set null;

create function tg_private.expirar_inquerito_de_os_apagada()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    if new.servico_id is null and new.respondido_em is distinct from old.respondido_em then
        raise exception 'A ordem de serviço deste inquérito foi apagada.' using errcode = '23514';
    end if;
    if old.servico_id is not null and new.servico_id is null and new.respondido_em is null then
        new.expira_em := least(new.expira_em, pg_catalog.now());
    end if;
    return new;
end;
$$;

create trigger expirar_inquerito_de_os_apagada
before update of servico_id, respondido_em on public.inqueritos_satisfacao_os
for each row execute function tg_private.expirar_inquerito_de_os_apagada();

create function public.tg_apagar_ordem_servico(p_os_id text)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
    empresa text := public.tg_admin_id();
begin
    if empresa is null or coalesce(public.tg_papel(), '') not in ('admin', 'subadmin') then
        raise exception 'Sem permissão para apagar ordens de serviço.' using errcode = '42501';
    end if;

    perform 1 from public.servicos where id = p_os_id and admin_id = empresa for update;
    if not found then return false; end if;

    delete from public.folhas_obra where servico_id = p_os_id and admin_id = empresa;
    delete from public.relatorios_especialidade where servico_id = p_os_id and admin_id = empresa;
    delete from public.ponto where servico_id = p_os_id and admin_id = empresa;
    -- As relações com assistências, requisições e inquéritos são limpas pelas FKs.
    delete from public.servicos where id = p_os_id and admin_id = empresa;
    if not found then
        raise exception 'Não foi possível confirmar a eliminação da ordem de serviço.' using errcode = '42501';
    end if;
    return true;
end;
$$;

revoke all on function public.tg_apagar_ordem_servico(text) from public, anon, authenticated;
grant execute on function public.tg_apagar_ordem_servico(text) to authenticated;
