-- ============================================================
-- 0066 — GEOMETRÍA ORIGINAL EN UTM
--
-- El polígono se guardaba solo en grados redondeados a 6 decimales
-- (~10 cm). Desde ahora también se guarda tal como lo entrega la fuente,
-- en UTM zona 14N (EPSG:32614), sin redondear: geometria_utm. De ahí
-- salen el DXF (coordenadas, cotas y área) y el croquis del PDF. El mapa
-- y los mosaicos siguen en grados (ahora con 9 decimales).
--
-- · geometria_utm pasa por la misma lista blanca que geometria.
-- · Kardex: la geometría solo cuenta como "cambio" si algún vértice se
--   movió más que el redondeo anterior (6e-7 grados, ~6 cm). Volver a
--   consultar un predio solo para ganar precisión no deja versión;
--   cualquier otro dato que cambie, sí.
-- · Modo 'mantenimiento' (solo el servidor): guarda sin contar en el
--   registro de uso; sirve para re-consultar predios ya guardados.
-- ============================================================

alter table catastro_predios
  add column geometria_utm jsonb check (geometria_utm is null or (geometria_utm->>'type' in ('Polygon', 'MultiPolygon') and catastro_jsonb_limpio(geometria_utm)));

-- ¿Misma geometría salvo el redondeo? Misma forma y cada coordenada a menos de p_tol.
create or replace function catastro_misma_geometria(a jsonb, b jsonb, p_tol numeric default 0.0000006)
returns boolean language plpgsql immutable set search_path = public as $$
declare
  i integer;
begin
  if a is null or b is null then
    return a is null and b is null;
  end if;
  if jsonb_typeof(a) <> jsonb_typeof(b) then
    return false;
  end if;
  if jsonb_typeof(a) = 'number' then
    return abs((a::text)::numeric - (b::text)::numeric) <= p_tol;
  end if;
  if jsonb_typeof(a) = 'array' then
    if jsonb_array_length(a) <> jsonb_array_length(b) then
      return false;
    end if;
    for i in 0 .. jsonb_array_length(a) - 1 loop
      if not catastro_misma_geometria(a -> i, b -> i, p_tol) then
        return false;
      end if;
    end loop;
    return true;
  end if;
  if jsonb_typeof(a) = 'object' then
    return a ->> 'type' is not distinct from b ->> 'type' and catastro_misma_geometria(a -> 'coordinates', b -> 'coordinates', p_tol);
  end if;
  return a = b;
end;
$$;

drop function catastro_guardar(uuid, uuid, text, jsonb, numeric, numeric, numeric[], jsonb, text, jsonb, text);

create or replace function catastro_guardar(
  p_org uuid, p_persona uuid,
  p_clave text, p_geometria jsonb, p_latitud numeric, p_longitud numeric, p_caja numeric[],
  p_datos jsonb, p_expediente text, p_privados jsonb, p_modo text, p_geometria_utm jsonb default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_imp      text := catastro_impedimento_de(p_org, p_persona);
  v_ant      catastro_predios;
  v_cols     text[] := array['colonia', 'codigo_postal', 'ubicacion', 'sup_terreno', 'sup_construccion'];
  -- Columnas que no son datos del expediente (ni entran al kardex como dato).
  v_fuera    text[] := array['clave', 'municipio', 'geometria', 'geometria_utm', 'latitud', 'longitud', 'lat_min', 'lat_max', 'lon_min',
                              'lon_max', 'extra', 'expediente', 'consultado_en', 'consultado_por', 'consultado_org', 'demo'];
  v_datos    jsonb := coalesce(p_datos, '{}');
  v_extra    jsonb;
  v_antes    jsonb;
  v_despues  jsonb;
  v_cambios  text[];
begin
  if v_imp is not null then
    raise exception '%', v_imp;
  end if;
  if p_expediente not in ('completo', 'pendiente') or p_modo not in ('consulta', 'actualizar', 'mantenimiento') then
    raise exception 'Consulta catastral inválida';
  end if;
  if p_clave !~ '^(0[1-9]|1[0-8])[0-9]{13}$' then
    raise exception 'Clave catastral inválida';
  end if;
  if not catastro_extra_valido(v_datos) then
    raise exception 'Datos catastrales fuera de la lista blanca';
  end if;
  if p_caja is not null and array_length(p_caja, 1) <> 4 then
    raise exception 'Caja inválida';
  end if;
  if p_geometria_utm is not null and p_geometria is null then
    raise exception 'La geometría UTM va con su geometría en grados';
  end if;

  select * into v_ant from catastro_predios where clave = p_clave for update;
  if v_ant.demo then
    raise exception 'Ese predio es de ejemplo';
  end if;
  -- Sin expediente, lo anterior se conserva y solo se actualiza la capa del mapa.
  if p_expediente = 'pendiente' and v_ant.clave is not null then
    v_datos := (to_jsonb(v_ant) - v_fuera) || v_ant.extra || v_datos;
    v_datos := (select coalesce(jsonb_object_agg(key, value), '{}') from jsonb_each(v_datos) where value <> 'null'::jsonb);
  end if;
  v_extra := v_datos - v_cols;

  if v_ant.clave is not null then
    v_antes := (to_jsonb(v_ant) - v_fuera) || v_ant.extra;
    v_antes := (select coalesce(jsonb_object_agg(key, value), '{}') from jsonb_each(v_antes) where value <> 'null'::jsonb);
    v_despues := (select coalesce(jsonb_object_agg(key, value), '{}') from jsonb_each(v_datos) where value <> 'null'::jsonb);
    select coalesce(array_agg(k order by k), '{}') into v_cambios
      from (select key k from jsonb_each(v_antes) union select key from jsonb_each(v_despues)) x
     where v_antes -> k is distinct from v_despues -> k;
    -- La geometría, aparte: más precisión no es un cambio.
    if p_geometria is not null and not catastro_misma_geometria(v_ant.geometria, p_geometria) then
      v_cambios := array(select unnest(v_cambios || array['geometria']) order by 1);
    end if;
    if cardinality(v_cambios) > 0 then
      insert into catastro_versiones (clave, consultado_en, cambios, antes)
      values (p_clave, v_ant.consultado_en, v_cambios,
              case when v_ant.geometria is null then v_antes else jsonb_build_object('geometria', v_ant.geometria) || v_antes end);
    end if;
  end if;

  insert into catastro_predios as cp (clave, municipio, geometria, geometria_utm, latitud, longitud, lat_min, lat_max, lon_min, lon_max,
                                      colonia, codigo_postal, ubicacion, sup_terreno, sup_construccion, extra, expediente,
                                      consultado_en, consultado_por, consultado_org)
  values (p_clave, left(p_clave, 2), p_geometria, p_geometria_utm, p_latitud, p_longitud, p_caja[1], p_caja[2], p_caja[3], p_caja[4],
          v_datos->>'colonia', v_datos->>'codigo_postal', v_datos->>'ubicacion',
          (v_datos->>'sup_terreno')::numeric, (v_datos->>'sup_construccion')::numeric, v_extra, p_expediente,
          now(), p_persona, p_org)
  on conflict (clave) do update set
    geometria = coalesce(excluded.geometria, cp.geometria),
    -- La UTM acompaña siempre a su geometría en grados: si llega polígono nuevo, llega (o se borra) la suya.
    geometria_utm = case when excluded.geometria is not null then excluded.geometria_utm else cp.geometria_utm end,
    latitud = coalesce(excluded.latitud, cp.latitud), longitud = coalesce(excluded.longitud, cp.longitud),
    lat_min = coalesce(excluded.lat_min, cp.lat_min), lat_max = coalesce(excluded.lat_max, cp.lat_max),
    lon_min = coalesce(excluded.lon_min, cp.lon_min), lon_max = coalesce(excluded.lon_max, cp.lon_max),
    colonia = excluded.colonia, codigo_postal = excluded.codigo_postal, ubicacion = excluded.ubicacion,
    sup_terreno = excluded.sup_terreno, sup_construccion = excluded.sup_construccion, extra = excluded.extra,
    -- Un expediente que falla no borra uno completo ni le cambia la fecha.
    expediente = case when p_expediente = 'completo' then 'completo' else cp.expediente end,
    consultado_en = case when p_expediente = 'completo' then now() else cp.consultado_en end,
    consultado_por = excluded.consultado_por, consultado_org = excluded.consultado_org;

  if p_expediente = 'completo' then
    if p_privados is not null then
      insert into catastro_propietarios as pr (organizacion_id, clave, propietarios, valor_operacion, escritura, notario, numero_contrato, actualizado_en)
      values (p_org, p_clave, coalesce(p_privados->'propietarios', '[]'), (p_privados->>'valor_operacion')::numeric,
              p_privados->>'escritura', p_privados->>'notario', p_privados->>'numero_contrato', now())
      on conflict (organizacion_id, clave) do update set
        propietarios = excluded.propietarios, valor_operacion = excluded.valor_operacion, escritura = excluded.escritura,
        notario = excluded.notario, numero_contrato = excluded.numero_contrato, actualizado_en = now();
    end if;
    -- El cupo ya se revisó arriba (catastro_impedimento_de): aquí solo se cuenta. Mantenimiento no cuenta.
    if p_modo <> 'mantenimiento' then
      insert into usos_herramienta (organizacion_id, persona_id, herramienta, modo) values (p_org, p_persona, 'mapa_catastral', p_modo);
    end if;
  end if;
end;
$$;

revoke all on function catastro_guardar(uuid, uuid, text, jsonb, numeric, numeric, numeric[], jsonb, text, jsonb, text, jsonb),
  catastro_misma_geometria(jsonb, jsonb, numeric) from public, anon, authenticated;
grant execute on function catastro_guardar(uuid, uuid, text, jsonb, numeric, numeric, numeric[], jsonb, text, jsonb, text, jsonb) to service_role;

-- La ficha y el DXF llevan también la geometría UTM (no es dato personal; es el mismo polígono).
create or replace function catastro_ficha_para(p_clave text, p_pdf boolean)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  p          catastro_predios;
  v_todo     jsonb;
  v_campos   jsonb;
  v_ficha    jsonb;
  v_privados jsonb;
begin
  if not exists (select 1 from mis_herramientas() where clave = 'mapa_catastral') then
    raise exception 'El mapa catastral no está disponible para ti';
  end if;
  p := catastro_predio_visible(p_clave);
  if p.clave is null then
    return null;
  end if;
  v_todo := jsonb_build_object('colonia', p.colonia, 'codigo_postal', p.codigo_postal, 'ubicacion', p.ubicacion,
                               'sup_terreno', p.sup_terreno, 'sup_construccion', p.sup_construccion) || p.extra;
  -- Por el rol, nunca por la configuración.
  if not catastro_veo_privados() then
    v_todo := v_todo - array['cacoct', 'vacopt', 'vatrct', 'vatrpt'];
  end if;
  select coalesce(jsonb_object_agg(t.key, t.value), '{}') into v_campos
    from jsonb_each(v_todo) t
   where t.value <> 'null'::jsonb
     and t.key in (select cv.campo from catastro_campos_visibles cv
                    where cv.organizacion_id = mi_org() and cv.rol = mi_rol()
                      and case when p_pdf then cv.en_pdf else cv.en_pantalla end);
  v_ficha := jsonb_build_object('clave', p.clave, 'municipio', p.municipio, 'geometria', p.geometria, 'geometria_utm', p.geometria_utm,
                                'latitud', p.latitud, 'longitud', p.longitud, 'consultado_en', p.consultado_en,
                                'expediente', p.expediente, 'campos', v_campos);
  if catastro_veo_privados() then
    select jsonb_build_object('propietarios', cp.propietarios, 'valor_operacion', cp.valor_operacion, 'escritura', cp.escritura,
                              'notario', cp.notario, 'numero_contrato', cp.numero_contrato, 'actualizado_en', cp.actualizado_en)
      into v_privados
      from catastro_propietarios cp where cp.organizacion_id = mi_org() and cp.clave = p.clave;
    v_ficha := v_ficha || jsonb_build_object('privados', v_privados,
      'historial', (select coalesce(jsonb_agg(jsonb_build_object('consultado_en', v.consultado_en, 'reemplazada_en', v.reemplazada_en,
                                                                  'cambios', v.cambios) order by v.reemplazada_en desc), '[]')
                      from catastro_versiones v where v.clave = p.clave));
  end if;
  return v_ficha;
end;
$$;
revoke all on function catastro_ficha_para(text, boolean) from public, anon, authenticated;

-- El DXF, con la geometría UTM de la fuente cuando la hay (0065 sin otro cambio).
create or replace function catastro_dxf(p_clave text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_org     uuid := mi_org();
  v_persona uuid := mi_persona_id();
  v_admin   boolean;
  a         dxf_autorizaciones;
  p         catastro_predios;
  v_saldo   integer;
begin
  if v_org is null or v_persona is null or not catastro_tiene_herramienta(v_org, v_persona) then
    raise exception 'El DXF no está disponible para ti' using errcode = 'TA403';
  end if;
  v_admin := catastro_rol_de(v_org, v_persona) = 'admin_org';
  if not v_admin then
    -- El candado: quien llegue segundo espera aquí a que el primero termine.
    select * into a from dxf_autorizaciones
     where organizacion_id = v_org and persona_id = v_persona and activa
       for update;
    if not found then
      raise exception 'El DXF no está disponible para ti' using errcode = 'TA403';
    end if;
    v_saldo := a.saldo;
  end if;

  p := catastro_predio_visible(p_clave);
  if p.clave is null or p.geometria is null then
    raise exception 'Ese predio no está guardado en Tasa; consúltalo primero en el mapa' using errcode = 'TA404';
  end if;

  -- El mismo predio otra vez: no resta.
  update dxf_descargas set veces = veces + 1, ultima_en = now()
   where organizacion_id = v_org and persona_id = v_persona and clave = p.clave;
  if not found then
    if (select count(*) from dxf_descargas d where d.organizacion_id = v_org and d.persona_id = v_persona
          and (d.creado_en at time zone 'America/Mexico_City')::date = hoy_mx()) >= 200 then
      raise exception 'Llegaste al tope de seguridad de 200 DXF al día. Mañana se reinicia.' using errcode = 'TA429';
    end if;
    if not v_admin and a.saldo is not null then
      update dxf_autorizaciones set saldo = saldo - 1, actualizado_en = now()
       where organizacion_id = v_org and persona_id = v_persona and saldo > 0
      returning saldo into v_saldo;
      if not found then
        raise exception 'Ya no te quedan DXF. Pide más.' using errcode = 'TA429';
      end if;
    end if;
    insert into dxf_descargas (organizacion_id, persona_id, clave, saldo_despues)
    values (v_org, v_persona, p.clave, v_saldo)
    on conflict (organizacion_id, persona_id, clave) do update set veces = dxf_descargas.veces + 1, ultima_en = now();
  end if;

  -- Solo lo que lleva el archivo: nada de propietario, operación ni campos de la ficha.
  return jsonb_build_object('clave', p.clave, 'geometria', p.geometria, 'geometria_utm', p.geometria_utm, 'consultado_en', p.consultado_en,
                            'saldo', v_saldo);
end;
$$;
