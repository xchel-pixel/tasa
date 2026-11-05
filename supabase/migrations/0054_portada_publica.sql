-- ============================================================
-- 0054 — PORTADA PÚBLICA (SIN SESIÓN)
--
-- La portada sin sesión invita a ser aliado comercial. "Quiero ser
-- aliado" lleva a la solicitud de alta de la organización: si hay una
-- sola activa (hoy XG), directo; si hay varias, se elige. Sin sesión no
-- se lee ninguna tabla: solo esta función (nombre y slug, nada más).
-- DEMO nunca aparece.
-- ============================================================

create or replace function organizaciones_con_alta()
returns table (slug text, nombre text)
language sql stable security definer set search_path = public as $$
  select o.slug, o.nombre from organizaciones o
   where o.activa and not o.demo
   order by o.nombre;
$$;

revoke all on function organizaciones_con_alta() from public;
grant execute on function organizaciones_con_alta() to anon, authenticated;
