-- ============================================================
-- 0092 — Agenda: horas de la jornada por persona
-- ============================================================
-- La jornada por horas va de 7:00 a 21:00 por omisión; cada persona la ajusta a su horario. Es parte de su agenda:
-- privada como lo demás (solo el dueño, con la sesión real, en su organización y con la herramienta encendida).
-- Sin fila = horario por omisión.

create table agenda_ajustes (
  organizacion_id uuid not null default mi_org() references organizaciones(id) on delete cascade,
  persona_id      uuid not null default mi_persona_real() references personas(id) on delete cascade,
  -- Horas enteras: la jornada empieza a "inicia":00 y termina a "termina":00.
  jornada_inicia  smallint not null default 7 check (jornada_inicia between 0 and 23),
  jornada_termina smallint not null default 21 check (jornada_termina between 1 and 24),
  actualizado_en  timestamptz not null default now(),
  primary key (organizacion_id, persona_id),
  check (jornada_termina - jornada_inicia >= 4)
);

alter table agenda_ajustes enable row level security;
revoke all on agenda_ajustes from anon;
create policy solo_el_dueno on agenda_ajustes for all
  using (persona_id = (select mi_persona_real()) and organizacion_id = (select mi_org()) and (select agenda_disponible()))
  with check (persona_id = (select mi_persona_real()) and organizacion_id = (select mi_org()) and (select agenda_disponible()));
grant select, insert, update, delete on agenda_ajustes to authenticated;

-- Limpieza: igual que 0091 y, además, el horario de quien ya no está en la organización.
create or replace function limpiar_agenda()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_t integer; v_c integer; v_k integer; v_l integer; v_a integer;
begin
  delete from agenda_tareas where hecha_en < now() - interval '12 months';
  get diagnostics v_t = row_count;
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
  return jsonb_build_object('tareas', v_t, 'citas', v_c, 'contactos', v_k, 'ligas', v_l, 'ajustes', v_a);
end;
$$;
revoke all on function limpiar_agenda() from public, anon, authenticated;
grant execute on function limpiar_agenda() to service_role;
