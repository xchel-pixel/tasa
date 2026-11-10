-- ============================================================
-- 0075 — INACTIVIDAD DE COMISIONISTAS
--
-- Un comisionista que pasa 6 meses sin ningún trabajo cobrado pasa a
-- "inactiva": conserva su tarjeta, la liga para clientes, "Mi uso" y la
-- calculadora rápida; se le apagan el Mapa catastral (con su PDF y su
-- DXF) y la Calculadora completa.
--
-- · La actividad es lo más reciente de: su alta, su último trabajo
--   cobrado (el fin del día del pago que lo completa o el momento de su
--   confirmación, lo que sea después), y la última reactivación a mano.
-- · Un paquete de crédito vigente cuenta como actividad: quien lo tiene
--   nunca queda inactivo. Hoy no hay paquetes (paquete_vigente_de()
--   responde que no); el monedero la redefine.
-- · Aviso dentro de Tasa 15 días antes, sin correo. Nadie pasa a
--   inactiva sin haber tenido 15 días el aviso: si el cron no avisó a
--   tiempo, el plazo corre desde el aviso.
-- · Se reactiva sola con su siguiente trabajo cobrado, en ese momento
--   (la regla se calcula al preguntar; el cron solo deja el registro).
--   admin_org puede reactivarla a mano con motivo: le da otros 6 meses.
-- · Todo cambio queda en la bitácora de membresías, con su motivo.
-- ============================================================

alter table membresias
  add column inactiva_desde         timestamptz,
  add column inactividad_avisada_en timestamptz,
  add column actividad_manual_en    timestamptz;

-- Lo que el monedero redefine: ¿tiene un paquete de crédito vigente?
create or replace function paquete_vigente_de(p_org uuid, p_persona uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select false;
$$;

-- La última actividad: alta, último trabajo cobrado o reactivación a mano.
create or replace function ultima_actividad_de(p_org uuid, p_persona uuid)
returns timestamptz language sql stable security definer set search_path = public as $$
  select greatest(m.creado_en, m.actividad_manual_en,
           (select max(greatest((s.pagado_en + 1)::timestamp at time zone 'America/Mexico_City',
                                (select max(p.revisado_en) from pagos p where p.solicitud_id = s.id and p.estado = 'confirmado')))
              from solicitudes s
             where s.organizacion_id = p_org and s.comisionista_id = p_persona and s.pagado_en is not null and s.estado <> 'cancelada'))
    from membresias m
   where m.organizacion_id = p_org and m.persona_id = p_persona;
$$;

-- ¿Está inactiva ahora? Un cobro posterior a la inactivación (o un paquete vigente) la reactiva al instante.
create or replace function esta_inactiva(p_org uuid, p_persona uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select m.rol = 'comisionista' and m.inactiva_desde is not null
           and ultima_actividad_de(p_org, p_persona) < m.inactiva_desde
           and not paquete_vigente_de(p_org, p_persona)
      from membresias m
     where m.organizacion_id = p_org and m.persona_id = p_persona), false);
$$;

-- El estado completo, para el aviso, Accesos y Estadísticas.
-- estado: activa | por_vencer | inactiva | no_aplica (no es comisionista).
create or replace function inactividad_de(p_org uuid, p_persona uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  m       membresias;
  v_ult   timestamptz;
  v_paq   boolean;
  v_vence timestamptz;
  v_est   text;
begin
  select * into m from membresias where organizacion_id = p_org and persona_id = p_persona;
  if not found or m.rol <> 'comisionista' then
    return jsonb_build_object('estado', 'no_aplica');
  end if;
  v_ult := ultima_actividad_de(p_org, p_persona);
  v_paq := paquete_vigente_de(p_org, p_persona);
  v_vence := v_ult + interval '6 months';
  if m.inactividad_avisada_en is not null and m.inactividad_avisada_en > v_ult then
    v_vence := greatest(v_vence, m.inactividad_avisada_en + interval '15 days');
  end if;
  v_est := case
    when v_paq then 'activa'
    when m.inactiva_desde is not null and v_ult < m.inactiva_desde then 'inactiva'
    when m.inactividad_avisada_en is not null and m.inactividad_avisada_en > v_ult then 'por_vencer'
    else 'activa' end;
  return jsonb_build_object(
    'estado', v_est,
    'ultima_actividad', v_ult,
    'paquete', v_paq,
    'vence', case when v_paq then null else v_vence end,
    'dias', case when v_est = 'por_vencer' then greatest(0, ceil(extract(epoch from v_vence - now()) / 86400))::integer end,
    'inactiva_desde', case when v_est = 'inactiva' then m.inactiva_desde end);
end;
$$;

-- El aviso de la portada: el estado de quien pregunta.
create or replace function mi_inactividad()
returns jsonb language sql stable security definer set search_path = public as $$
  select inactividad_de(mi_org(), mi_persona_id());
$$;

-- Accesos y Estadísticas: todos los comisionistas de la organización (admin_org y finanzas).
create or replace function inactividad_org()
returns table (persona_id uuid, nombre text, estado text, ultima_actividad timestamptz, vence timestamptz,
               inactiva_desde timestamptz, paquete boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if mi_rol() not in ('admin_org', 'finanzas') then
    raise exception 'Solo administración';
  end if;
  return query
  select p.id, p.nombre, i->>'estado', (i->>'ultima_actividad')::timestamptz, (i->>'vence')::timestamptz,
         (i->>'inactiva_desde')::timestamptz, (i->>'paquete')::boolean
    from membresias m join personas p on p.id = m.persona_id, lateral inactividad_de(m.organizacion_id, m.persona_id) i
   where m.organizacion_id = mi_org() and m.rol = 'comisionista' and m.activa
   order by case i->>'estado' when 'inactiva' then 0 when 'por_vencer' then 1 else 2 end, p.nombre;
end;
$$;

-- El cron: deja el registro (aviso, inactivación, reactivación sola). Corre cada pasada; solo escribe si algo cambió.
create or replace function revisar_inactividad()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r         record;
  v_avisos  integer := 0;
  v_inact   integer := 0;
  v_reacts  integer := 0;
begin
  for r in
    select m.id, m.organizacion_id, m.persona_id, m.inactiva_desde, m.inactividad_avisada_en,
           ultima_actividad_de(m.organizacion_id, m.persona_id) as ult, paquete_vigente_de(m.organizacion_id, m.persona_id) as paq
      from membresias m
     where m.rol = 'comisionista' and m.activa
  loop
    if (r.inactiva_desde is not null or r.inactividad_avisada_en is not null)
       and (r.paq or r.ult >= coalesce(r.inactiva_desde, r.inactividad_avisada_en)) then
      perform set_config('tasa.motivo', case when r.paq then 'Activa: paquete de crédito vigente' else 'Activa: trabajo cobrado' end, true);
      update membresias set inactiva_desde = null, inactividad_avisada_en = null where id = r.id;
      v_reacts := v_reacts + 1;
    elsif r.paq then
      null;
    elsif r.inactiva_desde is null and r.inactividad_avisada_en is null and r.ult < now() - interval '6 months' + interval '15 days' then
      perform set_config('tasa.motivo', 'Aviso de inactividad: 15 días para un trabajo cobrado', true);
      update membresias set inactividad_avisada_en = now() where id = r.id;
      v_avisos := v_avisos + 1;
    elsif r.inactiva_desde is null and r.inactividad_avisada_en is not null and r.ult < now() - interval '6 months'
          and r.inactividad_avisada_en <= now() - interval '15 days' then
      perform set_config('tasa.motivo', 'Inactiva: 6 meses sin trabajo cobrado', true);
      update membresias set inactiva_desde = now() where id = r.id;
      v_inact := v_inact + 1;
    end if;
  end loop;
  perform set_config('tasa.motivo', '', true);
  return jsonb_build_object('avisos', v_avisos, 'inactivas', v_inact, 'reactivadas', v_reacts);
end;
$$;

-- admin_org la reactiva a mano, con motivo: cuenta como actividad (otros 6 meses).
create or replace function reactivar_inactiva(p_persona uuid, p_motivo text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform revisar_persona_de_mi_org(p_persona, p_motivo);
  if (inactividad_de(mi_org(), p_persona)->>'estado') not in ('inactiva', 'por_vencer') then
    raise exception 'Su cuenta no está inactiva ni por vencer';
  end if;
  perform set_config('tasa.motivo', 'Reactivada a mano: ' || trim(p_motivo), true);
  update membresias set inactiva_desde = null, inactividad_avisada_en = null, actividad_manual_en = now()
   where persona_id = p_persona and organizacion_id = mi_org();
  perform set_config('tasa.motivo', '', true);
end;
$$;

-- Las herramientas que se apagan a quien está inactivo.
create or replace function herramienta_de_activos(p_clave text)
returns boolean language sql immutable as $$
  select p_clave in ('mapa_catastral', 'mapa_catastral_pdf', 'calculadora_traslado_completa');
$$;

-- 0053 + inactividad.
create or replace function mis_herramientas()
returns table (clave text, nombre text, en_menu boolean, orden integer)
language sql stable security definer set search_path = public as $$
  select h.clave, h.nombre, h.en_menu, h.orden
    from herramientas h
   where h.organizacion_id = mi_org() and h.activa and mi_rol() = any (h.roles)
     and (mi_rol() <> 'comisionista' or h.niveles is null or mi_nivel_actual() = any (h.niveles))
     and not (mi_rol() = 'comisionista' and herramienta_de_activos(h.clave) and esta_inactiva(mi_org(), mi_persona_id()))
   order by h.orden;
$$;

-- 0059 + inactividad (lo usan la consulta del servidor, el PDF y el DXF).
create or replace function catastro_tiene_herramienta(p_org uuid, p_persona uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from herramientas h, lateral (select catastro_rol_de(p_org, p_persona) as v_rol) r
     where h.organizacion_id = p_org and h.clave = 'mapa_catastral' and h.activa and r.v_rol = any (h.roles)
       and (r.v_rol <> 'comisionista' or h.niveles is null or nivel_del_mes(p_org, p_persona, mes_mx(now())) = any (h.niveles))
       and not (r.v_rol = 'comisionista' and esta_inactiva(p_org, p_persona)));
$$;

revoke all on function paquete_vigente_de(uuid, uuid), ultima_actividad_de(uuid, uuid), esta_inactiva(uuid, uuid),
  inactividad_de(uuid, uuid), mi_inactividad(), inactividad_org(), revisar_inactividad(), reactivar_inactiva(uuid, text),
  herramienta_de_activos(text) from public, anon;
revoke all on function paquete_vigente_de(uuid, uuid), ultima_actividad_de(uuid, uuid), esta_inactiva(uuid, uuid),
  inactividad_de(uuid, uuid), revisar_inactividad() from authenticated;
-- esta_inactiva y herramienta_de_activos corren dentro de mis_herramientas (security definer): no necesitan grant aparte.
grant execute on function mi_inactividad(), inactividad_org(), reactivar_inactiva(uuid, text) to authenticated;
grant execute on function revisar_inactividad() to service_role;
