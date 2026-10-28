-- Ejecutar UNA vez en RESSO OBS / RESSO 424. No modifica observaciones.
begin;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('resso-previews', 'resso-previews', true, 20971520,
  array['application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'image/gif']);

-- Permite listar previews; el bucket publico permite descargar sin iniciar sesion.
-- No se conceden permisos anonimos de carga, modificacion ni borrado.
create policy resso_previews_public_list on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'resso-previews'
    and name ~ '^v(10|11)/(0[1-9]|[12][0-9]|3[0-9]|40)/[^/]+$');
notify pgrst, 'reload schema';
commit;
