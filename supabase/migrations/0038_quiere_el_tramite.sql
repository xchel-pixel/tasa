-- ============================================================
-- 0038 — "QUIERE EL TRÁMITE" ES UNA COTIZACIÓN
--
-- Por la liga de cliente, "Quiero el trámite" ya no entra como trámite
-- directo: entra como cotización con la marca `quiere_tramite` (visible
-- y primero en "Solicitudes por cotizar"). Solo se vuelve trabajo —y
-- solo entonces va a Notion— cuando el cliente acepta la cotización.
-- Nada de la liga crea páginas en Notion por sí solo: el conector solo
-- reclama trabajos (`estado = 'tramite'`).
--
-- Antes de esta migración no había ninguna solicitud de liga en
-- producción, así que no hay nada que convertir.
-- ============================================================

alter table solicitudes add column quiere_tramite boolean not null default false;
alter table solicitudes add constraint solicitudes_quiere_tramite_de_liga
  check (not quiere_tramite or (origen = 'liga_cliente' and tipo = 'cotizacion'));

create or replace function pedir_por_liga(
  p_org           text,
  p_codigo        text,
  p_nombre        text,
  p_telefono      text,
  p_correo        text,
  p_servicio      uuid,
  p_tramite       boolean,
  p_direccion     text,
  p_inmueble_tipo text,
  p_clave         text,
  p_comentarios   text,
  p_aviso_version integer,
  p_ip_resumen    text,
  p_adjuntos      integer
)
returns table (solicitud uuid, token uuid, organizacion uuid)
language plpgsql security definer set search_path = public as $$
declare
  o         organizaciones%rowtype;
  d         record;
  v_tel     text := regexp_replace(coalesce(p_telefono, ''), '\D', '', 'g');
  v_correo  text := nullif(lower(trim(p_correo)), '');
  v_id      uuid;
  v_token   uuid;
  v_tipo    text;
begin
  select * into o from organizaciones where slug = lower(trim(p_org)) and activa;
  if not found then
    raise exception 'Esta liga no es válida';
  end if;
  select * into d from dueno_de_liga(o.id, p_codigo);
  if d.persona_id is null then
    raise exception 'Esta liga no es válida';
  end if;

  if char_length(trim(coalesce(p_nombre, ''))) not between 2 and 120 then
    raise exception 'Escribe tu nombre';
  end if;
  if char_length(v_tel) = 12 and v_tel like '52%' then
    v_tel := substr(v_tel, 3);
  end if;
  if char_length(v_tel) <> 10 then
    raise exception 'El teléfono va a 10 dígitos';
  end if;
  if v_correo is not null and v_correo !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Revisa el correo (o déjalo vacío)';
  end if;
  if not exists (select 1 from servicios where id = p_servicio and organizacion_id = o.id and activo) then
    raise exception 'Elige un servicio';
  end if;
  if char_length(trim(coalesce(p_direccion, ''))) not between 3 and 300 then
    raise exception 'Escribe la ubicación o dirección del inmueble';
  end if;
  if p_inmueble_tipo is null or p_inmueble_tipo not in ('casa', 'departamento', 'terreno', 'local_oficina', 'bodega_nave', 'otro') then
    raise exception 'Elige el tipo de inmueble';
  end if;
  if char_length(coalesce(p_clave, '')) > 60 or char_length(coalesce(p_comentarios, '')) > 1000 then
    raise exception 'La clave catastral va hasta 60 caracteres y los comentarios hasta 1,000';
  end if;
  if p_aviso_version is distinct from (select aviso_version from ajustes where organizacion_id = o.id)
     or coalesce(p_aviso_version, 0) = 0 then
    raise exception 'El aviso de privacidad cambió: recarga la página y vuelve a aceptarlo';
  end if;
  if coalesce(p_adjuntos, 0) not between 0 and 3 then
    raise exception 'Hasta 3 archivos';
  end if;

  -- Antispam: por conexión, por teléfono y un tope por organización.
  if (select count(*) from solicitudes
       where origen = 'liga_cliente' and ip_resumen = p_ip_resumen and creado_en > now() - interval '24 hours') >= 5 then
    raise exception 'Llegaron demasiadas solicitudes desde esta conexión. Inténtalo mañana o llama a quien te pasó la liga.';
  end if;
  if (select count(*) from solicitudes
       where organizacion_id = o.id and origen = 'liga_cliente' and cliente_telefono = v_tel
         and creado_en > now() - interval '24 hours') >= 3 then
    raise exception 'Ya recibimos tus solicitudes de hoy con este teléfono. Te van a contactar.';
  end if;
  if (select count(*) from solicitudes
       where organizacion_id = o.id and origen = 'liga_cliente' and creado_en > now() - interval '24 hours') >= 200 then
    raise exception 'Por hoy no podemos recibir más solicitudes en línea. Llama a quien te pasó la liga.';
  end if;

  v_tipo := case p_inmueble_tipo
              when 'casa' then 'Casa' when 'departamento' then 'Departamento' when 'terreno' then 'Terreno'
              when 'local_oficina' then 'Local u oficina' when 'bodega_nave' then 'Bodega o nave' else 'Otro' end;
  if coalesce(p_adjuntos, 0) > 0 then
    v_token := gen_random_uuid();
  end if;

  perform set_config('tasa.motivo', 'Liga de cliente', true);
  insert into solicitudes (organizacion_id, comisionista_id, tipo, origen, servicio_id, inmueble_direccion,
                           inmueble_clave_catastral, inmueble_descripcion, inmueble_tipo, cliente_nombre,
                           cliente_telefono, cliente_correo, liga_de, liga_sin_dueno, ip_resumen, aviso_version,
                           adjuntos_token, adjuntos_hasta, quiere_tramite)
  values (o.id, case when d.es_comisionista and d.activo then d.persona_id end,
          'cotizacion', 'liga_cliente', p_servicio,
          trim(p_direccion), nullif(trim(p_clave), ''),
          'Tipo: ' || v_tipo || coalesce(E'\n' || nullif(trim(p_comentarios), ''), ''), p_inmueble_tipo,
          trim(p_nombre), v_tel, v_correo, d.persona_id, not d.activo, p_ip_resumen, p_aviso_version,
          v_token, case when v_token is not null then now() + interval '30 minutes' end, coalesce(p_tramite, false))
  returning id into v_id;

  if not d.activo then
    insert into alertas (organizacion_id, tipo, solicitud_id, mensaje)
    values (o.id, 'liga_inactiva', v_id,
            'Llegó una solicitud por la liga de alguien inactivo; quedó a nombre de la organización: '
            || trim(p_nombre) || ' · ' || (select nombre from servicios where id = p_servicio));
  end if;
  perform set_config('tasa.motivo', '', true);

  return query select v_id, v_token, o.id;
end;
$$;

create or replace function datos_aviso_liga(p_solicitud uuid)
returns table (dueno_correo text, dueno_nombre text, cliente_nombre text, cliente_correo text, servicio text,
               tramite boolean, organizacion text, sin_dueno boolean, contacto text)
language sql stable security definer set search_path = public as $$
  select case when not s.liga_sin_dueno then p.correo end,
         case when s.liga_sin_dueno or p.id is null then o.nombre else nombre_visible(p) end, s.cliente_nombre, s.cliente_correo, sv.nombre,
         s.quiere_tramite, o.nombre, s.liga_sin_dueno, a.contacto_soporte
    from solicitudes s
    join organizaciones o on o.id = s.organizacion_id
    join servicios sv on sv.id = s.servicio_id
    left join personas p on p.id = s.liga_de
    left join ajustes a on a.organizacion_id = s.organizacion_id
   where s.id = p_solicitud and s.origen = 'liga_cliente' and s.creado_en > now() - interval '1 hour';
$$;

create or replace function mis_solicitudes_de_liga()
returns table (id uuid, cliente_nombre text, cliente_telefono text, cliente_correo text, servicio text,
               tramite boolean, estado text, creado_en timestamptz)
language sql stable security definer set search_path = public as $$
  select s.id, s.cliente_nombre, s.cliente_telefono, s.cliente_correo, sv.nombre, s.quiere_tramite,
         s.estado, s.creado_en
    from solicitudes s join servicios sv on sv.id = s.servicio_id
   where s.organizacion_id = mi_org() and s.liga_de = mi_persona_id() and s.origen = 'liga_cliente'
     and not s.liga_sin_dueno and s.creado_en > now() - interval '30 days'
   order by s.creado_en desc
   limit 10;
$$;
