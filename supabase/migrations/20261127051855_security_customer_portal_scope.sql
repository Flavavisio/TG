create function public.tg_portal_ativo()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.perfis p
    join public.clientes c on c.id = p.registo_id and c.admin_id = p.admin_id
    join public.administradores a on a.id = p.admin_id
    where p.id = auth.uid() and p.papel = 'cliente'
      and c.portal_ativo is true and a.ativo is true
  )
$$;
revoke all on function public.tg_portal_ativo() from public, anon, authenticated;
grant execute on function public.tg_portal_ativo() to authenticated;

do $$
declare tabela text;
  portal text[] := array['perfis','administradores','clientes','locais','contratos','servicos','folhas_obra',
    'relatorios_especialidade','obras','notificacoes','assistencias','tenant_versao','tenant_versao_tabela'];
begin
  for tabela in
    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p') and c.relrowsecurity
  loop
    if tabela = any(portal) then
      if tabela <> 'perfis' then
        execute format('create policy portal_requer_acesso_ativo on public.%I as restrictive for all to authenticated using (not coalesce((select public.tg_e_cliente()), false) or (select public.tg_portal_ativo())) with check (not coalesce((select public.tg_e_cliente()), false) or (select public.tg_portal_ativo()))',tabela);
      end if;
    else
      execute format('create policy portal_bloqueia_tabela_interna on public.%I as restrictive for all to authenticated using (not coalesce((select public.tg_e_cliente()), false)) with check (not coalesce((select public.tg_e_cliente()), false))',tabela);
    end if;
  end loop;

  foreach tabela in array array['administradores','clientes','locais','contratos','servicos','relatorios_especialidade','obras','notificacoes']
  loop
    execute format('create policy portal_sem_criacao on public.%I as restrictive for insert to authenticated with check (not coalesce((select public.tg_e_cliente()), false))',tabela);
    execute format('create policy portal_sem_edicao on public.%I as restrictive for update to authenticated using (not coalesce((select public.tg_e_cliente()), false)) with check (not coalesce((select public.tg_e_cliente()), false))',tabela);
    execute format('create policy portal_sem_eliminacao on public.%I as restrictive for delete to authenticated using (not coalesce((select public.tg_e_cliente()), false))',tabela);
  end loop;
end
$$;

create policy portal_empresa_propria on public.administradores as restrictive for select to authenticated
using (not coalesce((select public.tg_e_cliente()), false) or id = (select public.tg_admin_id()));
create policy portal_obras_proprias on public.obras as restrictive for select to authenticated
using (not coalesce((select public.tg_e_cliente()), false) or cliente_id = (select public.tg_cliente_registo_id()));
create policy portal_notificacoes_proprias on public.notificacoes as restrictive for select to authenticated
using (not coalesce((select public.tg_e_cliente()), false) or destinatario_id = (select public.tg_cliente_registo_id()));
create policy portal_relatorios_finalizados on public.relatorios_especialidade as restrictive for select to authenticated
using (not coalesce((select public.tg_e_cliente()), false) or rascunho is not true);
create policy portal_folhas_sem_eliminacao on public.folhas_obra as restrictive for delete to authenticated
using (not coalesce((select public.tg_e_cliente()), false));

create function tg_internal.portal_proteger_assinatura_folha()
returns trigger
language plpgsql security invoker set search_path = ''
as $$
begin
  if current_user <> 'authenticated' or not coalesce(public.tg_e_cliente(), false) then return new; end if;
  if tg_op = 'INSERT' then
    -- A sincronização antiga usa upsert. Só pode prosseguir para UPDATE de uma folha visível.
    perform 1 from public.folhas_obra f where f.id = new.id and f.admin_id = new.admin_id for key share;
    if found then return new; end if;
    raise insufficient_privilege using message = 'O Portal não pode criar folhas de obra.';
  end if;
  if to_jsonb(old) - array['assinatura','assinatura_nome','assinatura_path','data_atualizacao']
     is distinct from to_jsonb(new) - array['assinatura','assinatura_nome','assinatura_path','data_atualizacao'] then
    raise insufficient_privilege using message = 'O Portal só pode gravar a assinatura da folha de obra.';
  end if;
  if new.assinatura_path is not null and new.assinatura_path <> (old.admin_id || '/folhas/' || old.id || '.png') then
    raise insufficient_privilege using message = 'O caminho da assinatura não pertence à folha de obra.';
  end if;
  return new;
end
$$;
revoke all on function tg_internal.portal_proteger_assinatura_folha() from public, anon, authenticated;
create trigger portal_proteger_assinatura_folha before insert or update on public.folhas_obra
for each row execute function tg_internal.portal_proteger_assinatura_folha();

create policy portal_storage_relatorios_proprios on storage.objects as restrictive for select to authenticated
using (
  bucket_id <> 'relatorios-especialidade' or not coalesce((select public.tg_e_cliente()), false)
  or ((select public.tg_portal_ativo()) and (
    exists (select 1 from public.folhas_obra f where f.admin_id = (select public.tg_admin_id())
      and (storage.objects.name = f.assinatura_path or storage.objects.name = f.admin_id || '/folhas/' || f.id || '.png'))
    or exists (select 1 from public.relatorios_especialidade r where r.admin_id = (select public.tg_admin_id())
      and (storage.objects.name in (r.assinatura_cliente_path, r.assinatura_tecnico_path)
        or storage.objects.name = r.admin_id || '/' || r.id || '.html'))
    or exists (select 1 from public.servicos s where s.admin_id = (select public.tg_admin_id())
      and split_part(storage.objects.name,'/',2) = 'os' and split_part(storage.objects.name,'/',3) = s.id)
  ))
);

create policy portal_storage_sem_eliminacao on storage.objects as restrictive for delete to authenticated
using (not coalesce((select public.tg_e_cliente()), false));
create policy portal_storage_so_assinatura_inserir on storage.objects as restrictive for insert to authenticated
with check (not coalesce((select public.tg_e_cliente()), false) or (
  bucket_id = 'relatorios-especialidade' and (select public.tg_portal_ativo())
  and exists (select 1 from public.folhas_obra f where f.admin_id = (select public.tg_admin_id())
    and storage.objects.name = f.admin_id || '/folhas/' || f.id || '.png')
));
create policy portal_storage_so_assinatura_editar on storage.objects as restrictive for update to authenticated
using (not coalesce((select public.tg_e_cliente()), false) or (
  bucket_id = 'relatorios-especialidade' and (select public.tg_portal_ativo())
  and exists (select 1 from public.folhas_obra f where f.admin_id = (select public.tg_admin_id())
    and storage.objects.name = f.admin_id || '/folhas/' || f.id || '.png')
))
with check (not coalesce((select public.tg_e_cliente()), false) or (
  bucket_id = 'relatorios-especialidade' and (select public.tg_portal_ativo())
  and exists (select 1 from public.folhas_obra f where f.admin_id = (select public.tg_admin_id())
    and storage.objects.name = f.admin_id || '/folhas/' || f.id || '.png')
));
