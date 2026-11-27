create table tg_internal.ficheiros_revisao_empresa (
  caminho text primary key,
  admin_id text not null,
  tipo text not null check (tipo in ('os_fotos', 'passaportes')),
  registo_id text not null,
  carregado_em timestamptz not null
);
alter table tg_internal.ficheiros_revisao_empresa enable row level security;
revoke all on table tg_internal.ficheiros_revisao_empresa from public, anon, authenticated;

do $$
declare fotos integer; passaportes integer;
begin
  insert into tg_internal.ficheiros_revisao_empresa (caminho,admin_id,tipo,registo_id,carregado_em)
  select o.name, r.admin_id, r.tipo, r.id, o.created_at
  from storage.objects o
  join lateral (
    select s.admin_id,s.id,'os_fotos'::text as tipo from public.servicos s
    where split_part(o.name,'/',1)='os_fotos' and s.id=split_part(o.name,'/',2)
    union all
    select c.admin_id,c.id,'passaportes'::text from public.clientes c
    where split_part(o.name,'/',1)='passaportes' and c.id=split_part(o.name,'/',3)
      and c.admin_id=split_part(o.name,'/',2)
  ) r on true
  join public.administradores a on a.id=r.admin_id
  join public.perfis p on p.id::text=o.owner_id and p.papel<>'superadmin'
    and (case when p.papel='admin' then p.registo_id else p.admin_id end)=r.admin_id
  join auth.users u on u.id=p.id and u.created_at<=o.created_at
  where o.bucket_id='ficheiros'
    and not exists (select 1 from tg_internal.ficheiros_legados f where f.caminho=o.name);

  select count(*) filter(where tipo='os_fotos'),count(*) filter(where tipo='passaportes')
  into fotos,passaportes from tg_internal.ficheiros_revisao_empresa;
  if fotos<>2 or passaportes<>1 then
    raise exception 'A contagem de ficheiros confirmados não corresponde ao inventário revisto';
  end if;
end
$$;

create function tg_internal.ficheiro_disponivel_para_revisao(caminho text)
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
      end)
  )
$$;
revoke all on function tg_internal.ficheiro_disponivel_para_revisao(text) from public, anon, authenticated;
grant execute on function tg_internal.ficheiro_disponivel_para_revisao(text) to authenticated;

create function public.tg_ficheiros_em_revisao()
returns table (caminho text, tipo text, carregado_em timestamptz, numero_os text)
language sql stable security definer set search_path = ''
as $$
  select r.caminho,r.tipo,r.carregado_em,to_jsonb(s)->>'numero'
  from tg_internal.ficheiros_revisao_empresa r
  join storage.objects o on o.bucket_id='ficheiros' and o.name=r.caminho
  left join public.servicos s on r.tipo='os_fotos' and s.id=r.registo_id and s.admin_id=r.admin_id
  where tg_internal.ficheiro_disponivel_para_revisao(r.caminho)
  order by r.carregado_em desc, r.caminho
$$;
revoke all on function public.tg_ficheiros_em_revisao() from public, anon, authenticated;
grant execute on function public.tg_ficheiros_em_revisao() to authenticated;

create policy ficheiros_revisao_gestor on storage.objects for select to authenticated
using (bucket_id='ficheiros' and tg_internal.ficheiro_disponivel_para_revisao(name));
