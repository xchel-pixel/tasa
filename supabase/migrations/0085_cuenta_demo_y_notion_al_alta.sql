-- ============================================================
-- 0085 — CUENTA DE DEMOSTRACIÓN Y PÁGINA DE NOTION AL DAR DE ALTA
--
-- 1. Cuenta de demostración (membresias.es_demo): una cuenta de
--    comisionista que solo sirve para enseñar los menús. Solo admin_org
--    la marca o desmarca, con motivo y bitácora. Con la marca:
--    · no envía solicitudes (candado en la base);
--    · no sale en estadísticas, no entra al cálculo de niveles del
--      cierre, no cuenta para inactividad ni tiene límite de equipos;
--    · ve todas las herramientas (no tiene nivel que las limite);
--    · no pide página de Notion (ni alerta de "sin página").
-- 2. Al aprobar un alta, la siguiente sincronización busca en Ext
--    Comisionistas una página con nombre igual o parecido: si no hay,
--    la crea y la liga; si hay, la propone en Hoy para confirmarla en
--    la ficha (alerta notion_pagina_propuesta). Ligarla la cierra.
-- ============================================================

alter table membresias add column es_demo boolean not null default false;
alter table comisionistas add column notion_alta_pendiente boolean not null default false;

create or replace function es_cuenta_demo(p_org uuid, p_persona uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select es_demo from membresias where organizacion_id = p_org and persona_id = p_persona), false);
$$;

create or replace function marcar_cuenta_demo(p_persona uuid, p_demo boolean, p_motivo text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform revisar_persona_de_mi_org(p_persona, p_motivo);
  if not exists (select 1 from membresias where persona_id = p_persona and organizacion_id = mi_org() and rol = 'comisionista') then
    raise exception 'Solo una cuenta de comisionista puede ser de demostración';
  end if;
  perform set_config('tasa.motivo', case when p_demo then 'Cuenta de demostración: ' else 'Ya no es cuenta de demostración: ' end
                                    || trim(p_motivo), true);
  update membresias set es_demo = p_demo,
         inactiva_desde = case when p_demo then null else inactiva_desde end,
         inactividad_avisada_en = case when p_demo then null else inactividad_avisada_en end
   where persona_id = p_persona and organizacion_id = mi_org() and es_demo is distinct from p_demo;
  if p_demo then
    update comisionistas set notion_alta_pendiente = false where persona_id = p_persona and organizacion_id = mi_org();
    update alertas set resuelta_en = now(), resuelta_por = mi_persona_id(), resolucion = 'Cuenta de demostración'
     where organizacion_id = mi_org() and tipo in ('notion_sin_pagina', 'notion_pagina_propuesta')
       and codigo = p_persona::text and resuelta_en is null;
  end if;
  perform set_config('tasa.motivo', '', true);
end;
$$;

-- Para la pantalla de Accesos (cada acción con su motivo, como suspender).
create or replace function marcar_demo(p_persona uuid, p_motivo text)
returns void language sql security definer set search_path = public as $$ select marcar_cuenta_demo(p_persona, true, p_motivo); $$;
create or replace function quitar_demo(p_persona uuid, p_motivo text)
returns void language sql security definer set search_path = public as $$ select marcar_cuenta_demo(p_persona, false, p_motivo); $$;

revoke all on function es_cuenta_demo(uuid, uuid), marcar_cuenta_demo(uuid, boolean, text), marcar_demo(uuid, text), quitar_demo(uuid, text)
  from public, anon;
grant execute on function marcar_cuenta_demo(uuid, boolean, text), marcar_demo(uuid, text), quitar_demo(uuid, text) to authenticated;

-- Candado: una cuenta de demostración no envía solicitudes (tampoco por su liga de clientes).
create or replace function demo_no_envia_solicitudes()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.comisionista_id is not null
     and exists (select 1 from membresias m where m.persona_id = new.comisionista_id and m.es_demo
                   and (new.organizacion_id is null or m.organizacion_id = new.organizacion_id)) then
    raise exception 'Cuenta de demostración: no envía solicitudes';
  end if;
  return new;
end;
$$;
create trigger demo_no_envia_solicitudes before insert on solicitudes
  for each row execute function demo_no_envia_solicitudes();

-- Niveles: el cierre no le calcula nivel.
create or replace function demo_sin_nivel()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if es_cuenta_demo(new.organizacion_id, new.comisionista_id) then
    return null;
  end if;
  return new;
end;
$$;
create trigger demo_sin_nivel before insert or update on niveles_mensuales
  for each row execute function demo_sin_nivel();

revoke all on function demo_no_envia_solicitudes(), demo_sin_nivel() from public, anon, authenticated;

-- 0077 + la cuenta de demostración ve todas las herramientas (no tiene nivel que las limite).
create or replace function herramientas_sin_limite(p_org uuid, p_persona uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((paquete_vigente(p_org, p_persona)).cupos = 'sin_limite', false) or es_cuenta_demo(p_org, p_persona);
$$;

-- 0076 + sin límite de equipos.
create or replace function limite_equipos_de(p_org uuid, p_persona uuid)
returns integer language sql stable security definer set search_path = public as $$
  select case when m.rol = 'admin_org' or m.es_demo then null
              else (select (a.limite_equipos ->> m.rol)::integer from ajustes a where a.organizacion_id = p_org) end
    from membresias m where m.organizacion_id = p_org and m.persona_id = p_persona;
$$;

-- 0075 + fuera de inactividad.
create or replace function esta_inactiva(p_org uuid, p_persona uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select m.rol = 'comisionista' and not m.es_demo and m.inactiva_desde is not null
           and ultima_actividad_de(p_org, p_persona) < m.inactiva_desde
           and not paquete_vigente_de(p_org, p_persona)
      from membresias m
     where m.organizacion_id = p_org and m.persona_id = p_persona), false);
$$;

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
   where m.organizacion_id = mi_org() and m.rol = 'comisionista' and m.activa and not m.es_demo
   order by case i->>'estado' when 'inactiva' then 0 when 'por_vencer' then 1 else 2 end, p.nombre;
end;
$$;

-- 0052/0084 + la cuenta de demostración no pide página de Notion.
create or replace function avisar_sin_pagina(p_org uuid, p_persona uuid, p_para text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_nombre text := (select nombre from personas where id = p_persona);
begin
  if es_cuenta_demo(p_org, p_persona) then
    return;
  end if;
  insert into alertas (organizacion_id, tipo, codigo, mensaje)
  values (p_org, 'notion_sin_pagina', p_persona::text,
          'Comisionista sin página de Notion: ' || v_nombre || '. Se escribió ' || p_para
          || ' sin tocar su relación en el trámite. Lígalo en su ficha.')
  on conflict do nothing;
end;
$$;
revoke all on function avisar_sin_pagina(uuid, uuid, text) from public, anon, authenticated;

-- ------------------------------------------------------------
-- 2. Página de Notion al dar de alta
-- ------------------------------------------------------------

alter table alertas drop constraint alertas_tipo_check;
alter table alertas drop constraint alertas_tipo_completo;
alter table alertas
  add constraint alertas_tipo_check check (tipo in ('cancelado_externo', 'externo_borrado', 'liga_inactiva', 'conector',
                                                    'estimado_sin_final', 'liga_limite', 'pago_por_entregar', 'externo_solicitado',
                                                    'perfil_por_aprobar', 'externo_comision', 'notion_sin_pagina', 'notion_pago',
                                                    'parametros_fiscales', 'cupo_agotado', 'catastro', 'credito_no_aplicado',
                                                    'externo_credito', 'notion_pagina_propuesta')),
  add constraint alertas_tipo_completo check (
    (tipo in ('cancelado_externo', 'externo_borrado', 'liga_inactiva', 'estimado_sin_final', 'pago_por_entregar',
              'externo_solicitado', 'externo_comision', 'credito_no_aplicado', 'externo_credito')
     and solicitud_id is not null)
    or (tipo = 'conector' and conector_id is not null and codigo is not null)
    or (tipo in ('liga_limite', 'perfil_por_aprobar', 'notion_sin_pagina', 'notion_pago', 'parametros_fiscales', 'cupo_agotado', 'catastro',
                 'notion_pagina_propuesta')
        and codigo is not null));

drop index if exists alertas_codigo_una_abierta;
create unique index alertas_codigo_una_abierta
  on alertas (organizacion_id, tipo, codigo) where resuelta_en is null
  and tipo in ('notion_sin_pagina', 'notion_pago', 'parametros_fiscales', 'cupo_agotado', 'catastro', 'notion_pagina_propuesta');

-- Al nacer el comisionista (alta aprobada o capturada), queda por ligar si la organización sincroniza con Notion.
create or replace function notion_al_dar_de_alta()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.notion_pagina is null and hay_conector_notion(new.organizacion_id) then
    update comisionistas set notion_alta_pendiente = true
     where organizacion_id = new.organizacion_id and persona_id = new.persona_id;
  end if;
  return null;
end;
$$;
create trigger notion_al_dar_de_alta after insert on comisionistas
  for each row execute function notion_al_dar_de_alta();
revoke all on function notion_al_dar_de_alta() from public, anon, authenticated;

-- Lo que el sync tiene por ligar: nombre y las páginas ya ligadas a otros (para no proponerlas).
create or replace function por_ligar_comisionistas_afuera(p_conector uuid)
returns table (persona_id uuid, nombre text, ligadas text[])
language sql stable security definer set search_path = public as $$
  select c.persona_id, p.nombre,
         array(select x.notion_pagina from comisionistas x where x.organizacion_id = c.organizacion_id and x.notion_pagina is not null)
    from comisionistas c join personas p on p.id = c.persona_id
    join conectores k on k.id = p_conector and k.organizacion_id = c.organizacion_id
   where puede_operar_conector(p_conector) and c.notion_alta_pendiente and c.notion_pagina is null
     and not es_cuenta_demo(c.organizacion_id, c.persona_id);
$$;

-- p_pagina: la creó y queda ligada. p_candidatos ([{id, nombre}]): hay parecidas, se proponen en Hoy. p_error: alerta.
create or replace function registrar_comisionista_afuera(p_conector uuid, p_persona uuid, p_pagina text, p_nombre_pagina text,
                                                         p_candidatos jsonb, p_error text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_org    uuid;
  v_nombre text := (select nombre from personas where id = p_persona);
  v_lista  text;
begin
  if not puede_operar_conector(p_conector) then
    raise exception 'Solo admin_org sincroniza el conector';
  end if;
  select c.organizacion_id into v_org from comisionistas c join conectores k on k.id = p_conector and k.organizacion_id = c.organizacion_id
   where c.persona_id = p_persona and c.notion_alta_pendiente for update of c;
  if not found then
    return;
  end if;
  if p_error is null and p_pagina is not null then
    perform set_config('tasa.motivo', 'Notion: página creada al dar de alta: ' || coalesce(p_nombre_pagina, p_pagina), true);
    update comisionistas set notion_pagina = replace(lower(p_pagina), '-', ''), notion_nombre = left(p_nombre_pagina, 200),
           notion_alta_pendiente = false
     where organizacion_id = v_org and persona_id = p_persona;
  else
    perform set_config('tasa.motivo', case when p_error is not null then 'Notion no creó su página: ' || p_error
                                           else 'Notion: páginas parecidas por confirmar' end, true);
    update comisionistas set notion_alta_pendiente = false where organizacion_id = v_org and persona_id = p_persona;
    select string_agg('"' || (c ->> 'nombre') || '"', ', ') into v_lista from jsonb_array_elements(coalesce(p_candidatos, '[]')) c;
    insert into alertas (organizacion_id, tipo, codigo, mensaje)
    values (v_org, 'notion_pagina_propuesta', p_persona::text,
            case when p_error is not null
                 then 'No se pudo crear la página de Notion de ' || v_nombre || ' (' || p_error || '). Lígala o créala en su ficha.'
                 else 'Página de Notion por confirmar: ' || v_nombre || '. En Ext Comisionistas ya hay ' || coalesce(v_lista, '') ||
                      '. Confirma en su ficha cuál es (o créala).' end)
    on conflict do nothing;
  end if;
  perform set_config('tasa.motivo', '', true);
end;
$$;

revoke all on function por_ligar_comisionistas_afuera(uuid), registrar_comisionista_afuera(uuid, uuid, text, text, jsonb, text)
  from public, anon, authenticated;
grant execute on function por_ligar_comisionistas_afuera(uuid), registrar_comisionista_afuera(uuid, uuid, text, text, jsonb, text)
  to authenticated, service_role;

-- 0052 + ligarla a mano también cierra la propuesta y lo que quedaba pendiente.
create or replace function ligar_pagina_notion(p_persona uuid, p_pagina text, p_nombre text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_pagina text := nullif(replace(lower(trim(coalesce(p_pagina, ''))), '-', ''), '');
begin
  if not soy_admin_org() then
    raise exception 'Solo admin_org liga comisionistas con Notion';
  end if;
  if v_pagina is not null and v_pagina !~ '^[0-9a-f]{32}$' then
    raise exception 'Esa no es una página de Notion';
  end if;
  if v_pagina is not null and exists (select 1 from comisionistas where organizacion_id = mi_org()
                                         and notion_pagina = v_pagina and persona_id <> p_persona) then
    raise exception 'Esa página de Notion ya está ligada a otro comisionista';
  end if;
  perform set_config('tasa.motivo', case when v_pagina is null then 'Página en Notion: quitada'
                                         else 'Página en Notion: ' || coalesce(trim(p_nombre), v_pagina) end, true);
  update comisionistas set notion_pagina = v_pagina, notion_nombre = case when v_pagina is not null then left(trim(p_nombre), 200) end,
         notion_alta_pendiente = false
   where organizacion_id = mi_org() and persona_id = p_persona;
  if not found then
    raise exception 'No existe ese comisionista';
  end if;
  if v_pagina is not null then
    update alertas set resuelta_en = now(), resuelta_por = mi_persona_id(), resolucion = 'Página en Notion ligada'
     where organizacion_id = mi_org() and tipo in ('notion_sin_pagina', 'notion_pagina_propuesta')
       and codigo = p_persona::text and resuelta_en is null;
  end if;
  perform set_config('tasa.motivo', '', true);
end;
$$;

-- 0073 + fuera de estadísticas (uso, personas, embudo).
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
       and (p_persona is null or e.persona_id = p_persona) and not es_cuenta_demo(v_org, e.persona_id)
       and (p_herramienta is null or e.herramienta = p_herramienta)
       and (p_nivel is null or nivel_del_mes(v_org, e.persona_id, mes_mx(e.creado_en)) = p_nivel)),
  gente as (
    select m.persona_id, p.nombre, m.rol,
           case when m.rol = 'comisionista' then nivel_del_mes(v_org, m.persona_id, v_mes) end as nivel_id
      from membresias m join personas p on p.id = m.persona_id
     where m.organizacion_id = v_org and m.rol in ('comisionista', 'equipo') and not m.es_demo
       and (p_persona is null or m.persona_id = p_persona)),
  gente_f as (select g.* from gente g where p_nivel is null or g.nivel_id = p_nivel),
  usos as (
    select u.persona_id, u.herramienta, count(*) as usados from usos_herramienta u
     where u.organizacion_id = v_org and not u.humo and u.creado_en >= v_ini and u.creado_en < v_fin and not es_cuenta_demo(v_org, u.persona_id)
       and u.herramienta in ('mapa_catastral', 'mapa_catastral_pdf', 'calculadora_traslado', 'calculadora_traslado_completa')
       and (p_herramienta is null or u.herramienta = p_herramienta)
     group by 1, 2),
  sol as (
    select s.comisionista_id, s.origen_herramienta, count(*) as solicitudes, count(*) filter (where s.estado = 'tramite') as tramites
      from solicitudes s
     where s.organizacion_id = v_org and s.origen_herramienta is not null and not es_cuenta_demo(v_org, s.comisionista_id) and s.creado_en >= v_ini and s.creado_en < v_fin
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

-- 0075 + fuera de la revisión de inactividad.
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
     where m.rol = 'comisionista' and m.activa and not m.es_demo
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

-- 0076 + si es cuenta de demostración.
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
    'demo', m.es_demo,
    'yo', p.id = mi_persona_id(),
    'nivel', case when m.rol = 'comisionista' then (select n.nombre from niveles n where n.id = nivel_del_mes(v_org, p.id, mes_mx(now()))) end,
    'ultimo_acceso', ultimo_acceso_de(p.id),
    'sesiones', coalesce((select jsonb_agg(jsonb_build_object(
                   'creada', s.created_at, 'actividad', coalesce(s.refreshed_at::timestamptz, s.updated_at, s.created_at),
                   'navegador', s.user_agent, 'ip', ip_recortada(s.ip),
                   'humo', exists (select 1 from sesiones_humo h where h.session_id = s.id)) order by coalesce(s.refreshed_at::timestamptz, s.updated_at, s.created_at) desc)
                   from auth.sessions s where s.user_id = p.user_id), '[]'),
    'cupos', (select jsonb_object_agg(h, (select to_jsonb(c) from cupo_de(v_org, p.id, h) c))
                from unnest(array['mapa_catastral', 'mapa_catastral_pdf', 'calculadora_traslado', 'calculadora_traslado_completa']) h),
    'eventos', coalesce((select jsonb_agg(to_jsonb(e) - 'organizacion_id' - 'persona_id' order by e.creado_en desc)
                          from (select * from eventos_uso where organizacion_id = v_org and persona_id = p.id and not humo
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
