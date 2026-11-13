-- Bucket privado "documentos" (aplicado à mão no Supabase em 13/11/2026).
-- Paths: {empresaId}/{AAAA-MM}/{uuid}-{nome} (extratos do cliente) e {empresaId}/{AAAA-MM}/das-{uuid}.pdf (guia do DAS).
-- Upload por URL assinada criada no servidor (service role quando houver; senão o client da sessão, sob estas policies).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('documentos', 'documentos', false, 10485760, array[
  'application/x-ofx', 'application/octet-stream', 'text/plain',
  'text/csv', 'application/vnd.ms-excel',
  'application/pdf', 'image/png', 'image/jpeg'
])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "documentos: ler" on storage.objects;
drop policy if exists "documentos: enviar" on storage.objects;
drop policy if exists "documentos: apagar" on storage.objects;

-- CASE garante a ordem: o cast para uuid só roda para objetos do bucket com pasta em formato de uuid.
create policy "documentos: ler" on storage.objects for select to authenticated
  using (case when bucket_id = 'documentos' and (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then public.pode_acessar_empresa((storage.foldername(name))[1]::uuid) else false end);
create policy "documentos: enviar" on storage.objects for insert to authenticated
  with check (case when bucket_id = 'documentos' and (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then public.pode_acessar_empresa((storage.foldername(name))[1]::uuid) else false end);
create policy "documentos: apagar" on storage.objects for delete to authenticated
  using (bucket_id = 'documentos' and (select public.eh_contador()));
