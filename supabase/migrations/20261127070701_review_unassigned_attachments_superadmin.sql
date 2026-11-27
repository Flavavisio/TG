alter table tg_internal.ficheiros_revisao_empresa
  drop constraint ficheiros_revisao_empresa_tipo_check,
  add constraint ficheiros_revisao_empresa_tipo_check check (
    (registo_id is not null and tipo in ('os_fotos','passaportes'))
    or (registo_id is null and tipo in ('folhasObra','obras','pedidos','relatoriosEspecialidade','veiculoDocumentos','requisicoes','encomendas','contratos-documentos'))
  );

create table tg_internal.ficheiros_triagem_superadmin (
  caminho text primary key,
  tipo text not null check (tipo in ('folhasObra','obras','pedidos','relatoriosEspecialidade','veiculoDocumentos','requisicoes','encomendas','contratos-documentos')),
  carregado_em timestamptz not null,
  empresa_sugerida text,
  duplicado boolean not null,
  estado text not null default 'pendente' check (estado in ('pendente','arquivado','encaminhado')),
  empresa_destino text,
  atualizado_por uuid,
  atualizado_em timestamptz,
  check ((estado='encaminhado') = (empresa_destino is not null))
);
alter table tg_internal.ficheiros_triagem_superadmin enable row level security;
revoke all on table tg_internal.ficheiros_triagem_superadmin from public, anon, authenticated;

do $$
declare total integer; repetidos integer;
begin
  with candidatos as (
    select o.name,o.created_at,o.metadata,split_part(o.name,'/',1) tipo,
      case when u.id is not null and p.papel<>'superadmin'
        then case when p.papel='admin' then p.registo_id else p.admin_id end end as empresa
    from storage.objects o
    left join public.perfis p on p.id::text=o.owner_id
    left join auth.users u on u.id=p.id and u.created_at<=o.created_at
    left join tg_internal.ficheiros_legados f on f.caminho=o.name
    left join tg_internal.ficheiros_revisao_empresa v on v.caminho=o.name
    where o.bucket_id='ficheiros' and f.caminho is null and v.caminho is null
      and split_part(o.name,'/',1) in ('folhasObra','obras','pedidos','relatoriosEspecialidade','veiculoDocumentos','requisicoes','encomendas','contratos-documentos')
  ), coincidencias as (
    select r.name,coalesce(f.admin_id,split_part(o.name,'/',1)) empresa,
      r.empresa=coalesce(f.admin_id,split_part(o.name,'/',1)) mesma
    from candidatos r join storage.objects o on o.metadata->>'eTag'=r.metadata->>'eTag' and o.metadata->>'size'=r.metadata->>'size'
    left join tg_internal.ficheiros_legados f on o.bucket_id='ficheiros' and f.caminho=o.name
    where r.empresa is not null and (f.caminho is not null
      or (o.bucket_id='relatorios-especialidade' and (
        exists (select 1 from public.relatorios_especialidade e where e.admin_id=split_part(o.name,'/',1)
          and (o.name in (e.assinatura_cliente_path,e.assinatura_tecnico_path) or o.name=e.campos->>'htmlSnapshotPath'))
        or exists (select 1 from public.folhas_obra e where e.admin_id=split_part(o.name,'/',1) and o.name=e.assinatura_path)))
      or (o.bucket_id='anexos-privados' and exists (
        select 1 from tg_internal.ficheiros_registos ref where ref.admin_id=split_part(o.name,'/',1)
        and ref.tipo=split_part(o.name,'/',2) and ref.registo=split_part(o.name,'/',3)
        and jsonb_path_exists(ref.referencias,'$.** ? (@ == $url)',jsonb_build_object('url','https://rfniufasivfnrqfntzog.supabase.co/storage/v1/object/public/anexos-privados/'||o.name)))))
  ), duplicados as (select name from coincidencias group by name having count(distinct empresa)=1 and bool_or(mesma))
  insert into tg_internal.ficheiros_triagem_superadmin(caminho,tipo,carregado_em,empresa_sugerida,duplicado)
  select c.name,c.tipo,c.created_at,c.empresa,d.name is not null
  from candidatos c left join duplicados d on d.name=c.name;
  get diagnostics total = row_count;
  select count(*) into repetidos from tg_internal.ficheiros_triagem_superadmin where duplicado;
  if total<>42 or repetidos<>6 then
    raise exception 'O inventário de revisão mudou. Confirme os ficheiros antes de abrir a triagem.';
  end if;
end
$$;

create function public.tg_listar_ficheiros_triagem()
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select case when (select public.tg_superadmin()) then jsonb_build_object(
    'empresas', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',a.id,'nome',coalesce(nullif(a.empresa,''),nullif(a.nome_fiscal,''),a.nome)
      ) order by coalesce(nullif(a.empresa,''),nullif(a.nome_fiscal,''),a.nome),a.id)
      from public.administradores a where a.id<>'superadmin' and a.ativo is true
    ), '[]'::jsonb),
    'ficheiros', coalesce((
      select jsonb_agg(jsonb_build_object(
        'caminho',t.caminho,'tipo',t.tipo,'carregado_em',t.carregado_em,'estado',t.estado,'duplicado',t.duplicado,
        'empresa_sugerida',coalesce(nullif(s.empresa,''),nullif(s.nome_fiscal,''),s.nome),
        'empresa_destino',coalesce(nullif(d.empresa,''),nullif(d.nome_fiscal,''),d.nome)
      ) order by t.carregado_em desc,t.caminho)
      from tg_internal.ficheiros_triagem_superadmin t
      join storage.objects o on o.bucket_id='ficheiros' and o.name=t.caminho
      left join public.administradores s on s.id=t.empresa_sugerida
      left join public.administradores d on d.id=t.empresa_destino
    ), '[]'::jsonb)
  ) else null end
$$;
revoke all on function public.tg_listar_ficheiros_triagem() from public, anon, authenticated;
grant execute on function public.tg_listar_ficheiros_triagem() to authenticated;

create function public.tg_decidir_ficheiro_triagem(p_caminho text, p_anterior text, p_estado text, p_empresa text default null)
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare atual tg_internal.ficheiros_triagem_superadmin%rowtype;
begin
  if not coalesce((select public.tg_superadmin()),false) then
    raise insufficient_privilege using message='A triagem é reservada ao Super Admin.';
  end if;
  if not coalesce(
    ((p_anterior='pendente' and p_estado in ('arquivado','encaminhado'))
      or (p_anterior='arquivado' and p_estado='pendente'))
    and ((p_estado='encaminhado')=(p_empresa is not null)),false
  ) then
    raise invalid_parameter_value using message='Decisão de triagem inválida.';
  end if;

  select t.* into atual
  from tg_internal.ficheiros_triagem_superadmin t
  join storage.objects o on o.bucket_id='ficheiros' and o.name=t.caminho
  where t.caminho=p_caminho for update of t;
  if not found then return false; end if;
  if atual.estado=p_estado and atual.empresa_destino is not distinct from p_empresa
    and atual.atualizado_por=(select auth.uid()) then return true; end if;
  if atual.estado is distinct from p_anterior then return false; end if;

  if p_estado='encaminhado' then
    if atual.duplicado then
      raise invalid_parameter_value using message='Os duplicados podem ser arquivados.';
    end if;
    if not exists(select 1 from public.administradores a where a.id=p_empresa and a.id<>'superadmin' and a.ativo is true) then
      raise invalid_parameter_value using message='Selecione uma empresa ativa.';
    end if;
    insert into tg_internal.ficheiros_revisao_empresa (caminho,admin_id,tipo,registo_id,carregado_em)
    values(atual.caminho,p_empresa,atual.tipo,null,atual.carregado_em)
    on conflict (caminho) do nothing;
    if not found then return false; end if;
  end if;

  update tg_internal.ficheiros_triagem_superadmin
  set estado=p_estado,empresa_destino=p_empresa,atualizado_por=(select auth.uid()),atualizado_em=statement_timestamp()
  where caminho=p_caminho;
  return true;
end
$$;
revoke all on function public.tg_decidir_ficheiro_triagem(text,text,text,text) from public, anon, authenticated;
grant execute on function public.tg_decidir_ficheiro_triagem(text,text,text,text) to authenticated;
