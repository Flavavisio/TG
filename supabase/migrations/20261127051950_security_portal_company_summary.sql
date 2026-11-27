create function public.tg_portal_empresa()
returns table (
  id text, nome text, empresa text, nome_fiscal text, logo text, ativo boolean,
  assist_plano text, assist_expiracao timestamptz, contratos_plano text,
  contratos_expiracao timestamptz, cor_corporativa text
)
language sql stable security definer set search_path = ''
as $$
  select a.id, a.nome, a.empresa, a.nome_fiscal, a.logo, a.ativo,
    a.assist_plano, a.assist_expiracao, a.contratos_plano, a.contratos_expiracao, a.cor_corporativa
  from public.administradores a
  where a.id = (select public.tg_admin_id()) and (select public.tg_portal_ativo())
$$;
revoke all on function public.tg_portal_empresa() from public, anon, authenticated;
grant execute on function public.tg_portal_empresa() to authenticated;
