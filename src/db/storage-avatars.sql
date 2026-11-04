-- Bucket privado das fotos de perfil (fora das migrations do Drizzle; aplicado à mão no Supabase em 04/11/2026).
-- Caminho: {auth.uid()}/avatar.webp. Cada usuário só lê/grava/apaga a própria pasta.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', false, 2097152, array['image/png','image/jpeg','image/webp'])
on conflict (id) do nothing;

create policy "avatars: ler a própria pasta" on storage.objects for select to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "avatars: enviar na própria pasta" on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "avatars: atualizar a própria pasta" on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "avatars: apagar da própria pasta" on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
