alter policy ficheiros_ler on storage.objects to authenticated
using (bucket_id = 'ficheiros' and owner_id = (select auth.uid()::text));
