-- ============================================================
-- 0088 — UNA SOLA CAJA DE BÚSQUEDA EN EL MAPA CATASTRAL
--
-- · eventos_uso registra cada búsqueda (evento 'busqueda') con su tipo
--   en codigo: clave, coordenadas, liga_google, domicilio o folio. El
--   texto escrito (un domicilio) nunca se guarda.
-- · Folio real: primero en los predios ya guardados en Tasa; si no, la
--   fuente (origen 'fuente'). Buscar por folio NO gasta el cupo del mes
--   (solo la consulta del predio que sigue), pero SÍ cuenta para el tope
--   de seguridad de 200 al día.
-- ============================================================

alter table eventos_uso drop constraint eventos_uso_evento_check;
alter table eventos_uso add constraint eventos_uso_evento_check
  check (evento in ('consulta', 'pdf', 'dxf', 'calculo', 'acceso', 'denegado', 'cierre_limite', 'busqueda'));

-- Lo registra la sesión de quien busca. referencia: la subdirección, solo en folio.
create or replace function catastro_registrar_busqueda(p_tipo text, p_origen text, p_resultado text, p_referencia text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_tipo not in ('clave', 'coordenadas', 'liga_google', 'domicilio', 'folio')
     or (p_origen is not null and p_origen not in ('fuente', 'guardado'))
     or p_resultado not in ('ok', 'sin_predio', 'falla') then
    raise exception 'Búsqueda inválida';
  end if;
  if not catastro_tiene_herramienta(mi_org(), mi_persona_id()) then
    return;
  end if;
  perform registrar_evento(mi_org(), mi_persona_id(), 'mapa_catastral', 'busqueda', p_origen, null, p_resultado, p_tipo, null, false, null,
                           case when p_tipo = 'folio' then left(p_referencia, 4) end);
end;
$$;

-- Búsquedas por folio que fueron a la fuente hoy (cuentan para el tope de 200 al día).
create or replace function catastro_folios_hoy(p_org uuid, p_persona uuid)
returns integer language sql stable security definer set search_path = public as $$
  select count(*)::integer from eventos_uso e
   where e.organizacion_id = p_org and e.persona_id = p_persona and e.herramienta = 'mapa_catastral' and e.evento = 'busqueda'
     and e.codigo = 'folio' and e.origen = 'fuente' and (e.creado_en at time zone 'America/Mexico_City')::date = hoy_mx();
$$;

-- 0059 + las búsquedas de folio a la fuente cuentan para el tope de seguridad del día.
create or replace function catastro_impedimento_de(p_org uuid, p_persona uuid)
returns text language plpgsql stable security definer set search_path = public as $$
declare
  c record;
begin
  if p_org is null or p_persona is null or not catastro_tiene_herramienta(p_org, p_persona) then
    return 'El mapa catastral no está disponible para ti.';
  end if;
  if coalesce((select o.demo from organizaciones o where o.id = p_org), false) then
    return 'En DEMO solo se consultan los predios de ejemplo.';
  end if;
  if (select count(*) from usos_herramienta u where u.organizacion_id = p_org and u.persona_id = p_persona
        and u.herramienta = 'mapa_catastral' and (u.creado_en at time zone 'America/Mexico_City')::date = hoy_mx())
     + catastro_folios_hoy(p_org, p_persona) >= 200 then
    return 'Llegaste al tope de seguridad de 200 consultas al día. Mañana se reinicia.';
  end if;
  select * into c from cupo_de(p_org, p_persona, 'mapa_catastral');
  if c.disponibles is not null and c.disponibles <= 0 then
    return 'Llegaste a tu límite de consultas del mes. Sube de nivel o pide más.';
  end if;
  return null;
end;
$$;

-- ¿Puede buscar un folio en la fuente? Solo el tope del día (el cupo del mes no). Nulo = sí; si no, el porqué.
create or replace function catastro_pedir_busqueda_folio()
returns text language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := mi_org();
  v_per uuid := mi_persona_id();
  v     text;
begin
  if not catastro_tiene_herramienta(v_org, v_per) then
    v := 'El mapa catastral no está disponible para ti.';
  elsif coalesce((select o.demo from organizaciones o where o.id = v_org), false) then
    v := 'En DEMO solo se buscan los predios de ejemplo.';
  elsif (select count(*) from usos_herramienta u where u.organizacion_id = v_org and u.persona_id = v_per
           and u.herramienta = 'mapa_catastral' and (u.creado_en at time zone 'America/Mexico_City')::date = hoy_mx())
        + catastro_folios_hoy(v_org, v_per) >= 200 then
    v := 'Llegaste al tope de seguridad de 200 consultas al día. Mañana se reinicia.';
  end if;
  if v is not null then
    perform registrar_denegacion('mapa_catastral',
      case when v like '%no está disponible%' then 'sin_herramienta' when v like '%DEMO%' then 'demo' else 'tope_dia' end,
      (case when v like '%tope%' then 429 else 403 end)::smallint);
  end if;
  return v;
end;
$$;

-- Folio real en los predios ya guardados (los que esta organización puede ver: reales o de DEMO).
create or replace function catastro_folio_guardado(p_folio text)
returns text language sql stable security definer set search_path = public as $$
  select p.clave from catastro_predios p
   where catastro_tiene_herramienta(mi_org(), mi_persona_id())
     and p.demo = coalesce((select o.demo from organizaciones o where o.id = mi_org()), false)
     and nullif(trim(p_folio), '') is not null
     and ltrim(trim(p_folio), '0') = any (
           array(select ltrim(trim(f), '0') from unnest(string_to_array(replace(coalesce(p.extra ->> 'folio_real', ''), ';', ','), ',')) f))
   order by p.consultado_en desc
   limit 1;
$$;

revoke all on function catastro_registrar_busqueda(text, text, text, text), catastro_folios_hoy(uuid, uuid),
  catastro_pedir_busqueda_folio(), catastro_folio_guardado(text) from public, anon;
grant execute on function catastro_registrar_busqueda(text, text, text, text), catastro_pedir_busqueda_folio(),
  catastro_folio_guardado(text) to authenticated;
