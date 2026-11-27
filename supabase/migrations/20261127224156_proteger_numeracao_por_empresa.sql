create or replace function public.proximo_numero(p_admin text, p_chave text)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
    v bigint;
begin
    if current_setting('role', true) is distinct from 'service_role'
       and not public.tg_superadmin()
       and (auth.uid() is null
            or public.tg_papel() is null
            or public.tg_papel() = 'cliente'
            or p_admin is distinct from public.tg_admin_id()) then
        raise insufficient_privilege using message = 'Sem acesso à numeração desta empresa.';
    end if;
    if p_admin is null or btrim(p_admin) = '' or p_chave is null
       or btrim(p_chave) = '' or char_length(p_chave) > 128 then
        raise invalid_parameter_value using message = 'Empresa ou série de numeração inválida.';
    end if;

    insert into public.contadores (admin_id, chave, valor)
    values (p_admin, p_chave, 1)
    on conflict (admin_id, chave) do update
    set valor = contadores.valor + 1
    returning valor into v;
    return v;
end;
$$;

revoke execute on function public.proximo_numero(text, text) from public, anon;
grant execute on function public.proximo_numero(text, text) to authenticated, service_role;
