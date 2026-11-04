-- Bucket privado dos logos das empresas (fora das migrations do Drizzle; aplicado à mão no Supabase em 04/11/2026).
-- Caminho: {empresaId}/logo.webp. App de um contador só: todo usuário logado (allowlist) gerencia o logo de qualquer empresa.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('logos', 'logos', false, 2097152, array['image/png','image/jpeg','image/webp'])
on conflict (id) do nothing;

create policy "logos: ler" on storage.objects for select to authenticated using (bucket_id = 'logos');
create policy "logos: enviar" on storage.objects for insert to authenticated with check (bucket_id = 'logos');
create policy "logos: atualizar" on storage.objects for update to authenticated
  using (bucket_id = 'logos') with check (bucket_id = 'logos');
create policy "logos: apagar" on storage.objects for delete to authenticated using (bucket_id = 'logos');
