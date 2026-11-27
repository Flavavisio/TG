create or replace view tg_internal.ficheiros_registos
with (security_invoker = true) as
select admin_id, 'ponto'::text as tipo, to_jsonb(foto) as referencias, id as registo from public.ponto
union all select admin_id, 'pedidos', jsonb_build_array(anexo, anexo_admin), id from public.pedidos
union all select admin_id, 'requisicoes', to_jsonb(anexo), id from public.requisicoes
union all select admin_id, 'veiculoDocumentos', to_jsonb(ficheiro), id from public.veiculo_documentos
union all select admin_id, 'funcionarios', to_jsonb(foto), id from public.funcionarios
union all select admin_id, 'folhasObra', to_jsonb(assinatura), id from public.folhas_obra
union all select admin_id, 'relatoriosEspecialidade', jsonb_build_array(assinatura_cliente, assinatura_tecnico), id from public.relatorios_especialidade
union all select admin_id, 'encomendas', to_jsonb(fatura), id from public.encomendas
union all select admin_id, 'os_fotos', jsonb_build_array(fotos, passaporte_intervencao), id from public.servicos
union all select admin_id, 'contratos-documentos', to_jsonb(documento_url), id from public.contratos
  where not coalesce(public.tg_e_cliente(), false)
union all select admin_id, 'obras', to_jsonb(url), obra_id from public.obra_documentos
union all select admin_id, 'obras', to_jsonb(fotos), id from public.obras
union all select admin_id, 'passaportes', passaporte_tecnico, id from public.clientes
union all select admin_id, 'passaportes', passaporte_tecnico, cliente_id from public.locais;

create or replace function tg_internal.ficheiro_referenciado(bucket text, caminho text, tipo text)
returns boolean
language sql stable security invoker set search_path = ''
as $$
  select exists (
    select 1 from tg_internal.ficheiros_registos r
    where r.admin_id = (select public.tg_admin_id()) and r.tipo = $3
      and ($1 = 'ficheiros' or r.registo = split_part($2, '/', 3))
      and jsonb_path_exists(r.referencias, '$.** ? (@ == $url)', jsonb_build_object('url',
        'https://rfniufasivfnrqfntzog.supabase.co/storage/v1/object/public/' || $1 || '/' || $2))
  )
$$;

-- The uploader can preview a fresh file while the record is still unsaved.
-- Once linked, the record's own permissions control access.
create function tg_internal.ficheiro_novo_por_associar(caminho text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select split_part($1, '/', 1) = (select public.tg_admin_id())
    and not tg_internal.ficheiro_referenciado('anexos-privados', $1, split_part($1, '/', 2))
$$;
revoke all on function tg_internal.ficheiro_novo_por_associar(text) from public, anon, authenticated;
grant execute on function tg_internal.ficheiro_novo_por_associar(text) to authenticated;

alter policy anexos_privados_ler on storage.objects to authenticated using (
  bucket_id = 'anexos-privados' and (
    (select public.tg_superadmin())
    or (split_part(name, '/', 1) = (select public.tg_admin_id()) and (
       tg_internal.ficheiro_referenciado(bucket_id, name, split_part(name, '/', 2))
       or (owner_id = (select auth.uid()::text)
          and created_at >= statement_timestamp() - interval '24 hours'
          and not coalesce((select public.tg_e_cliente()), false)
          and tg_internal.ficheiro_novo_por_associar(name))
    ))
  )
);

alter policy anexos_privados_inserir on storage.objects to authenticated with check (
  bucket_id = 'anexos-privados'
  and owner_id = (select auth.uid()::text)
  and name ~ '^[A-Za-z0-9_-]+/[A-Za-z0-9_-]+/[A-Za-z0-9_-]+/([A-Za-z0-9_-]+/)?[A-Za-z0-9_-]+\.(png|jpeg|jpg|webp|gif|pdf)$'
  and split_part(name, '/', 2) in ('ponto','pedidos','requisicoes','veiculoDocumentos','funcionarios','folhasObra','relatoriosEspecialidade','encomendas','os_fotos','contratos-documentos','obras','passaportes')
  and ((select public.tg_superadmin()) or (
    split_part(name, '/', 1) = (select public.tg_admin_id())
    and not coalesce((select public.tg_e_cliente()), false)
  ))
);
