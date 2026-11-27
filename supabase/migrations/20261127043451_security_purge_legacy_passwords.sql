create or replace function tg_internal.descartar_senha_legada_tg()
returns trigger
language plpgsql security invoker set search_path = ''
as $$
begin
    new.senha := null;
    return new;
end
$$;
revoke all on function tg_internal.descartar_senha_legada_tg() from public, anon, authenticated;

do $$
declare
    tabela text;
begin
    foreach tabela in array array['administradores','funcionarios','encarregados','clientes','config_superadmin']
    loop
        execute format('create trigger descartar_senha_legada_tg before insert or update of senha on public.%I for each row execute function tg_internal.descartar_senha_legada_tg()', tabela);
        execute format('update public.%I set senha = null where senha is not null', tabela);
    end loop;
end
$$;

update public.pedidos_trial set senha_pendente = null where senha_pendente is not null;
alter table public.pedidos_trial validate constraint pedidos_trial_sem_senha;
