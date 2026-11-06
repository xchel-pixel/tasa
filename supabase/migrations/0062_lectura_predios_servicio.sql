-- ============================================================
-- 0062 — LA LLAVE DE SERVICIO LEE LOS PREDIOS GUARDADOS
--
-- La prueba de humo (mapa → calculadora) busca un predio ya guardado y
-- vigente para abrir su ficha sin consultar la fuente. Solo lectura y
-- solo la tabla de predios (datos no personales). Propietarios y
-- operación siguen sin ningún permiso directo para nadie.
-- service_role existe solo en el servidor (cron, humo); nunca en el
-- navegador.
-- ============================================================

grant select on catastro_predios to service_role;
