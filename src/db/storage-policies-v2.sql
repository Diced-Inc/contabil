-- Policies do Storage com papéis (aplicado à mão no Supabase em 13/11/2026; substitui as de storage-logos.sql).
-- Funções eh_contador()/pode_acessar_empresa(uuid) vêm da migration 0007.
-- logos ({empresaId}/logo.webp): lê quem acessa a empresa (contador ou cliente membro); grava só contador.
-- avatars ({auth.uid()}/avatar.webp): continua cada usuário na própria pasta (storage-avatars.sql, sem mudança).
drop policy if exists "logos: ler" on storage.objects;
drop policy if exists "logos: enviar" on storage.objects;
drop policy if exists "logos: atualizar" on storage.objects;
drop policy if exists "logos: apagar" on storage.objects;

-- CASE garante a ordem: o cast para uuid só roda para objetos do bucket logos com pasta em formato de uuid.
create policy "logos: ler" on storage.objects for select to authenticated
  using (case when bucket_id = 'logos' and (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then public.pode_acessar_empresa((storage.foldername(name))[1]::uuid) else false end);
create policy "logos: enviar" on storage.objects for insert to authenticated
  with check (bucket_id = 'logos' and (select public.eh_contador()));
create policy "logos: atualizar" on storage.objects for update to authenticated
  using (bucket_id = 'logos' and (select public.eh_contador()))
  with check (bucket_id = 'logos' and (select public.eh_contador()));
create policy "logos: apagar" on storage.objects for delete to authenticated
  using (bucket_id = 'logos' and (select public.eh_contador()));
