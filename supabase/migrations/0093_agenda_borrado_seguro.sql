-- ============================================================
-- 0093 — Agenda: borrar una tarea ya no es definitivo
-- ============================================================
-- Borrar marca la tarea como eliminada (se puede deshacer) y la limpieza la quita de verdad a los 30 días.
-- La app nunca borra tareas: solo marca eliminada_en o la vuelve a nulo.

alter table agenda_tareas add column eliminada_en timestamptz;

create or replace function limpiar_agenda()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_t integer; v_e integer; v_c integer; v_k integer; v_l integer; v_a integer;
begin
  delete from agenda_tareas where hecha_en < now() - interval '12 months';
  get diagnostics v_t = row_count;
  -- Eliminadas hace más de 30 días: ya no se recuperan.
  delete from agenda_tareas where eliminada_en < now() - interval '30 days';
  get diagnostics v_e = row_count;
  delete from agenda_citas where inicia < now() - interval '12 months';
  get diagnostics v_c = row_count;
  delete from agenda_contactos k
   where k.actualizado_en < now() - interval '12 months'
     and not exists (select 1 from membresias m where m.organizacion_id = k.organizacion_id and m.persona_id = k.persona_id and m.activa);
  get diagnostics v_k = row_count;
  delete from calendario_ligas where revocada_en < now() - interval '90 days';
  get diagnostics v_l = row_count;
  delete from agenda_ajustes a
   where a.actualizado_en < now() - interval '12 months'
     and not exists (select 1 from membresias m where m.organizacion_id = a.organizacion_id and m.persona_id = a.persona_id and m.activa);
  get diagnostics v_a = row_count;
  return jsonb_build_object('tareas', v_t, 'eliminadas', v_e, 'citas', v_c, 'contactos', v_k, 'ligas', v_l, 'ajustes', v_a);
end;
$$;
revoke all on function limpiar_agenda() from public, anon, authenticated;
grant execute on function limpiar_agenda() to service_role;
