-- ============================================================
-- 0007 — STORAGE
-- Dos buckets, los dos privados. Todo se muestra por URL firmada.
--
--   comprobantes/{persona_id}/{uuid}.{ext}
--     La primera carpeta es el candado: cada quien sube solo dentro de
--     la suya. La lee su dueño y el staff.
--
--   cotizaciones/{solicitud_id}/{cotizacion_id}.pdf
--     Los genera el servidor. Los lee el comisionista dueño de la
--     solicitud y el staff. Solo el staff sube.
--
-- Si estas políticas fallan al correr la migración, créalas desde
-- Storage → Policies: el editor SQL a veces no es dueño de
-- `storage.objects`.
-- ============================================================

insert into storage.buckets (id, name, public)
values ('comprobantes', 'comprobantes', false),
       ('cotizaciones', 'cotizaciones', false)
on conflict (id) do nothing;

create policy comprobantes_subir on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'comprobantes'
    and (storage.foldername(name))[1] = public.mi_persona_id()::text
  );

create policy comprobantes_leer on storage.objects
  for select to authenticated
  using (
    bucket_id = 'comprobantes'
    and ((storage.foldername(name))[1] = public.mi_persona_id()::text or public.soy_staff())
  );

create policy cotizaciones_subir on storage.objects
  for insert to authenticated
  with check (bucket_id = 'cotizaciones' and public.soy_staff());

create policy cotizaciones_leer on storage.objects
  for select to authenticated
  using (
    bucket_id = 'cotizaciones'
    and (
      public.soy_staff()
      or (storage.foldername(name))[1] in (
        select id::text from public.solicitudes where comisionista_id = public.mi_persona_id()
      )
    )
  );

-- Nadie borra ni reemplaza: son el respaldo de lo cobrado y cotizado.
