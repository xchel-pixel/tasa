-- ============================================================
-- 0071 — PANTALLA DE ACCESOS Y CONSERVACIÓN A 12 MESES
--
-- · accesos_lista() y accesos_persona(): lo que ve admin_org (y nadie
--   más) en Administración → Accesos: rol, nivel, estatus, último
--   acceso, sesiones abiertas (navegador, fechas e IP RECORTADA: la
--   completa nunca sale de la base), cupos, saldo DXF e historial
--   (accesos, denegaciones y cambios de la bitácora con quién y motivo).
-- · Conservación: eventos_uso y las fallas de la fuente se borran solos a
--   los 12 meses (limpiar_datos_tecnicos, en el cron). Lo que Tasa guarda
--   de accesos vive en eventos_uso. Las solicitudes conservan su marca de
--   origen aunque se borre la consulta.
-- ============================================================

-- La IP recortada: 189.203.x.x (IPv6: sus dos primeros grupos).
create or replace function ip_recortada(p_ip inet)
returns text language sql immutable set search_path = public as $$
  select case
    when p_ip is null then null
    when family(p_ip) = 4 then split_part(host(p_ip), '.', 1) || '.' || split_part(host(p_ip), '.', 2) || '.x.x'
    else split_part(host(p_ip), ':', 1) || ':' || split_part(host(p_ip), ':', 2) || ':…'
  end;
$$;

create or replace function ultimo_acceso_de(p_persona uuid)
returns timestamptz language sql stable security definer set search_path = public as $$
  select nullif(greatest(
    coalesce((select u.last_sign_in_at from auth.users u join personas p on p.user_id = u.id where p.id = p_persona), '-infinity'),
    coalesce((select max(e.creado_en) from eventos_uso e where e.persona_id = p_persona and e.evento = 'acceso'), '-infinity'),
    coalesce((select max(coalesce(s.refreshed_at::timestamptz, s.updated_at, s.created_at)) from auth.sessions s
                join personas p on p.user_id = s.user_id where p.id = p_persona), '-infinity')), '-infinity');
$$;

-- Las personas de la organización, para la lista.
create or replace function accesos_lista()
returns table (persona_id uuid, nombre text, correo text, rol text, activa boolean, ultimo_acceso timestamptz, sesiones bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  if not soy_admin_org() then
    raise exception 'Solo admin_org';
  end if;
  return query
  select p.id, p.nombre, p.correo, m.rol, m.activa, ultimo_acceso_de(p.id),
         (select count(*) from auth.sessions s where s.user_id = p.user_id)
    from membresias m join personas p on p.id = m.persona_id
   where m.organizacion_id = mi_org()
   order by m.activa desc, p.nombre;
end;
$$;

create or replace function accesos_persona(p_persona uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_org uuid := mi_org();
  m     membresias;
  p     personas;
begin
  if not soy_admin_org() then
    raise exception 'Solo admin_org';
  end if;
  select * into m from membresias where persona_id = p_persona and organizacion_id = v_org;
  if not found then
    return null;
  end if;
  select * into p from personas where id = p_persona;
  return jsonb_build_object(
    'persona', jsonb_build_object('id', p.id, 'nombre', p.nombre, 'correo', p.correo),
    'rol', m.rol,
    'activa', m.activa,
    'yo', p.id = mi_persona_id(),
    'nivel', case when m.rol = 'comisionista' then (select n.nombre from niveles n where n.id = nivel_del_mes(v_org, p.id, mes_mx(now()))) end,
    'ultimo_acceso', ultimo_acceso_de(p.id),
    'sesiones', coalesce((select jsonb_agg(jsonb_build_object(
                   'creada', s.created_at, 'actividad', coalesce(s.refreshed_at::timestamptz, s.updated_at, s.created_at),
                   'navegador', s.user_agent, 'ip', ip_recortada(s.ip)) order by coalesce(s.refreshed_at::timestamptz, s.updated_at, s.created_at) desc)
                   from auth.sessions s where s.user_id = p.user_id), '[]'),
    'cupos', (select jsonb_object_agg(h, (select to_jsonb(c) from cupo_de(v_org, p.id, h) c))
                from unnest(array['mapa_catastral', 'mapa_catastral_pdf', 'calculadora_traslado', 'calculadora_traslado_completa']) h),
    'eventos', coalesce((select jsonb_agg(to_jsonb(e) - 'organizacion_id' - 'persona_id' order by e.creado_en desc)
                          from (select * from eventos_uso where organizacion_id = v_org and persona_id = p.id
                                 order by creado_en desc limit 80) e), '[]'),
    'bitacora', coalesce((select jsonb_agg(jsonb_build_object(
                   'creado_en', b.creado_en, 'tabla', b.tabla, 'accion', b.accion, 'motivo', nullif(b.motivo, ''),
                   'quien', (select q.nombre from personas q where q.id = b.persona_id),
                   'cambios', (select coalesce(jsonb_agg(k order by k), '[]') from (
                                 select key k from jsonb_each(coalesce(b.despues, '{}')) union select key from jsonb_each(coalesce(b.antes, '{}'))) x
                               where b.antes -> k is distinct from b.despues -> k
                                 and k not in ('actualizado_en', 'creado_en', 'id', 'organizacion_id', 'persona_id')),
                   'activa', b.despues -> 'activa') order by b.creado_en desc)
                   from (select * from bitacora b
                          where (b.registro_id = p.id::text or b.despues ->> 'persona_id' = p.id::text or b.antes ->> 'persona_id' = p.id::text)
                            and coalesce(b.despues ->> 'organizacion_id', b.antes ->> 'organizacion_id', v_org::text) = v_org::text
                          order by b.creado_en desc limit 60) b), '[]')
  );
end;
$$;

-- Conservación: a los 30 días el resumen de IP (0064); a los 12 meses, los eventos de uso y las fallas de la fuente.
create or replace function limpiar_datos_tecnicos()
returns void language plpgsql security definer set search_path = public as $$
begin
  perform set_config('tasa.motivo', 'Limpieza automática: resumen de IP a los 30 días', true);
  update solicitudes_alta set ip_resumen = null where ip_resumen is not null and creada_en < now() - interval '30 days';
  update solicitudes set ip_resumen = null where ip_resumen is not null and creado_en < now() - interval '30 days';
  perform set_config('tasa.motivo', '', true);
  delete from eventos_uso where creado_en < now() - interval '12 months';
  delete from catastro_fallas where ocurrida_en < now() - interval '12 months';
end;
$$;

revoke all on function ip_recortada(inet), ultimo_acceso_de(uuid), accesos_lista(), accesos_persona(uuid) from public, anon, authenticated;
grant execute on function accesos_lista(), accesos_persona(uuid) to authenticated;
