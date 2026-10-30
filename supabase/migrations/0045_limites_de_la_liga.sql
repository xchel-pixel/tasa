-- ============================================================
-- 0045 — LÍMITES DE LA LIGA DE CLIENTES
--
-- · Por teléfono y por conexión, al día: `ajustes.liga_max_por_telefono`
--   (10) y `liga_max_por_conexion` (20), editables en Ajustes. El tope de
--   200 por organización se queda.
-- · Sin límite para quien tiene sesión (staff o comisionista probando su
--   propia liga).
-- · Al bloquear, mensaje claro con a quién contactar, y alerta a admin
--   (una abierta por teléfono o conexión). Para que la alerta quede, la
--   función ya no truena al bloquear: regresa el mensaje en `bloqueo`.
-- · admin_org o finanzas liberan un teléfono desde la alerta: cuenta de
--   nuevo desde ese momento (`liga_liberaciones`).
-- ============================================================

alter table ajustes
  add column liga_max_por_telefono smallint not null default 10 check (liga_max_por_telefono between 1 and 100),
  add column liga_max_por_conexion smallint not null default 20 check (liga_max_por_conexion between 1 and 500);

create table liga_liberaciones (
  id              uuid primary key default gen_random_uuid(),
  organizacion_id uuid not null default mi_org() references organizaciones(id) on delete restrict,
  telefono        text not null check (telefono ~ '^[0-9]{10}$'),
  liberado_por    uuid references personas(id) on delete set null,
  liberado_en     timestamptz not null default now()
);
create index on liga_liberaciones (organizacion_id, telefono, liberado_en desc);
alter table liga_liberaciones enable row level security;
revoke all on liga_liberaciones from anon;
grant select on liga_liberaciones to authenticated;
create policy leer_liberaciones on liga_liberaciones for select
  using (organizacion_id = (select mi_org()) and (select soy_staff()));
create trigger bitacora after insert or update or delete on liga_liberaciones
  for each row execute function registrar_bitacora();

alter table alertas drop constraint alertas_tipo_check;
alter table alertas drop constraint alertas_tipo_completo;
alter table alertas
  add constraint alertas_tipo_check check (tipo in ('cancelado_externo', 'externo_borrado', 'liga_inactiva', 'conector', 'estimado_sin_final', 'liga_limite')),
  add constraint alertas_tipo_completo check (
    (tipo in ('cancelado_externo', 'externo_borrado', 'liga_inactiva', 'estimado_sin_final') and solicitud_id is not null)
    or (tipo = 'conector' and conector_id is not null and codigo is not null)
    or (tipo = 'liga_limite' and codigo is not null));

drop function pedir_por_liga(text, text, text, text, text, uuid, boolean, text, text, text, text, integer, text, integer);

create function pedir_por_liga(
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
returns table (solicitud uuid, token uuid, organizacion uuid, bloqueo text)
language plpgsql security definer set search_path = public as $$
declare
  o         organizaciones%rowtype;
  a         ajustes%rowtype;
  d         record;
  v_tel     text := regexp_replace(coalesce(p_telefono, ''), '\D', '', 'g');
  v_correo  text := nullif(lower(trim(p_correo)), '');
  v_id      uuid;
  v_token   uuid;
  v_tipo    text;
  v_con     text;
  v_desde   timestamptz;
begin
  select * into o from organizaciones where slug = lower(trim(p_org)) and activa;
  if not found then
    raise exception 'Esta liga no es válida';
  end if;
  select * into a from ajustes where organizacion_id = o.id;
  select * into d from dueno_de_liga(o.id, p_codigo);
  if d.persona_id is null then
    raise exception 'Esta liga no es válida';
  end if;
  v_con := case when d.activo then (select nombre_visible(p) from personas p where p.id = d.persona_id) else o.nombre end;

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
  if p_aviso_version is distinct from a.aviso_version or coalesce(p_aviso_version, 0) = 0 then
    raise exception 'El aviso de privacidad cambió: recarga la página y vuelve a aceptarlo';
  end if;
  if coalesce(p_adjuntos, 0) not between 0 and 3 then
    raise exception 'Hasta 3 archivos';
  end if;

  -- Límites al día, solo sin sesión. El teléfono cuenta desde su última liberación.
  if auth.uid() is null then
    v_desde := greatest(now() - interval '24 hours',
                        coalesce((select max(liberado_en) from liga_liberaciones where organizacion_id = o.id and telefono = v_tel), '-infinity'));
    if (select count(*) from solicitudes
         where organizacion_id = o.id and origen = 'liga_cliente' and cliente_telefono = v_tel and creado_en > v_desde)
       >= a.liga_max_por_telefono then
      if not exists (select 1 from alertas where organizacion_id = o.id and tipo = 'liga_limite' and codigo = v_tel and resuelta_en is null) then
        insert into alertas (organizacion_id, tipo, codigo, mensaje)
        values (o.id, 'liga_limite', v_tel,
                'La liga de ' || v_con || ' llegó al límite de ' || a.liga_max_por_telefono
                || ' solicitudes al día con el teléfono ' || v_tel || '. Si es un cliente real, libera el teléfono.');
      end if;
      return query select null::uuid, null::uuid, o.id,
        'Ya recibimos ' || a.liga_max_por_telefono || ' solicitudes hoy con este teléfono. Para continuar, comunícate con ' || v_con || '.';
      return;
    end if;
    if (select count(*) from solicitudes
         where organizacion_id = o.id and origen = 'liga_cliente' and ip_resumen = p_ip_resumen and creado_en > now() - interval '24 hours')
       >= a.liga_max_por_conexion then
      if not exists (select 1 from alertas where organizacion_id = o.id and tipo = 'liga_limite' and codigo = 'conexion:' || p_ip_resumen
                                                and resuelta_en is null) then
        insert into alertas (organizacion_id, tipo, codigo, mensaje)
        values (o.id, 'liga_limite', 'conexion:' || p_ip_resumen,
                'La liga de ' || v_con || ' llegó al límite de ' || a.liga_max_por_conexion
                || ' solicitudes al día desde una misma conexión. Se libera solo en 24 horas.');
      end if;
      return query select null::uuid, null::uuid, o.id,
        'Llegaron muchas solicitudes desde esta conexión hoy. Inténtalo mañana o comunícate con ' || v_con || '.';
      return;
    end if;
    if (select count(*) from solicitudes
         where organizacion_id = o.id and origen = 'liga_cliente' and creado_en > now() - interval '24 hours') >= 200 then
      raise exception 'Por hoy no podemos recibir más solicitudes en línea. Comunícate con %.', v_con;
    end if;
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

  return query select v_id, v_token, o.id, null::text;
end;
$$;
revoke all on function pedir_por_liga(text, text, text, text, text, uuid, boolean, text, text, text, text, integer, text, integer) from public;
grant execute on function pedir_por_liga(text, text, text, text, text, uuid, boolean, text, text, text, text, integer, text, integer) to anon, authenticated;

-- Liberar un teléfono desde su alerta: vuelve a contar desde ahora.
create or replace function liberar_telefono_liga(p_alerta uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  al alertas%rowtype;
begin
  if not soy_staff() then
    raise exception 'Solo administración o finanzas liberan un teléfono';
  end if;
  select * into al from alertas where id = p_alerta and organizacion_id = mi_org() and tipo = 'liga_limite' and resuelta_en is null;
  if not found then
    raise exception 'Esa alerta ya no está abierta';
  end if;
  if al.codigo !~ '^[0-9]{10}$' then
    raise exception 'Esa alerta es de una conexión: se libera sola en 24 horas';
  end if;
  perform set_config('tasa.motivo', 'Teléfono liberado en la liga de clientes', true);
  insert into liga_liberaciones (organizacion_id, telefono, liberado_por) values (al.organizacion_id, al.codigo, mi_persona_id());
  update alertas set resuelta_en = now(), resuelta_por = mi_persona_id(), resolucion = 'Teléfono liberado' where id = al.id;
  perform set_config('tasa.motivo', '', true);
end;
$$;
revoke all on function liberar_telefono_liga(uuid) from public, anon;
grant execute on function liberar_telefono_liga(uuid) to authenticated;
