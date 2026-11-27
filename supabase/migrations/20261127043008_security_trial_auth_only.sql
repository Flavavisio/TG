create or replace function public.tg_conta_auth_trial(pedido uuid)
returns table(id uuid, created_at timestamptz)
language sql stable security invoker set search_path = ''
as $$
    select u.id, u.created_at
    from auth.users u
    join public.pedidos_trial p on lower(u.email) = lower(p.email)
    where p.id = pedido and u.raw_app_meta_data->>'pedido_trial_id' = pedido::text
    limit 1
$$;
revoke all on function public.tg_conta_auth_trial(uuid) from public, anon, authenticated;
grant execute on function public.tg_conta_auth_trial(uuid) to service_role;
grant select (id, created_at, email, raw_app_meta_data) on auth.users to service_role;
alter table public.pedidos_trial
    add constraint pedidos_trial_sem_senha check (senha_pendente is null) not valid;
