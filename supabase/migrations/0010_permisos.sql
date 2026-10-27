-- ============================================================
-- 0010 — PERMISOS EXPLÍCITOS
--
-- El proyecto se creó con "Automatically expose new tables" APAGADO:
-- Supabase no les da ningún permiso a `anon` ni a `authenticated`
-- sobre las tablas nuevas. Eso es lo que queremos, pero obliga a
-- decir aquí, una por una, qué puede hacer cada rol. Sin esto la
-- aplicación vería todo vacío aunque el RLS estuviera bien.
--
-- Dos capas, como siempre:
--   1. GRANT: qué operaciones existen para el rol (esta migración).
--   2. RLS: sobre qué filas (las políticas de cada migración).
--
-- `anon` no recibe nada sobre ninguna tabla. Su única puerta es
-- `correo_en_padron()`, que la pantalla de acceso necesita antes de
-- que exista sesión y que solo responde sí o no.
-- ============================================================

-- ------------------------------------------------------------
-- 1. TABLAS
-- ------------------------------------------------------------

revoke all on all tables in schema public from anon;

-- Se leen y se escriben (el RLS decide quién y qué filas).
grant select, insert, update, delete on
  personas, comisionistas, marcas, cuentas_receptoras, servicios,
  solicitudes, cotizaciones, mapeo_estatus, niveles, comisiones
  to authenticated;

-- Los pagos no se borran nunca.
grant select, insert, update on pagos to authenticated;

-- Solo lectura: las escriben disparadores y funciones, no la app.
grant select on
  bitacora, historial_estatus, cierres, niveles_mensuales, alertas
  to authenticated;

-- El cron (llave de servicio, en `/api/cron`): vence cotizaciones,
-- lee Notion y manda los correos de cambio de estatus. La llave de
-- servicio se salta el RLS, pero no los permisos: solo lo que necesita.
grant usage on schema public to service_role;
grant select on solicitudes, personas, comisionistas, historial_estatus to service_role;
grant update (notificado_en) on historial_estatus to service_role;

-- ------------------------------------------------------------
-- 2. FUNCIONES
-- ------------------------------------------------------------
-- En Postgres una función nace ejecutable por todo el mundo (PUBLIC).
-- Se cierran todas y se abren solo las que se usan. Los disparadores
-- no necesitan este permiso: corren igual (comprobado en las pruebas).

revoke execute on all functions in schema public from public, anon, authenticated;

-- Las que nazcan después también nacen cerradas.
alter default privileges in schema public revoke execute on functions from public;

-- anon: solo la pregunta de la pantalla de acceso.
grant execute on function correo_en_padron(text) to anon, authenticated;

-- authenticated: las que usan las políticas, los valores por omisión
-- y las restricciones (corren con los permisos de quien escribe)…
grant execute on function
  mi_persona_id(), mi_rol(), soy_staff(), soy_super_admin(),
  hoy_mx(), mes_de(date), estatus_publicos()
  to authenticated;

-- …y las que la aplicación llama directamente.
grant execute on function
  vincular_mi_usuario(),
  aceptar_cotizacion(uuid),
  cancelar_trabajo(uuid, text),
  preparar_cierre(date),
  aprobar_cierre(date),
  registrar_lectura_notion(text, text, text, date),
  descartar_alerta(uuid, text),
  porcentaje_vigente(uuid, date),
  porcentaje_es_provisional(uuid, date),
  calcular_nivel(uuid, date),
  mes_abierto_desde(date),
  mes_aprobado(date)
  to authenticated;

-- service_role: lo que corre el cron.
grant execute on function
  vencer_cotizaciones(),
  registrar_lectura_notion(text, text, text, date),
  hoy_mx(), mes_de(date), estatus_publicos(), mi_persona_id(), mi_rol(), soy_staff()
  to service_role;
