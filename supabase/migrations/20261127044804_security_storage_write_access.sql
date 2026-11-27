drop policy ficheiros_inserir on storage.objects;
drop policy ficheiros_atualizar on storage.objects;
create policy ficheiros_inserir_autenticado on storage.objects for insert to authenticated
with check (bucket_id = 'ficheiros' and (select auth.uid()) is not null);
