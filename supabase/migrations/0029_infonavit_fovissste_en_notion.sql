-- ============================================================
-- 0029 — INFONAVIT Y FOVISSSTE EN NOTION
--
-- Decisión de Xchel (opción a): en "Tipo de Trámite" van como
-- "Avalúo Bancario", que ya existe en Notion. Solo configuración de XG.
-- ============================================================

update servicios set nombre_notion = 'Avalúo Bancario'
 where organizacion_id = 'a0000000-0000-4000-8000-000000000001'
   and nombre in ('Avalúo Infonavit', 'Avalúo Fovissste');
