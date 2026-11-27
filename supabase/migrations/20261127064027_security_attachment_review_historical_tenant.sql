alter table tg_internal.ficheiros_revisao_empresa
  alter column registo_id drop not null,
  drop constraint ficheiros_revisao_empresa_tipo_check,
  add constraint ficheiros_revisao_empresa_tipo_check check (
    (registo_id is not null and tipo in ('os_fotos','passaportes'))
    or (registo_id is null and tipo in ('folhasObra','obras','pedidos','relatoriosEspecialidade','veiculoDocumentos'))
  );

do $$
declare total integer;
begin
  with r as (
select o.name,o.created_at,o.metadata,p.registo_id,p.id::text uid,case when p.papel='admin' then p.registo_id else p.admin_id end empresa, split_part(o.name,'/',1) pasta
from storage.objects o join public.perfis p on p.id::text=o.owner_id and p.papel<>'superadmin'
join auth.users u on u.id=p.id and u.created_at<=o.created_at
left join tg_internal.ficheiros_legados f on f.caminho=o.name left join tg_internal.ficheiros_revisao_empresa v on v.caminho=o.name
where o.bucket_id='ficheiros' and f.caminho is null and v.caminho is null and split_part(o.name,'/',1) not in ('administradores','config','tg-verificacao')),
coinc as (
select r.name,coalesce(f.admin_id,split_part(o.name,'/',1)) empresa, r.empresa=coalesce(f.admin_id,split_part(o.name,'/',1)) mesma
from r join storage.objects o on o.metadata->>'eTag'=r.metadata->>'eTag' and o.metadata->>'size'=r.metadata->>'size'
left join tg_internal.ficheiros_legados f on o.bucket_id='ficheiros' and f.caminho=o.name
where f.caminho is not null
or (o.bucket_id='relatorios-especialidade' and (
exists (select 1 from public.relatorios_especialidade e where e.admin_id=split_part(o.name,'/',1) and (o.name in (e.assinatura_cliente_path,e.assinatura_tecnico_path) or o.name=e.campos->>'htmlSnapshotPath'))
or exists (select 1 from public.folhas_obra e where e.admin_id=split_part(o.name,'/',1) and o.name=e.assinatura_path)
))
or (o.bucket_id='anexos-privados' and exists (select 1 from tg_internal.ficheiros_registos ref where ref.admin_id=split_part(o.name,'/',1) and ref.tipo=split_part(o.name,'/',2) and ref.registo=split_part(o.name,'/',3) and jsonb_path_exists(ref.referencias,'$.** ? (@ == $url)',jsonb_build_object('url','https://rfniufasivfnrqfntzog.supabase.co/storage/v1/object/public/anexos-privados/'||o.name))))
), duplicados as (select name from coinc group by name having count(distinct empresa)=1 and bool_or(mesma)),
sinais as (select r.*, exists(select 1 from public.auditoria a where a.admin_id=r.empresa and a.utilizador_id in (r.registo_id,r.uid) and a.data between r.created_at-interval '2 minutes' and r.created_at+interval '2 minutes') as historico,
exists(select 1 from public.auditoria a where a.admin_id is distinct from r.empresa and a.utilizador_id in (r.registo_id,r.uid) and a.data between r.created_at-interval '1 day' and r.created_at+interval '1 day') as conflito
from r where not exists(select 1 from duplicados d where d.name=r.name))
  insert into tg_internal.ficheiros_revisao_empresa(caminho,admin_id,tipo,registo_id,carregado_em)
  select s.name,s.empresa,s.pasta,null,s.created_at
  from sinais s join public.administradores a on a.id=s.empresa and a.ativo is true
  where s.historico and not s.conflito;
  get diagnostics total = row_count;
  if total <> 11 then raise exception 'A lista de ficheiros corroborados pela auditoria mudou'; end if;
end
$$;

create or replace function tg_internal.ficheiro_disponivel_para_revisao(caminho text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from tg_internal.ficheiros_revisao_empresa r
    join public.perfis p on p.id = (select auth.uid()) and p.papel='admin' and p.registo_id=r.admin_id
    join public.administradores a on a.id=r.admin_id and a.ativo is true
    where r.caminho=$1
      and (case r.tipo
        when 'os_fotos' then exists (select 1 from public.servicos s where s.id=r.registo_id and s.admin_id=r.admin_id)
        when 'passaportes' then exists (select 1 from public.clientes c where c.id=r.registo_id and c.admin_id=r.admin_id)
        else r.registo_id is null
      end)
  )
$$;
