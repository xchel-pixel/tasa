-- ============================================================
-- Reversa de 0080 ("ver como"), en dos niveles. Correr con:
--   npx supabase db query --linked --yes -f supabase/produccion/reversa_0080.sql
--
-- NIVEL 1 (emergencia, lo que se ejecuta tal cual): apaga la función que
-- PostgREST corre antes de cada petición. Tasa vuelve a funcionar como
-- antes de 0080; "ver como" deja de ser de solo lectura en la base, así
-- que también se cierran todas las vistas abiertas (sin vista, el
-- encabezado no da acceso a nadie).
-- ============================================================
alter role authenticator reset pgrst.db_pre_request;
notify pgrst, 'reload config';
update vistas_como set cerrada_en = now() where cerrada_en is null;

-- ============================================================
-- NIVEL 2 (opcional, quitar los comentarios): mi_persona_id() y
-- soy_super_plataforma() como estaban en 0069 y 0016, sin "ver como".
-- ============================================================
-- create or replace function mi_persona_id()
-- returns uuid language sql stable security definer set search_path = public as $$
--   select p.id from personas p
--    where p.user_id = auth.uid() and p.activo
--      and (p.super_plataforma
--           or exists (select 1 from membresias m join organizaciones o on o.id = m.organizacion_id and o.activa
--                       where m.persona_id = p.id and m.activa
--                         and (p.organizacion_activa is null or m.organizacion_id = p.organizacion_activa)));
-- $$;
-- create or replace function soy_super_plataforma()
-- returns boolean language sql stable security definer set search_path = public as $$
--   select coalesce((select super_plataforma from personas where user_id = auth.uid() and activo), false);
-- $$;
