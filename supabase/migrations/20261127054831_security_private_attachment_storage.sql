-- Keep the original paths as stable references. File bytes are managed by the Storage API.
create view tg_internal.ficheiros_registos
with (security_invoker = true) as
select admin_id, 'ponto'::text as tipo, to_jsonb(foto) as referencias from public.ponto
union all select admin_id, 'pedidos', jsonb_build_array(anexo, anexo_admin) from public.pedidos
union all select admin_id, 'requisicoes', to_jsonb(anexo) from public.requisicoes
union all select admin_id, 'veiculoDocumentos', to_jsonb(ficheiro) from public.veiculo_documentos
union all select admin_id, 'funcionarios', to_jsonb(foto) from public.funcionarios
union all select admin_id, 'folhasObra', to_jsonb(assinatura) from public.folhas_obra
union all select admin_id, 'relatoriosEspecialidade', jsonb_build_array(assinatura_cliente, assinatura_tecnico) from public.relatorios_especialidade
union all select admin_id, 'encomendas', to_jsonb(fatura) from public.encomendas
union all select admin_id, 'os_fotos', jsonb_build_array(fotos, passaporte_intervencao) from public.servicos
union all select admin_id, 'contratos-documentos', to_jsonb(documento_url) from public.contratos
  where not coalesce(public.tg_e_cliente(), false)
union all select admin_id, 'obras', to_jsonb(url) from public.obra_documentos
union all select admin_id, 'obras', to_jsonb(fotos) from public.obras
union all select admin_id, 'passaportes', passaporte_tecnico from public.clientes
union all select admin_id, 'passaportes', passaporte_tecnico from public.locais;

revoke all on tg_internal.ficheiros_registos from public, anon, authenticated;
grant usage on schema tg_internal to authenticated;
grant select on tg_internal.ficheiros_registos to authenticated;

-- The legacy list is frozen from records that actually reference each original object.
-- A later change to an unrelated record must never link another tenant's historical file.
create table tg_internal.ficheiros_legados (
  caminho text primary key,
  admin_id text not null
);
alter table tg_internal.ficheiros_legados enable row level security;
revoke all on table tg_internal.ficheiros_legados from public, anon, authenticated;

create function tg_internal.ficheiros_indexar_legados()
returns integer
language plpgsql security definer set search_path = ''
as $$
declare afetados integer;
begin
  insert into tg_internal.ficheiros_legados (caminho, admin_id)
  select o.name, min(r.admin_id)
  from storage.objects o
  join tg_internal.ficheiros_registos r on r.tipo = split_part(o.name, '/', 1)
    and jsonb_path_exists(r.referencias, '$.** ? (@ == $url)', jsonb_build_object('url',
      'https://rfniufasivfnrqfntzog.supabase.co/storage/v1/object/public/ficheiros/' || o.name))
  where o.bucket_id = 'ficheiros' and r.admin_id is not null
  group by o.name having count(distinct r.admin_id) = 1
  on conflict (caminho) do nothing;
  get diagnostics afetados = row_count;
  return afetados;
end
$$;
revoke all on function tg_internal.ficheiros_indexar_legados() from public, anon, authenticated;
select tg_internal.ficheiros_indexar_legados();

create function tg_internal.ficheiro_legado_da_empresa(caminho text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from tg_internal.ficheiros_legados f
    where f.caminho = $1 and f.admin_id = (select public.tg_admin_id())
  )
$$;
revoke all on function tg_internal.ficheiro_legado_da_empresa(text) from public, anon, authenticated;
grant execute on function tg_internal.ficheiro_legado_da_empresa(text) to authenticated;

create function tg_internal.ficheiro_referenciado(bucket text, caminho text, tipo text)
returns boolean
language sql stable security invoker set search_path = ''
as $$
  select exists (
    select 1 from tg_internal.ficheiros_registos r
    where r.admin_id = (select public.tg_admin_id()) and r.tipo = $3
      and jsonb_path_exists(r.referencias, '$.** ? (@ == $url)', jsonb_build_object('url',
        'https://rfniufasivfnrqfntzog.supabase.co/storage/v1/object/public/' || $1 || '/' || $2))
  )
$$;
revoke all on function tg_internal.ficheiro_referenciado(text,text,text) from public, anon, authenticated;
grant execute on function tg_internal.ficheiro_referenciado(text,text,text) to authenticated;

alter policy ficheiros_ler on storage.objects to authenticated using (
  bucket_id = 'ficheiros' and (
    (select public.tg_superadmin())
    or (tg_internal.ficheiro_legado_da_empresa(name)
      and tg_internal.ficheiro_referenciado(bucket_id, name, split_part(name, '/', 1)))
  )
);

create policy anexos_privados_ler on storage.objects for select to authenticated using (
  bucket_id = 'anexos-privados' and (
    (select public.tg_superadmin())
    or (split_part(name, '/', 1) = (select public.tg_admin_id()) and (
       (owner_id = (select auth.uid()::text) and not coalesce((select public.tg_e_cliente()), false))
       or tg_internal.ficheiro_referenciado(bucket_id, name, split_part(name, '/', 2))
    ))
  )
);
create policy anexos_privados_inserir on storage.objects for insert to authenticated with check (
  bucket_id = 'anexos-privados'
  and owner_id = (select auth.uid()::text)
  and split_part(name, '/', 2) in ('ponto','pedidos','requisicoes','veiculoDocumentos','funcionarios','folhasObra','relatoriosEspecialidade','encomendas','os_fotos','contratos-documentos','obras','passaportes')
  and ((select public.tg_superadmin()) or (
    split_part(name, '/', 1) = (select public.tg_admin_id())
    and not coalesce((select public.tg_e_cliente()), false)
  ))
);
create policy logotipos_inserir on storage.objects for insert to authenticated with check (
  bucket_id = 'logotipos' and owner_id = (select auth.uid()::text)
  and lower(storage.extension(name)) in ('png','jpeg','jpg','webp','gif')
  and ((select public.tg_superadmin()) or (
    split_part(name, '/', 1) = (select public.tg_admin_id())
    and (select public.tg_papel()) in ('admin','subadmin')
  ))
);
