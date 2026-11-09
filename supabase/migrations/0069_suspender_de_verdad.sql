-- ============================================================
-- 0069 — SUSPENDER DE VERDAD
--
-- El hueco: al desactivar una membresía, mi_org() y mi_rol() ya negaban,
-- pero mi_persona_id() seguía reconociendo a la persona. Las reglas de
-- "lo tuyo" (persona_id = mi_persona_id()) la dejaban leer sus propios
-- renglones mientras su token siguiera vigente, y sus sesiones seguían
-- abiertas.
--
-- · mi_persona_id() solo reconoce a quien tiene una membresía ACTIVA en
--   su organización activa (o es super_plataforma, como mi_org()). Una
--   persona suspendida queda en nulo: la base le niega todo, también lo
--   suyo, aunque traiga un token vigente. mi_sesion() sale de ahí.
-- · Al desactivar una membresía (por cualquier camino: suspender, la
--   ficha del comisionista, Equipo), un disparador borra sus sesiones de
--   Supabase Auth: ya no puede renovar el token.
-- · suspender_persona / reactivar_persona (solo admin_org, con motivo en
--   la bitácora) y cerrar_sesiones_persona (sin suspender).
-- ============================================================

create or replace function mi_persona_id()
returns uuid language sql stable security definer set search_path = public as $$
  select p.id from personas p
   where p.user_id = auth.uid() and p.activo
     and (p.super_plataforma
          or exists (select 1 from membresias m join organizaciones o on o.id = m.organizacion_id and o.activa
                      where m.persona_id = p.id and m.activa
                        and (p.organizacion_activa is null or m.organizacion_id = p.organizacion_activa)));
$$;

-- Cierra todas las sesiones de una persona en Supabase Auth. Devuelve cuántas.
create or replace function cerrar_sesiones_de(p_persona uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_n integer;
begin
  delete from auth.sessions where user_id = (select user_id from personas where id = p_persona);
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- Membresía desactivada → sesiones cerradas, por el camino que sea.
create or replace function al_desactivar_membresia()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.activa and not new.activa then
    perform cerrar_sesiones_de(new.persona_id);
  end if;
  return null;
end;
$$;
create trigger cerrar_sesiones after update of activa on membresias
  for each row execute function al_desactivar_membresia();

create or replace function revisar_persona_de_mi_org(p_persona uuid, p_motivo text)
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if not soy_admin_org() then
    raise exception 'Solo admin_org';
  end if;
  if p_persona = mi_persona_id() then
    raise exception 'No puedes hacerlo contigo';
  end if;
  if not exists (select 1 from membresias where persona_id = p_persona and organizacion_id = mi_org()) then
    raise exception 'Esa persona no está en tu organización';
  end if;
  if char_length(trim(coalesce(p_motivo, ''))) < 3 then
    raise exception 'Escribe el motivo';
  end if;
end;
$$;

create or replace function suspender_persona(p_persona uuid, p_motivo text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform revisar_persona_de_mi_org(p_persona, p_motivo);
  perform set_config('tasa.motivo', 'Suspendida: ' || trim(p_motivo), true);
  update membresias set activa = false where persona_id = p_persona and organizacion_id = mi_org() and activa;
  if not found then
    raise exception 'Ya estaba suspendida';
  end if;
  perform set_config('tasa.motivo', '', true);
end;
$$;

create or replace function reactivar_persona(p_persona uuid, p_motivo text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform revisar_persona_de_mi_org(p_persona, p_motivo);
  perform set_config('tasa.motivo', 'Reactivada: ' || trim(p_motivo), true);
  update membresias set activa = true where persona_id = p_persona and organizacion_id = mi_org() and not activa;
  if not found then
    raise exception 'No estaba suspendida';
  end if;
  perform set_config('tasa.motivo', '', true);
end;
$$;

-- Sin suspender: cierra sus sesiones (tendrá que volver a entrar con su código). Queda en la bitácora.
create or replace function cerrar_sesiones_persona(p_persona uuid, p_motivo text)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_n integer;
begin
  perform revisar_persona_de_mi_org(p_persona, p_motivo);
  v_n := cerrar_sesiones_de(p_persona);
  insert into bitacora (persona_id, rol, accion, tabla, registro_id, despues, motivo)
  values (mi_persona_id(), mi_rol(), 'DELETE', 'auth.sessions', p_persona::text, jsonb_build_object('sesiones_cerradas', v_n),
          'Cerrar sesiones: ' || trim(p_motivo));
  return v_n;
end;
$$;

revoke all on function cerrar_sesiones_de(uuid), al_desactivar_membresia(), revisar_persona_de_mi_org(uuid, text),
  suspender_persona(uuid, text), reactivar_persona(uuid, text), cerrar_sesiones_persona(uuid, text) from public, anon, authenticated;
grant execute on function suspender_persona(uuid, text), reactivar_persona(uuid, text), cerrar_sesiones_persona(uuid, text) to authenticated;

-- La sesión (0033) sale de mi_persona_id(): suspendida, no hay sesión.
create or replace function mi_sesion()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'persona_id',       p.id,
    'nombre',           nombre_visible(p),
    'correo',           p.correo,
    'super_plataforma', p.super_plataforma,
    'rol',              mi_rol(),
    'organizacion',     (select jsonb_build_object('id', o.id, 'nombre', o.nombre, 'slug', o.slug)
                           from organizaciones o where o.id = mi_org()),
    'visitante',        p.super_plataforma and mi_org() is not null and not exists (
                          select 1 from membresias m
                           where m.persona_id = p.id and m.organizacion_id = mi_org() and m.activa),
    'organizaciones',   (select count(*) from mis_organizaciones()),
    'debe_aceptar_terminos', debo_aceptar_terminos()
  )
    from personas p
   where p.id = mi_persona_id();
$$;
