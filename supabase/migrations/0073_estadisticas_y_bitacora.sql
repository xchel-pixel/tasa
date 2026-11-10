-- ============================================================
-- 0073 — ESTADÍSTICAS Y BITÁCORA POR ORGANIZACIÓN
--
-- · estadisticas(desde, hasta, persona, nivel, herramienta): lo que ve
--   Administración → Estadísticas (admin_org y finanzas, solo lectura).
--   Todo sin lo de humo (0072). Fechas en hora de México, ambas
--   incluidas. Secciones: uso del periodo, por persona y nivel (uso
--   contra cupo), embudo mapa/calculadora → solicitudes → trámites, por
--   municipio y colonia, y salud de la fuente por día. Nada de
--   propietarios: solo claves, colonias y conteos.
-- · bitacora_org(desde, hasta, persona, tabla): la bitácora de la
--   organización para admin_org (la tabla bitacora solo la lee
--   super_plataforma; esto filtra a lo de su organización).
-- ============================================================

create or replace function estadisticas(p_desde date, p_hasta date, p_persona uuid default null, p_nivel uuid default null,
                                        p_herramienta text default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_org    uuid := mi_org();
  v_ini    timestamptz := (p_desde::timestamp) at time zone 'America/Mexico_City';
  v_fin    timestamptz := ((p_hasta + 1)::timestamp) at time zone 'America/Mexico_City';
  v_mes    date := date_trunc('month', p_desde)::date;
  v_un_mes boolean := date_trunc('month', p_desde) = date_trunc('month', p_hasta);
  v_r      jsonb;
begin
  if not soy_staff() then
    raise exception 'Solo administración';
  end if;
  if p_desde is null or p_hasta is null or p_hasta < p_desde or p_hasta - p_desde > 400 then
    raise exception 'Periodo inválido (hasta 400 días)';
  end if;

  with
  ev as (
    select e.* from eventos_uso e
     where e.organizacion_id = v_org and not e.humo and e.creado_en >= v_ini and e.creado_en < v_fin
       and (p_persona is null or e.persona_id = p_persona)
       and (p_herramienta is null or e.herramienta = p_herramienta)
       and (p_nivel is null or nivel_del_mes(v_org, e.persona_id, mes_mx(e.creado_en)) = p_nivel)),
  gente as (
    select m.persona_id, p.nombre, m.rol,
           case when m.rol = 'comisionista' then nivel_del_mes(v_org, m.persona_id, v_mes) end as nivel_id
      from membresias m join personas p on p.id = m.persona_id
     where m.organizacion_id = v_org and m.rol in ('comisionista', 'equipo')
       and (p_persona is null or m.persona_id = p_persona)),
  gente_f as (select g.* from gente g where p_nivel is null or g.nivel_id = p_nivel),
  usos as (
    select u.persona_id, u.herramienta, count(*) as usados from usos_herramienta u
     where u.organizacion_id = v_org and not u.humo and u.creado_en >= v_ini and u.creado_en < v_fin
       and u.herramienta in ('mapa_catastral', 'mapa_catastral_pdf', 'calculadora_traslado', 'calculadora_traslado_completa')
       and (p_herramienta is null or u.herramienta = p_herramienta)
     group by 1, 2),
  sol as (
    select s.comisionista_id, s.origen_herramienta, count(*) as solicitudes, count(*) filter (where s.estado = 'tramite') as tramites
      from solicitudes s
     where s.organizacion_id = v_org and s.origen_herramienta is not null and s.creado_en >= v_ini and s.creado_en < v_fin
     group by 1, 2)
  select jsonb_build_object(
    'periodo', jsonb_build_object('desde', p_desde, 'hasta', p_hasta, 'un_mes', v_un_mes),
    'uso', (select jsonb_build_object(
        'fuente', count(*) filter (where evento = 'consulta' and origen = 'fuente' and resultado in ('ok', 'pendiente')),
        'guardado', count(*) filter (where evento = 'consulta' and origen = 'guardado'),
        'fallas', count(*) filter (where evento = 'consulta' and origen = 'fuente' and resultado = 'falla'),
        'pdf', count(*) filter (where evento = 'pdf'), 'pdf_nuevos', count(*) filter (where evento = 'pdf' and consumio),
        'dxf', count(*) filter (where evento = 'dxf'), 'dxf_nuevos', count(*) filter (where evento = 'dxf' and consumio),
        'calculo_rapida', count(*) filter (where evento = 'calculo' and herramienta = 'calculadora_traslado'),
        'calculo_completa', count(*) filter (where evento = 'calculo' and herramienta = 'calculadora_traslado_completa'),
        'denegaciones', count(*) filter (where evento = 'denegado'),
        'accesos', count(*) filter (where evento = 'acceso')) from ev),
    'personas', coalesce((select jsonb_agg(x order by (x->>'total')::int desc, x->>'nombre') from (
        select jsonb_build_object(
          'persona_id', g.persona_id, 'nombre', g.nombre, 'rol', g.rol,
          'nivel', (select n.nombre from niveles n where n.id = g.nivel_id),
          'total', coalesce((select sum(u.usados) from usos u where u.persona_id = g.persona_id), 0),
          'cupos', (select jsonb_object_agg(h, jsonb_build_object(
                      'usados', coalesce((select u.usados from usos u where u.persona_id = g.persona_id and u.herramienta = h), 0),
                      -- El límite solo se compara si el periodo es un solo mes (los cupos son mensuales); nulo = sin límite.
                      'limite', case when v_un_mes and g.rol = 'comisionista' then
                                  (select c.cantidad from cupos_herramienta c where c.organizacion_id = v_org and c.herramienta = h and c.nivel_id = g.nivel_id) end,
                      'extras', case when v_un_mes then coalesce((select sum(x.cantidad) from extras_herramienta x
                                  where x.organizacion_id = v_org and x.persona_id = g.persona_id and x.herramienta = h and x.mes = v_mes), 0) end))
                    from unnest(array['mapa_catastral', 'mapa_catastral_pdf', 'calculadora_traslado', 'calculadora_traslado_completa']) h
                    where p_herramienta is null or h = p_herramienta),
          'pidio_mas', (select count(*) from alertas a where a.organizacion_id = v_org and a.tipo = 'cupo_agotado'
                          and a.codigo like g.persona_id::text || ':%' and a.creada_en >= v_ini and a.creada_en < v_fin),
          'denegaciones', (select count(*) from ev where ev.persona_id = g.persona_id and ev.evento = 'denegado')) as x
          from gente_f g) t
        where (x->>'total')::int > 0 or (x->>'pidio_mas')::int > 0 or (x->>'denegaciones')::int > 0), '[]'),
    'embudo', coalesce((select jsonb_agg(x order by x->>'nombre') from (
        select jsonb_build_object(
          'persona_id', g.persona_id, 'nombre', g.nombre,
          'mapa_consultas', (select count(*) from ev where ev.persona_id = g.persona_id and ev.evento = 'consulta'),
          'mapa_solicitudes', coalesce((select s.solicitudes from sol s where s.comisionista_id = g.persona_id and s.origen_herramienta = 'mapa_catastral'), 0),
          'mapa_tramites', coalesce((select s.tramites from sol s where s.comisionista_id = g.persona_id and s.origen_herramienta = 'mapa_catastral'), 0),
          'calc_calculos', (select count(*) from ev where ev.persona_id = g.persona_id and ev.evento = 'calculo'),
          'calc_solicitudes', coalesce((select s.solicitudes from sol s where s.comisionista_id = g.persona_id and s.origen_herramienta = 'calculadora_traslado'), 0),
          'calc_tramites', coalesce((select s.tramites from sol s where s.comisionista_id = g.persona_id and s.origen_herramienta = 'calculadora_traslado'), 0)) as x
          from gente_f g where g.rol = 'comisionista') t
        where (x->>'mapa_consultas')::int + (x->>'mapa_solicitudes')::int + (x->>'calc_calculos')::int + (x->>'calc_solicitudes')::int > 0), '[]'),
    'zonas', coalesce((select jsonb_agg(z order by (z->>'consultas')::int desc) from (
        select jsonb_build_object('municipio', left(ev.clave, 2), 'ejemplo', min(ev.clave),
                                  'colonia', coalesce(nullif(trim(cp.colonia), ''), 'Sin colonia'),
                                  'consultas', count(*), 'predios', count(distinct ev.clave), 'personas', count(distinct ev.persona_id)) as z
          from ev left join catastro_predios cp on cp.clave = ev.clave
         where ev.evento = 'consulta' and ev.clave is not null
         group by left(ev.clave, 2), coalesce(nullif(trim(cp.colonia), ''), 'Sin colonia')) t), '[]'),
    'salud', coalesce((select jsonb_agg(d order by d->>'dia') from (
        select jsonb_build_object('dia', (ev.creado_en at time zone 'America/Mexico_City')::date,
                                  'consultas', count(*), 'fallas', count(*) filter (where resultado = 'falla'),
                                  'ms_promedio', round(avg(duracion_ms) filter (where resultado <> 'falla'))) as d
          from ev where ev.evento = 'consulta' and ev.origen = 'fuente'
         group by (ev.creado_en at time zone 'America/Mexico_City')::date) t), '[]')
  ) into v_r;
  return v_r;
end;
$$;

-- La bitácora de la organización: lo que tiene su organización en antes/después, y los cambios a personas y sesiones
-- de gente de la organización. Con los campos que cambiaron (valor anterior y nuevo, recortados).
create or replace function bitacora_org(p_desde date, p_hasta date, p_persona uuid default null, p_tabla text default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_org uuid := mi_org();
  v_ini timestamptz := (p_desde::timestamp) at time zone 'America/Mexico_City';
  v_fin timestamptz := ((p_hasta + 1)::timestamp) at time zone 'America/Mexico_City';
begin
  if not soy_admin_org() then
    raise exception 'Solo admin_org';
  end if;
  if p_desde is null or p_hasta is null or p_hasta < p_desde then
    raise exception 'Periodo inválido';
  end if;
  return jsonb_build_object(
    'filas', coalesce((select jsonb_agg(f order by f->>'creado_en' desc) from (
      select jsonb_build_object(
        'id', b.id, 'creado_en', b.creado_en, 'tabla', b.tabla, 'accion', b.accion, 'motivo', nullif(b.motivo, ''),
        'quien', (select q.nombre from personas q where q.id = b.persona_id),
        'afectado', (select q.nombre from personas q
                      where q.id::text = coalesce(b.despues ->> 'persona_id', b.antes ->> 'persona_id',
                                                  case when b.tabla in ('personas', 'auth.sessions') then b.registro_id end)),
        'cambios', (select coalesce(jsonb_agg(jsonb_build_object('campo', k, 'antes', left(b.antes ->> k, 80), 'despues', left(b.despues ->> k, 80))
                                              order by k), '[]')
                      from (select key k from jsonb_each(coalesce(b.despues, '{}')) union select key from jsonb_each(coalesce(b.antes, '{}'))) x
                     where b.antes -> k is distinct from b.despues -> k
                       and k not in ('actualizado_en', 'creado_en', 'id', 'organizacion_id'))) as f
        from bitacora b
       where b.creado_en >= v_ini and b.creado_en < v_fin
         and (p_tabla is null or b.tabla = p_tabla)
         and (coalesce(b.despues ->> 'organizacion_id', b.antes ->> 'organizacion_id') = v_org::text
              or (b.tabla in ('personas', 'auth.sessions')
                  and exists (select 1 from membresias m where m.organizacion_id = v_org and m.persona_id::text = b.registro_id)))
         and (p_persona is null or b.persona_id = p_persona or b.registro_id = p_persona::text
              or b.despues ->> 'persona_id' = p_persona::text or b.antes ->> 'persona_id' = p_persona::text)
       order by b.creado_en desc
       limit 300) t), '[]'),
    'tablas', coalesce((select jsonb_agg(distinct b.tabla order by b.tabla) from bitacora b
                        where b.creado_en >= now() - interval '400 days'
                          and coalesce(b.despues ->> 'organizacion_id', b.antes ->> 'organizacion_id') = v_org::text), '[]'));
end;
$$;

revoke all on function estadisticas(date, date, uuid, uuid, text), bitacora_org(date, date, uuid, text) from public, anon, authenticated;
grant execute on function estadisticas(date, date, uuid, uuid, text), bitacora_org(date, date, uuid, text) to authenticated;
