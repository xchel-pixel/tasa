-- ============================================================
-- 0098 — DESCARGA DXF POR ZONA Y ALERTA DE BLOQUEO DE LA FUENTE
--
-- 1. Descarga por zona: un rectángulo de hasta 500 × 500 m (25 ha) con los
--    predios (urbanos y rústicos) y sus construcciones por nivel, en un DXF.
--    - Solo admin_org. El equipo, cuando admin_org prenda el interruptor de
--      Ajustes (ajustes.zona_dxf_equipo, apagado al crearse).
--    - 5 zonas al día por persona y 20 por organización (hora de México),
--      contando cada intento (cada uno pidió a la fuente). Una zona a la vez
--      por organización.
--    - Cuesta 10 DXF del saldo; admin_org sin límite. Si la fuente falla, se
--      devuelven. Todo queda en catastro_zonas y en eventos_uso (bitácora y
--      estadísticas); catastro_zonas_por_dia() es su reporte de consumo.
-- 2. catastro_aviso_fuente(): cualquier respuesta 403 o 429 de la fuente en una
--    consulta del mapa abre al momento una alerta para admin_org ("nos están
--    limitando"). Las demás fallas siguen la regla de 0059 (3 en una hora).
-- ============================================================

-- ------------------------------------------------------------
-- El interruptor de Ajustes
-- ------------------------------------------------------------
alter table ajustes add column zona_dxf_equipo boolean not null default false;

create or replace function guardar_zona_dxf_equipo(p_activa boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not soy_admin_org() then
    raise exception 'Solo admin_org';
  end if;
  perform set_config('tasa.motivo', 'Descarga por zona para el equipo', true);
  update ajustes set zona_dxf_equipo = coalesce(p_activa, false) where organizacion_id = mi_org();
  perform set_config('tasa.motivo', '', true);
end;
$$;
revoke all on function guardar_zona_dxf_equipo(boolean) from public, anon, authenticated;
grant execute on function guardar_zona_dxf_equipo(boolean) to authenticated;

-- La zona en la bitácora de uso.
alter table eventos_uso drop constraint eventos_uso_herramienta_check;
alter table eventos_uso add constraint eventos_uso_herramienta_check
  check (herramienta in ('mapa_catastral', 'mapa_catastral_pdf', 'mapa_catastral_dxf', 'mapa_catastral_mosaicos', 'mapa_catastral_zona',
                         'calculadora_traslado', 'calculadora_traslado_completa', 'acceso'));

-- ------------------------------------------------------------
-- Las zonas pedidas
-- ------------------------------------------------------------
create table catastro_zonas (
  id              uuid primary key default gen_random_uuid(),
  organizacion_id uuid not null references organizaciones(id) on delete cascade,
  persona_id      uuid references personas(id) on delete set null,
  -- El rectángulo en UTM 14N (metros).
  x0 numeric(12, 2) not null, y0 numeric(12, 2) not null, x1 numeric(12, 2) not null, y1 numeric(12, 2) not null,
  hectareas       numeric(8, 4) not null,
  estado          text not null default 'en_curso' check (estado in ('en_curso', 'ok', 'falla')),
  -- Falla: en qué consulta y por qué (sin nada de lo que respondió la fuente).
  codigo          text check (codigo is null or char_length(codigo) <= 40),
  predios         integer check (predios >= 0),
  construcciones  integer check (construcciones >= 0),
  dxf_cobrados    integer not null default 0 check (dxf_cobrados >= 0),
  creado_en       timestamptz not null default now(),
  terminado_en    timestamptz
);
create index on catastro_zonas (organizacion_id, creado_en desc);
create index on catastro_zonas (persona_id, creado_en desc);
alter table catastro_zonas enable row level security;
revoke all on catastro_zonas from anon;
revoke all on catastro_zonas from authenticated;
-- Cada quien ve las suyas; admin_org, las de su organización. Se escriben solo por las funciones.
create policy leer_catastro_zonas on catastro_zonas for select
  using (organizacion_id = (select mi_org()) and (persona_id = (select mi_persona_id()) or (select soy_admin_org())));
grant select on catastro_zonas to authenticated;

-- ¿Puede bajar zonas? 'ok' o el motivo.
create or replace function catastro_zona_permiso(p_org uuid, p_persona uuid)
returns text language sql stable security definer set search_path = public as $$
  select case
    when p_org is null or p_persona is null or not catastro_tiene_herramienta(p_org, p_persona) then 'sin_herramienta'
    when catastro_rol_de(p_org, p_persona) = 'admin_org' then 'ok'
    when catastro_rol_de(p_org, p_persona) = 'equipo'
         and coalesce((select a.zona_dxf_equipo from ajustes a where a.organizacion_id = p_org), false) then 'ok'
    else 'rol' end;
$$;
revoke all on function catastro_zona_permiso(uuid, uuid) from public, anon, authenticated;

-- Para pintar: si puede, cuántas lleva hoy (suyas y de la organización) y los topes.
create or replace function catastro_zona_estado()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'puede', catastro_zona_permiso(mi_org(), mi_persona_id()) = 'ok',
    'hoy_persona', (select count(*) from catastro_zonas z where z.organizacion_id = mi_org() and z.persona_id = mi_persona_id()
                      and (z.creado_en at time zone 'America/Mexico_City')::date = (now() at time zone 'America/Mexico_City')::date),
    'hoy_org', (select count(*) from catastro_zonas z where z.organizacion_id = mi_org()
                  and (z.creado_en at time zone 'America/Mexico_City')::date = (now() at time zone 'America/Mexico_City')::date),
    'tope_persona', 5, 'tope_org', 20, 'costo_dxf', 10);
$$;
revoke all on function catastro_zona_estado() from public, anon, authenticated;
grant execute on function catastro_zona_estado() to authenticated;

-- Antes de ir a la fuente: revisa todo, cobra los 10 DXF y abre la zona. Devuelve {id} o {error, estado}.
create or replace function catastro_zona_pedir(p_x0 numeric, p_y0 numeric, p_x1 numeric, p_y1 numeric)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_org     uuid := mi_org();
  v_persona uuid := mi_persona_id();
  v_motivo  text := catastro_zona_permiso(mi_org(), mi_persona_id());
  v_ancho   numeric := abs(p_x1 - p_x0);
  v_alto    numeric := abs(p_y1 - p_y0);
  v_cobro   integer := 0;
  a         dxf_autorizaciones;
  v_id      uuid;
begin
  if v_motivo <> 'ok' then
    perform registrar_denegacion('mapa_catastral_zona', v_motivo, 403::smallint);
    return jsonb_build_object('error', 'La descarga por zona no está disponible para ti', 'estado', 403);
  end if;
  if p_x0 is null or p_y0 is null or p_x1 is null or p_y1 is null
     or least(p_x0, p_x1) < 250000 or greatest(p_x0, p_x1) > 480000 or least(p_y0, p_y1) < 2240000 or greatest(p_y0, p_y1) > 2400000 then
    return jsonb_build_object('error', 'La zona debe estar en Querétaro', 'estado', 400);
  end if;
  if v_ancho < 5 or v_alto < 5 then
    return jsonb_build_object('error', 'La zona es demasiado chica: dibuja un rectángulo más grande', 'estado', 400);
  end if;
  if v_ancho > 500 or v_alto > 500 then
    return jsonb_build_object('error', 'Cada lado de la zona puede medir hasta 500 m (25 ha en total)', 'estado', 400);
  end if;

  -- Una a la vez por organización, y los topes del día, sin carreras.
  perform pg_advisory_xact_lock(hashtext('catastro_zona:' || v_org));
  if exists (select 1 from catastro_zonas z where z.organizacion_id = v_org and z.estado = 'en_curso'
               and z.creado_en > now() - interval '2 minutes') then
    return jsonb_build_object('error', 'Hay otra zona descargándose en tu organización. Espera un momento.', 'estado', 429);
  end if;
  if (select count(*) from catastro_zonas z where z.organizacion_id = v_org and z.persona_id = v_persona
        and (z.creado_en at time zone 'America/Mexico_City')::date = (now() at time zone 'America/Mexico_City')::date) >= 5 then
    perform registrar_denegacion('mapa_catastral_zona', 'tope_dia', 429::smallint);
    return jsonb_build_object('error', 'Llegaste al tope de 5 zonas al día. Mañana se reinicia.', 'estado', 429);
  end if;
  if (select count(*) from catastro_zonas z where z.organizacion_id = v_org
        and (z.creado_en at time zone 'America/Mexico_City')::date = (now() at time zone 'America/Mexico_City')::date) >= 20 then
    perform registrar_denegacion('mapa_catastral_zona', 'tope_dia_org', 429::smallint);
    return jsonb_build_object('error', 'Tu organización llegó al tope de 20 zonas al día. Mañana se reinicia.', 'estado', 429);
  end if;

  -- 10 DXF por zona, del mismo saldo del DXF individual (0065). admin_org: sin límite.
  if catastro_rol_de(v_org, v_persona) <> 'admin_org' then
    select * into a from dxf_autorizaciones where organizacion_id = v_org and persona_id = v_persona and activa for update;
    if not found then
      perform registrar_denegacion('mapa_catastral_zona', 'no_autorizado', 403::smallint);
      return jsonb_build_object('error', 'El DXF no está disponible para ti', 'estado', 403);
    end if;
    if a.saldo is not null then
      if a.saldo < 10 then
        perform registrar_denegacion('mapa_catastral_zona', 'sin_saldo', 429::smallint);
        return jsonb_build_object('error', 'Una zona cuesta 10 DXF y te quedan ' || a.saldo || '. Pide más.', 'estado', 429);
      end if;
      update dxf_autorizaciones set saldo = saldo - 10, actualizado_en = now() where organizacion_id = v_org and persona_id = v_persona;
      v_cobro := 10;
    end if;
  end if;

  insert into catastro_zonas (organizacion_id, persona_id, x0, y0, x1, y1, hectareas, dxf_cobrados)
  values (v_org, v_persona, least(p_x0, p_x1), least(p_y0, p_y1), greatest(p_x0, p_x1), greatest(p_y0, p_y1),
          round(v_ancho * v_alto / 10000, 4), v_cobro)
  returning id into v_id;
  return jsonb_build_object('id', v_id);
end;
$$;
revoke all on function catastro_zona_pedir(numeric, numeric, numeric, numeric) from public, anon, authenticated;
grant execute on function catastro_zona_pedir(numeric, numeric, numeric, numeric) to authenticated;

-- Al terminar (la misma persona): ok con los conteos, o falla con el código; si falla, se devuelven los DXF.
create or replace function catastro_zona_terminar(p_id uuid, p_ok boolean, p_codigo text default null, p_predios integer default null,
  p_construcciones integer default null, p_duracion integer default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  z catastro_zonas;
begin
  select * into z from catastro_zonas where id = p_id and persona_id = mi_persona_id() and organizacion_id = mi_org() and estado = 'en_curso'
     for update;
  if not found then
    raise exception 'Esa zona no está en curso';
  end if;
  update catastro_zonas set estado = case when p_ok then 'ok' else 'falla' end, codigo = left(p_codigo, 40),
         predios = p_predios, construcciones = p_construcciones, terminado_en = now(),
         dxf_cobrados = case when p_ok then dxf_cobrados else 0 end
   where id = p_id;
  if not p_ok and z.dxf_cobrados > 0 then
    update dxf_autorizaciones set saldo = saldo + z.dxf_cobrados, actualizado_en = now()
     where organizacion_id = z.organizacion_id and persona_id = z.persona_id and saldo is not null;
  end if;
  perform registrar_evento(z.organizacion_id, z.persona_id, 'mapa_catastral_zona', 'dxf', 'fuente', null,
                           case when p_ok then 'ok' else 'falla' end, left(p_codigo, 40), null, p_ok, p_duracion,
                           z.hectareas || ' ha · ' || coalesce(p_predios, 0) || ' predios · ' || coalesce(p_construcciones, 0) || ' construcciones');
end;
$$;
revoke all on function catastro_zona_terminar(uuid, boolean, text, integer, integer, integer) from public, anon, authenticated;
grant execute on function catastro_zona_terminar(uuid, boolean, text, integer, integer, integer) to authenticated;

-- Reporte de consumo de zonas (llave de servicio): por día, sin cuentas de prueba.
create or replace function catastro_zonas_por_dia(p_desde date)
returns table (dia date, zonas bigint, con_falla bigint, personas bigint, predios bigint, construcciones bigint, consultas_fuente bigint,
               dxf_cobrados bigint)
language sql stable security definer set search_path = public as $$
  select (z.creado_en at time zone 'America/Mexico_City')::date, count(*), count(*) filter (where z.estado = 'falla'),
         count(distinct z.persona_id), coalesce(sum(z.predios), 0), coalesce(sum(z.construcciones), 0),
         -- 3 consultas por zona completa; la que falla cuenta hasta donde llegó (código "paso_N").
         sum(case when z.estado = 'ok' then 3 when z.codigo ~ '^paso_[1-3]' then substr(z.codigo, 6, 1)::int else 1 end),
         sum(z.dxf_cobrados)
    from catastro_zonas z
   where (z.creado_en at time zone 'America/Mexico_City')::date >= p_desde
     and not exists (select 1 from membresias x where x.persona_id = z.persona_id and x.organizacion_id = z.organizacion_id and x.es_demo)
   group by 1 order by 1;
$$;
revoke all on function catastro_zonas_por_dia(date) from public, anon, authenticated;

-- ------------------------------------------------------------
-- Alerta: la fuente nos bloquea o limita (403/429)
-- ------------------------------------------------------------
-- La alerta nueva (0090 + catastro_bloqueo), una abierta por organización.
alter table alertas drop constraint alertas_tipo_check;
alter table alertas drop constraint alertas_tipo_completo;
alter table alertas
  add constraint alertas_tipo_check check (tipo in ('cancelado_externo', 'externo_borrado', 'liga_inactiva', 'conector',
                                                    'estimado_sin_final', 'liga_limite', 'pago_por_entregar', 'externo_solicitado',
                                                    'perfil_por_aprobar', 'externo_comision', 'notion_sin_pagina', 'notion_pago',
                                                    'parametros_fiscales', 'cupo_agotado', 'catastro', 'credito_no_aplicado',
                                                    'externo_credito', 'notion_pagina_propuesta', 'catastro_texto_recortado', 'catastro_bloqueo')),
  add constraint alertas_tipo_completo check (
    (tipo in ('cancelado_externo', 'externo_borrado', 'liga_inactiva', 'estimado_sin_final', 'pago_por_entregar',
              'externo_solicitado', 'externo_comision', 'credito_no_aplicado', 'externo_credito')
     and solicitud_id is not null)
    or (tipo = 'conector' and conector_id is not null and codigo is not null)
    or (tipo in ('liga_limite', 'perfil_por_aprobar', 'notion_sin_pagina', 'notion_pago', 'parametros_fiscales', 'cupo_agotado', 'catastro',
                 'notion_pagina_propuesta', 'catastro_texto_recortado', 'catastro_bloqueo')
        and codigo is not null));

drop index if exists alertas_codigo_una_abierta;
create unique index alertas_codigo_una_abierta
  on alertas (organizacion_id, tipo, codigo) where resuelta_en is null
  and tipo in ('notion_sin_pagina', 'notion_pago', 'parametros_fiscales', 'cupo_agotado', 'catastro', 'notion_pagina_propuesta',
               'catastro_texto_recortado', 'catastro_bloqueo');

alter table catastro_fallas drop constraint catastro_fallas_servicio_check;
alter table catastro_fallas add constraint catastro_fallas_servicio_check
  check (servicio in ('mapa', 'expediente', 'folio', 'mosaicos', 'parcela', 'construcciones', 'zona'));

create or replace function catastro_aviso_fuente(p_servicio text, p_estado integer)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_org     uuid := mi_org();
  v_persona uuid := mi_persona_id();
begin
  if v_org is null or not catastro_tiene_herramienta(v_org, v_persona) or p_servicio is null
     or p_servicio not in ('mapa', 'expediente', 'folio', 'mosaicos', 'parcela', 'construcciones', 'zona') then
    return;
  end if;
  if p_estado in (403, 429) then
    insert into catastro_fallas (organizacion_id, persona_id, servicio) values (v_org, v_persona, p_servicio);
    insert into alertas (organizacion_id, tipo, codigo, mensaje)
    values (v_org, 'catastro_bloqueo', 'fuente',
            'La fuente catastral respondió ' || p_estado || (case when p_estado = 429 then ' (demasiadas peticiones)' else ' (acceso negado)' end)
            || ' en ' || p_servicio || ' a las ' || to_char(now() at time zone 'America/Mexico_City', 'HH24:MI') || ' del '
            || to_char(now() at time zone 'America/Mexico_City', 'DD/MM/YYYY')
            || '. Puede que nos estén limitando: revisa el mapa y, si sigue, baja el uso de capas y zonas. Ciérrala cuando vuelva a responder.')
    on conflict do nothing;
  else
    perform catastro_registrar_falla(v_org, v_persona, p_servicio);
  end if;
end;
$$;
revoke all on function catastro_aviso_fuente(text, integer) from public, anon, authenticated;
grant execute on function catastro_aviso_fuente(text, integer) to authenticated;
