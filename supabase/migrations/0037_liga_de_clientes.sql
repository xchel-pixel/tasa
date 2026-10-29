-- ============================================================
-- 0037 — LIGA PÚBLICA PARA CLIENTES
--
-- /s/<organización>/<código>: un cliente, sin cuenta, pide una
-- cotización o un trámite a nombre de quien le pasó la liga (el mismo
-- código de referido). Entra a "Solicitudes por cotizar" con origen
-- 'liga_cliente':
--
-- - Liga de un comisionista activo: la solicitud es suya
--   (`comisionista_id`) y genera su comisión normal.
-- - Liga de alguien del equipo o de admin_org: solo seguimiento
--   (`liga_de`), sin comisionista y sin comisión.
-- - Liga de alguien inactivo: llega igual, a la organización (sin
--   comisionista, `liga_sin_dueno`), con alerta para admin_org.
--
-- Por eso `comisionista_id` deja de ser obligatorio, pero solo para
-- solicitudes de liga. Sin comisionista no se genera comisión y el
-- "Solicitado por" de Notion dice de quién era la liga.
--
-- Lo público pasa por funciones `security definer`
-- (`datos_liga_cliente`, `pedir_por_liga`) y los adjuntos van a un
-- bucket privado que solo admite archivos de una solicitud recién
-- creada. Nunca se expone el correo ni el teléfono del dueño.
-- ============================================================

alter table solicitudes alter column comisionista_id drop not null;
alter table solicitudes drop constraint solicitudes_origen_check;
alter table solicitudes
  add constraint solicitudes_origen_check check (origen in ('portal', 'tarjeta', 'referido', 'admin', 'liga_cliente')),
  add column liga_de uuid references personas(id) on delete set null,
  add column liga_sin_dueno boolean not null default false,
  add column inmueble_tipo text check (inmueble_tipo in ('casa', 'departamento', 'terreno', 'local_oficina', 'bodega_nave', 'otro')),
  add column ip_resumen text,
  add column aviso_version integer,
  add column adjuntos_token uuid,
  add column adjuntos_hasta timestamptz,
  add constraint solicitudes_con_dueno check (comisionista_id is not null or origen = 'liga_cliente');

create index solicitudes_liga on solicitudes (organizacion_id, liga_de, creado_en) where origen = 'liga_cliente';

alter table alertas drop constraint alertas_tipo_check;
alter table alertas drop constraint alertas_tipo_completo;
alter table alertas
  add constraint alertas_tipo_check check (tipo in ('cancelado_externo', 'externo_borrado', 'liga_inactiva', 'conector')),
  add constraint alertas_tipo_completo check (
    (tipo in ('cancelado_externo', 'externo_borrado', 'liga_inactiva') and solicitud_id is not null)
    or (tipo = 'conector' and conector_id is not null and codigo is not null));

-- ------------------------------------------------------------
-- 1. DE QUIÉN ES UNA LIGA
-- ------------------------------------------------------------

-- Comisionista o miembro del equipo con ese código, activo o no.
create or replace function dueno_de_liga(p_org uuid, p_codigo text)
returns table (persona_id uuid, es_comisionista boolean, activo boolean)
language sql stable security definer set search_path = public as $$
  select * from (
    select c.persona_id, true, m.activa and p.activo
      from comisionistas c
      join membresias m on m.persona_id = c.persona_id and m.organizacion_id = c.organizacion_id and m.rol = 'comisionista'
      join personas p on p.id = c.persona_id
     where c.organizacion_id = p_org and c.codigo_referido = upper(trim(p_codigo))
    union all
    select m.persona_id, false, m.activa and p.activo
      from membresias m join personas p on p.id = m.persona_id
     where m.organizacion_id = p_org and m.rol in ('admin_org', 'equipo', 'finanzas', 'admin_marca')
       and m.codigo_referido = upper(trim(p_codigo))
  ) d limit 1;
$$;

-- Lo que necesita la página pública: nada del dueño salvo su nombre para mostrar.
create or replace function datos_liga_cliente(p_org text, p_codigo text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  o organizaciones%rowtype;
  d record;
begin
  select * into o from organizaciones where slug = lower(trim(p_org)) and activa;
  if not found or coalesce(trim(p_codigo), '') = '' then
    return null;
  end if;
  select * into d from dueno_de_liga(o.id, p_codigo);
  if d.persona_id is null then
    return null;
  end if;
  return jsonb_build_object(
    'organizacion', o.nombre,
    'con', case when d.activo then (select nombre_visible(p) from personas p where p.id = d.persona_id) else o.nombre end,
    'aviso_version', (select aviso_version from ajustes where organizacion_id = o.id),
    'servicios', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'nombre', s.nombre) order by s.nombre)
                             from servicios s where s.organizacion_id = o.id and s.activo), '[]'::jsonb));
end;
$$;

-- ------------------------------------------------------------
-- 2. PEDIR POR LA LIGA
-- ------------------------------------------------------------

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
                           adjuntos_token, adjuntos_hasta)
  values (o.id, case when d.es_comisionista and d.activo then d.persona_id end,
          case when p_tramite then 'tramite_directo' else 'cotizacion' end, 'liga_cliente', p_servicio,
          trim(p_direccion), nullif(trim(p_clave), ''),
          'Tipo: ' || v_tipo || coalesce(E'\n' || nullif(trim(p_comentarios), ''), ''), p_inmueble_tipo,
          trim(p_nombre), v_tel, v_correo, d.persona_id, not d.activo, p_ip_resumen, p_aviso_version,
          v_token, case when v_token is not null then now() + interval '30 minutes' end)
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

-- Para los correos (solo el servidor, con la llave de servicio): a quién avisar y qué decirle.
-- `dueno_nombre` es el nombre para mostrar (el que puede leer el cliente).
create or replace function datos_aviso_liga(p_solicitud uuid)
returns table (dueno_correo text, dueno_nombre text, cliente_nombre text, cliente_correo text, servicio text,
               tramite boolean, organizacion text, sin_dueno boolean, contacto text)
language sql stable security definer set search_path = public as $$
  select case when not s.liga_sin_dueno then p.correo end,
         case when s.liga_sin_dueno or p.id is null then o.nombre else nombre_visible(p) end, s.cliente_nombre, s.cliente_correo, sv.nombre,
         s.tipo = 'tramite_directo', o.nombre, s.liga_sin_dueno, a.contacto_soporte
    from solicitudes s
    join organizaciones o on o.id = s.organizacion_id
    join servicios sv on sv.id = s.servicio_id
    left join personas p on p.id = s.liga_de
    left join ajustes a on a.organizacion_id = s.organizacion_id
   where s.id = p_solicitud and s.origen = 'liga_cliente' and s.creado_en > now() - interval '1 hour';
$$;

-- "Tu cliente <nombre> pidió <servicio>": lo que llegó por mi liga (comisionista, equipo, admin_org).
create or replace function mis_solicitudes_de_liga()
returns table (id uuid, cliente_nombre text, cliente_telefono text, cliente_correo text, servicio text,
               tramite boolean, estado text, creado_en timestamptz)
language sql stable security definer set search_path = public as $$
  select s.id, s.cliente_nombre, s.cliente_telefono, s.cliente_correo, sv.nombre, s.tipo = 'tramite_directo',
         s.estado, s.creado_en
    from solicitudes s join servicios sv on sv.id = s.servicio_id
   where s.organizacion_id = mi_org() and s.liga_de = mi_persona_id() and s.origen = 'liga_cliente'
     and not s.liga_sin_dueno and s.creado_en > now() - interval '30 days'
   order by s.creado_en desc
   limit 10;
$$;

-- ------------------------------------------------------------
-- 3. ADJUNTOS DEL CLIENTE (bucket privado `clientes`)
--
-- Ruta: <organización>/<solicitud>/<token>/<archivo>. Solo se escribe en
-- los 30 minutos siguientes a crear la solicitud, con su token, y hasta
-- 3 archivos de 10 MB (PDF o imagen).
-- ------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('clientes', 'clientes', false, 10485760,
        array['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic'])
on conflict (id) do nothing;

create or replace function cliente_admite_adjunto(p_ruta text)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare
  v_partes text[] := string_to_array(p_ruta, '/');
begin
  if array_length(v_partes, 1) <> 4 or v_partes[4] = '' then
    return false;
  end if;
  return exists (
    select 1 from solicitudes s
     where s.organizacion_id::text = v_partes[1] and s.id::text = v_partes[2]
       and s.adjuntos_token::text = v_partes[3] and s.adjuntos_hasta > now())
    and (select count(*) from storage.objects
          where bucket_id = 'clientes' and name like v_partes[1] || '/' || v_partes[2] || '/%') < 3;
end;
$$;

-- Lo ve el staff de la organización y el comisionista dueño de la solicitud.
create or replace function puede_ver_adjunto_cliente(p_ruta text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from solicitudes s
     where s.organizacion_id = mi_org()
       and s.id::text = split_part(p_ruta, '/', 2) and s.organizacion_id::text = split_part(p_ruta, '/', 1)
       and (mi_rol() in ('admin_org', 'finanzas') or s.comisionista_id = mi_persona_id()
            or (mi_rol() = 'admin_marca' and s.marca_id = any (mis_marcas()::uuid[]))));
$$;

create policy clientes_subir on storage.objects for insert to anon, authenticated
  with check (bucket_id = 'clientes' and public.cliente_admite_adjunto(name));
create policy clientes_leer on storage.objects for select to authenticated
  using (bucket_id = 'clientes' and public.puede_ver_adjunto_cliente(name));

-- ------------------------------------------------------------
-- 4. SIN COMISIONISTA NO HAY COMISIÓN
-- ------------------------------------------------------------

create or replace function liquidar_si_completo(p_solicitud uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  s          solicitudes%rowtype;
  p          record;
  v_suma     numeric := 0;
  v_fecha    date;
  v_mes      date;
  v_pct      numeric;
begin
  select * into s from solicitudes where id = p_solicitud for update;
  if s.pagado_en is not null or coalesce(s.monto_total, 0) <= 0 then
    return;
  end if;

  for p in
    select monto, fecha_pago from pagos
     where solicitud_id = p_solicitud and estado = 'confirmado'
     order by fecha_pago, revisado_en, id
  loop
    v_suma := v_suma + p.monto;
    if v_suma >= s.monto_total then
      v_fecha := p.fecha_pago;
      exit;
    end if;
  end loop;

  if v_fecha is null then
    return;
  end if;

  v_mes := mes_abierto_desde(s.organizacion_id, v_fecha);

  update solicitudes
     set pagado_en = v_fecha, mes_cierre = v_mes, estatus_publico = 'pagado'
   where id = p_solicitud;

  -- Liga del equipo, de admin_org o de alguien inactivo: solo seguimiento, sin comisión.
  if coalesce(s.monto_honorarios, 0) > 0 and s.comisionista_id is not null then
    v_pct := porcentaje_vigente(s.organizacion_id, s.comisionista_id, v_mes);
    insert into comisiones (organizacion_id, comisionista_id, solicitud_id, tipo, base, porcentaje,
                            provisional, monto, mes, nota)
    values (s.organizacion_id, s.comisionista_id, s.id, 'comision', s.monto_honorarios, v_pct,
            porcentaje_es_provisional(s.organizacion_id, s.comisionista_id, v_mes),
            round(s.monto_honorarios * v_pct / 100, 2), v_mes,
            'Devengada al quedar pagado el trabajo');
  end if;
end;
$$;

-- Notion "Solicitado por": el comisionista o, si no hay, de quién era la liga.
create or replace function reclamar_por_crear(p_conector uuid, p_limite integer default 20)
returns table (
  solicitud_id uuid, cliente_nombre text, cliente_telefono text, cliente_correo text, servicio text,
  inmueble_direccion text, inmueble_municipio text, inmueble_clave_catastral text, inmueble_descripcion text,
  requiere_factura boolean, monto_honorarios numeric, monto_terceros numeric, aceptada_en timestamptz,
  comisionista text, marca text
) language plpgsql security definer set search_path = public as $$
declare
  k conectores%rowtype;
begin
  if not puede_operar_conector(p_conector) then
    raise exception 'Solo admin_org sincroniza el conector';
  end if;
  select * into k from conectores where id = p_conector;

  return query
  with elegidos as (
    select s.id from solicitudes s
     where s.organizacion_id = k.organizacion_id
       and s.estado = 'tramite' and s.externo_id is null
       and s.aceptada_en >= coalesce(k.activado_en, now())
       and (s.externo_reclamado_en is null or s.externo_reclamado_en < now() - interval '10 minutes')
     order by s.aceptada_en
     limit p_limite
     for update skip locked
  ), marcados as (
    update solicitudes s set externo_reclamado_en = now()
      from elegidos e where s.id = e.id
    returning s.*
  )
  select m.id, m.cliente_nombre, m.cliente_telefono, m.cliente_correo, nullif(trim(sv.nombre_notion), ''),
         m.inmueble_direccion, m.inmueble_municipio, m.inmueble_clave_catastral, m.inmueble_descripcion,
         m.requiere_factura, m.monto_honorarios, m.monto_terceros, m.aceptada_en,
         coalesce(p.nombre, 'Liga de cliente · ' || coalesce(nombre_visible(l), 'organización')), mc.nombre
    from marcados m
    join servicios sv on sv.id = m.servicio_id
    left join personas p on p.id = m.comisionista_id
    left join personas l on l.id = m.liga_de
    left join marcas mc on mc.id = m.marca_id;
end;
$$;

-- ------------------------------------------------------------
-- PERMISOS
-- ------------------------------------------------------------

revoke all on function dueno_de_liga(uuid, text), datos_liga_cliente(text, text),
  pedir_por_liga(text, text, text, text, text, uuid, boolean, text, text, text, text, integer, text, integer),
  datos_aviso_liga(uuid), mis_solicitudes_de_liga(), cliente_admite_adjunto(text), puede_ver_adjunto_cliente(text)
  from public, anon, authenticated;

grant execute on function datos_liga_cliente(text, text),
  pedir_por_liga(text, text, text, text, text, uuid, boolean, text, text, text, text, integer, text, integer),
  cliente_admite_adjunto(text)
  to anon, authenticated;
grant execute on function mis_solicitudes_de_liga(), puede_ver_adjunto_cliente(text) to authenticated;
grant execute on function datos_aviso_liga(uuid) to service_role;
-- liquidar_si_completo y reclamar_por_crear conservan sus permisos (create or replace no los toca).
