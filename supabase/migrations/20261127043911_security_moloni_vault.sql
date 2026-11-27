create table tg_internal.moloni_credenciais (
    admin_id text primary key references public.administradores(id) on delete cascade,
    segredo_id uuid not null unique
);
alter table tg_internal.moloni_credenciais enable row level security;
revoke all on table tg_internal.moloni_credenciais from public, anon, authenticated;

create function public.tg_moloni_guardar(admin text, credenciais jsonb, configuracao jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
    id_segredo uuid;
    publica jsonb;
begin
    select coalesce(a.integracao_faturacao, '{}'::jsonb) into strict publica
    from public.administradores a where a.id = admin for update;

    select m.segredo_id into id_segredo from tg_internal.moloni_credenciais m where m.admin_id = admin;
    if credenciais is not null then
        if id_segredo is null then
            id_segredo := vault.create_secret(credenciais::text);
            insert into tg_internal.moloni_credenciais(admin_id, segredo_id) values (admin, id_segredo);
        else
            perform vault.update_secret(id_segredo, credenciais::text);
        end if;
    end if;
    if id_segredo is null then
        raise invalid_parameter_value using message = 'Introduza as credenciais da Moloni.';
    end if;

    publica := jsonb_build_object(
        'provider', 'moloni',
        'simulacao', configuracao->'simulacao',
        'phcDrafts', coalesce(publica->'phcDrafts', '{}'::jsonb),
        'moloni', jsonb_build_object(
            'configurada', true,
            'companyId', configuracao->>'companyId',
            'documentSetId', configuracao->>'documentSetId'
        )
    );
    update public.administradores set integracao_faturacao = publica where id = admin;
    return publica;
end
$$;
revoke all on function public.tg_moloni_guardar(text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.tg_moloni_guardar(text, jsonb, jsonb) to service_role;

create function public.tg_moloni_credenciais(admin text)
returns jsonb
language sql stable security definer set search_path = ''
as $$
    select v.decrypted_secret::jsonb
    from tg_internal.moloni_credenciais m join vault.decrypted_secrets v on v.id = m.segredo_id
    where m.admin_id = admin
$$;
revoke all on function public.tg_moloni_credenciais(text) from public, anon, authenticated;
grant execute on function public.tg_moloni_credenciais(text) to service_role;

create function tg_internal.proteger_configuracao_moloni()
returns trigger
language plpgsql security invoker set search_path = ''
as $$
begin
    if current_user in ('anon','authenticated') and new.integracao_faturacao->'moloni' is not null then
        if tg_op = 'INSERT' or old.integracao_faturacao is distinct from new.integracao_faturacao then
            raise insufficient_privilege using message = 'Guarde a configuração Moloni na integração de faturação.';
        end if;
    end if;
    return new;
end
$$;
revoke all on function tg_internal.proteger_configuracao_moloni() from public, anon, authenticated;
create trigger proteger_configuracao_moloni before insert or update of integracao_faturacao on public.administradores
for each row execute function tg_internal.proteger_configuracao_moloni();
