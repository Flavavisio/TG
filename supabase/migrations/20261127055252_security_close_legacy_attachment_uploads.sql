alter policy ficheiros_inserir_autenticado on storage.objects to authenticated with check (false);
select tg_internal.ficheiros_indexar_legados();
