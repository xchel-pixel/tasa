-- ============================================================
-- 0097 — EL DXF DICE SI LLEVA CONSTRUCCIONES
--
-- El DXF del predio (0065/0070) sigue igual: autorización, saldo (una
-- descarga = 1; el mismo predio otra vez no resta) y tope de 200 al día.
-- Ahora además devuelve `construcciones`: verdadero solo para admin_org y
-- equipo (por rol, en la base). Ellos reciben el DXF con las construcciones
-- (capas CONST_N1…N5, leídas de la fuente al momento, sin guardarse).
-- Comisionistas y finanzas autorizados siguen con el DXF de solo polígono.
-- ============================================================

-- 0070 + construcciones.
create or replace function catastro_dxf(p_clave text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_org     uuid := mi_org();
  v_persona uuid := mi_persona_id();
  v_admin   boolean;
  a         dxf_autorizaciones;
  p         catastro_predios;
  v_saldo   integer;
  v_nuevo   boolean := false;
begin
  if v_org is null or v_persona is null or not catastro_tiene_herramienta(v_org, v_persona) then
    perform registrar_denegacion('mapa_catastral_dxf', 'sin_herramienta', 403::smallint, p_clave);
    return jsonb_build_object('error', 'El DXF no está disponible para ti', 'estado', 403);
  end if;
  v_admin := catastro_rol_de(v_org, v_persona) = 'admin_org';
  if not v_admin then
    -- El candado: quien llegue segundo espera aquí a que el primero termine.
    select * into a from dxf_autorizaciones
     where organizacion_id = v_org and persona_id = v_persona and activa
       for update;
    if not found then
      perform registrar_denegacion('mapa_catastral_dxf', 'no_autorizado', 403::smallint, p_clave);
      return jsonb_build_object('error', 'El DXF no está disponible para ti', 'estado', 403);
    end if;
    v_saldo := a.saldo;
  end if;

  p := catastro_predio_visible(p_clave);
  if p.clave is null or p.geometria is null then
    return jsonb_build_object('error', 'Ese predio no está guardado en Tasa; consúltalo primero en el mapa', 'estado', 404);
  end if;

  -- El mismo predio otra vez: no resta.
  update dxf_descargas set veces = veces + 1, ultima_en = now()
   where organizacion_id = v_org and persona_id = v_persona and clave = p.clave;
  if not found then
    if (select count(*) from dxf_descargas d where d.organizacion_id = v_org and d.persona_id = v_persona
          and (d.creado_en at time zone 'America/Mexico_City')::date = hoy_mx()) >= 200 then
      perform registrar_denegacion('mapa_catastral_dxf', 'tope_dia', 429::smallint, p.clave);
      return jsonb_build_object('error', 'Llegaste al tope de seguridad de 200 DXF al día. Mañana se reinicia.', 'estado', 429);
    end if;
    if not v_admin and a.saldo is not null then
      update dxf_autorizaciones set saldo = saldo - 1, actualizado_en = now()
       where organizacion_id = v_org and persona_id = v_persona and saldo > 0
      returning saldo into v_saldo;
      if not found then
        perform registrar_denegacion('mapa_catastral_dxf', 'sin_saldo', 429::smallint, p.clave);
        return jsonb_build_object('error', 'Ya no te quedan DXF. Pide más.', 'estado', 429);
      end if;
      v_nuevo := true;
    end if;
    insert into dxf_descargas (organizacion_id, persona_id, clave, saldo_despues)
    values (v_org, v_persona, p.clave, v_saldo)
    on conflict (organizacion_id, persona_id, clave) do update set veces = dxf_descargas.veces + 1, ultima_en = now();
  end if;
  perform registrar_evento(v_org, v_persona, 'mapa_catastral_dxf', 'dxf', 'guardado', p.clave, 'ok', null, null, v_nuevo);

  -- Solo lo que lleva el archivo: nada de propietario, operación ni campos de la ficha.
  return jsonb_build_object('clave', p.clave, 'geometria', p.geometria, 'geometria_utm', p.geometria_utm, 'consultado_en', p.consultado_en,
                            'saldo', v_saldo,
                            -- 0097: admin_org y equipo reciben además las construcciones (de la fuente, al momento).
                            'construcciones', catastro_rol_de(v_org, v_persona) in ('admin_org', 'equipo'));
end;
$$;
