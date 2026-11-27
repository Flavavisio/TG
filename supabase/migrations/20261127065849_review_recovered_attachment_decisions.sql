alter table tg_internal.ficheiros_revisao_empresa
  add column estado text not null default 'pendente'
    check (estado in ('pendente','validado','arquivado')),
  add column atualizado_por uuid,
  add column atualizado_em timestamptz;

create function public.tg_listar_ficheiros_revisao()
returns table (caminho text, tipo text, carregado_em timestamptz, numero_os text, estado text)
language sql stable security definer set search_path = ''
as $$
  select r.caminho,r.tipo,r.carregado_em,to_jsonb(s)->>'numero',r.estado
  from tg_internal.ficheiros_revisao_empresa r
  join storage.objects o on o.bucket_id='ficheiros' and o.name=r.caminho
  left join public.servicos s on r.tipo='os_fotos' and s.id=r.registo_id and s.admin_id=r.admin_id
  where tg_internal.ficheiro_disponivel_para_revisao(r.caminho)
  order by r.carregado_em desc,r.caminho
$$;
revoke all on function public.tg_listar_ficheiros_revisao() from public, anon, authenticated;
grant execute on function public.tg_listar_ficheiros_revisao() to authenticated;

create or replace function public.tg_ficheiros_em_revisao()
returns table (caminho text, tipo text, carregado_em timestamptz, numero_os text)
language sql stable security definer set search_path = ''
as $$
  select r.caminho,r.tipo,r.carregado_em,r.numero_os
  from public.tg_listar_ficheiros_revisao() r where r.estado='pendente'
$$;

create function public.tg_decidir_ficheiro_revisao(p_caminho text, p_anterior text, p_estado text)
returns boolean
language plpgsql security definer set search_path = ''
as $$
begin
  if not coalesce(
    (p_anterior='pendente' and p_estado in ('validado','arquivado')) or
    (p_anterior in ('validado','arquivado') and p_estado='pendente'),
    false
  ) then
    raise invalid_parameter_value using message='Decisão de revisão inválida.';
  end if;
  if not tg_internal.ficheiro_disponivel_para_revisao(p_caminho) then
    raise insufficient_privilege using message='O ficheiro não está disponível para revisão.';
  end if;
  update tg_internal.ficheiros_revisao_empresa r
  set estado=p_estado, atualizado_por=(select auth.uid()), atualizado_em=statement_timestamp()
  where r.caminho=p_caminho and r.estado=p_anterior
    and exists (select 1 from storage.objects o where o.bucket_id='ficheiros' and o.name=r.caminho);
  if found then return true; end if;
  -- Allow a retry after a committed response was lost.
  return exists (
    select 1 from tg_internal.ficheiros_revisao_empresa r
    join storage.objects o on o.bucket_id='ficheiros' and o.name=r.caminho
    where r.caminho=p_caminho and r.estado=p_estado and r.atualizado_por=(select auth.uid())
  );
end
$$;
revoke all on function public.tg_decidir_ficheiro_revisao(text,text,text) from public, anon, authenticated;
grant execute on function public.tg_decidir_ficheiro_revisao(text,text,text) to authenticated;
