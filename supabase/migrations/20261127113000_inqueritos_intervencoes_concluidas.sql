alter table public.inqueritos_satisfacao_os
    add column obra_id text references public.obras(id) on delete set null,
    add constraint inquerito_obra_unico unique (admin_id, obra_id),
    add constraint inquerito_intervencao_exclusiva check (num_nonnulls(servico_id, obra_id) <= 1);

create function tg_private.inquerito_intervencao_concluida(empresa text, cliente text, os_id text, obra text)
returns boolean language sql stable set search_path = '' as $$
    select case
        when os_id is not null and obra is null then exists (
            select 1 from public.servicos s
            where s.id = os_id and s.admin_id = empresa and s.cliente_id = cliente
                and s.status in ('concluído', 'concluido')
        )
        when obra is not null and os_id is null then exists (
            select 1 from public.obras o
            where o.id = obra and o.admin_id = empresa and o.cliente_id = cliente
                and o.estado in ('concluída', 'concluida')
        )
        else false
    end;
$$;

revoke all on function tg_private.inquerito_intervencao_concluida(text,text,text,text) from public, anon;
grant execute on function tg_private.inquerito_intervencao_concluida(text,text,text,text) to authenticated, service_role;

alter policy inqueritos_insert_gestores on public.inqueritos_satisfacao_os
with check (
    admin_id = (select public.tg_admin_id())
    and (select public.tg_papel()) in ('admin','subadmin')
    and tg_private.inquerito_intervencao_concluida(admin_id, cliente_id, servico_id, obra_id)
);

alter policy inqueritos_select_gestores on public.inqueritos_satisfacao_os
using (
    admin_id = (select public.tg_admin_id())
    and (select public.tg_papel()) in ('admin','subadmin')
    and (
        tg_private.inquerito_intervencao_concluida(admin_id, cliente_id, servico_id, obra_id)
        or (servico_id is null and obra_id is null and respondido_em is not null)
    )
);

create or replace function tg_private.expirar_inquerito_de_os_apagada()
returns trigger language plpgsql set search_path = '' as $$
begin
    if tg_op = 'UPDATE' then
        if new.servico_id is null and new.obra_id is null
            and (old.servico_id is not null or old.obra_id is not null)
            and new.respondido_em is not distinct from old.respondido_em then
            if new.respondido_em is null then
                new.expira_em := least(new.expira_em, pg_catalog.now());
            end if;
            return new;
        end if;
    end if;

    -- Bloqueia a reabertura concorrente enquanto a resposta é gravada.
    if new.servico_id is not null then
        perform 1 from public.servicos s where s.id = new.servico_id for share;
    elsif new.obra_id is not null then
        perform 1 from public.obras o where o.id = new.obra_id for share;
    end if;
    if not tg_private.inquerito_intervencao_concluida(new.admin_id, new.cliente_id, new.servico_id, new.obra_id) then
        raise exception 'O inquérito só está disponível após concluir a intervenção.' using errcode = '23514';
    end if;
    return new;
end;
$$;

-- As alterações de identidade também passam pela verificação de empresa, cliente e estado.
drop trigger expirar_inquerito_de_os_apagada on public.inqueritos_satisfacao_os;
create trigger expirar_inquerito_de_os_apagada
before insert or update of servico_id, obra_id, admin_id, cliente_id, respondido_em
on public.inqueritos_satisfacao_os
for each row execute function tg_private.expirar_inquerito_de_os_apagada();

notify pgrst, 'reload schema';
