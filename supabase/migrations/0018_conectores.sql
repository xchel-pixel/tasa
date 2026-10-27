-- ============================================================
-- 0018 — CONECTORES
--
-- Lo que un conector externo (Notion hoy; Sheets y webhook después)
-- le dice a Tasa entra por las mismas puertas, y las reglas viven aquí:
--   · registrar_lectura: folio, estatus, fecha de visita, cancelación;
--   · registrar_registro_externo: el id del registro que creó afuera;
--   · registrar_error_conector / registrar_sync_ok: el conector nunca
--     falla en silencio. Un error deja el conector en "error" y una
--     alerta para admin_org (una por tipo de falla); el siguiente sync
--     bueno las cierra.
--
-- Credenciales: cifradas en Supabase Vault. admin_org la guarda y la
-- reemplaza; nadie con sesión la vuelve a leer. Solo la llave de
-- servicio (el cron) la descifra.
-- ============================================================

-- ------------------------------------------------------------
-- 1. CONFIGURAR
-- ------------------------------------------------------------

-- La configuración y el mapeo los edita admin_org directo (RLS de
-- 0017); la credencial, el estado y el tipo, solo por función.
revoke update on conectores from authenticated;
grant update (configuracion, mapeo_campos) on conectores to authenticated;

-- Cambiar el conector activo de la organización. Por ahora la
-- aplicación solo ofrece "manual"; los demás tipos los acepta la base
-- para no tener que migrar cuando lleguen.
create or replace function activar_conector(p_tipo text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := mi_org();
  v_id  uuid;
begin
  if not soy_admin_org() then
    raise exception 'Solo admin_org cambia el conector';
  end if;
  if p_tipo not in ('manual', 'notion', 'sheets', 'webhook') then
    raise exception 'Tipo de conector no válido';
  end if;
  select id into v_id from conectores where organizacion_id = v_org and tipo = p_tipo;
  update conectores set activo = false where organizacion_id = v_org and activo and id is distinct from v_id;
  if v_id is null then
    insert into conectores (organizacion_id, tipo) values (v_org, p_tipo) returning id into v_id;
  else
    update conectores set activo = true where id = v_id;
  end if;
  return v_id;
end;
$$;

-- Guarda o reemplaza la credencial. Devuelve nada: el valor no regresa.
create or replace function guardar_credencial_conector(p_conector uuid, p_valor text)
returns void language plpgsql security definer set search_path = public as $$
declare
  c conectores%rowtype;
begin
  if not soy_admin_org() then
    raise exception 'Solo admin_org guarda credenciales';
  end if;
  select * into c from conectores where id = p_conector and organizacion_id = mi_org() for update;
  if not found then
    raise exception 'No existe ese conector';
  end if;
  if c.tipo = 'manual' then
    raise exception 'El conector manual no usa credencial';
  end if;
  if nullif(trim(p_valor), '') is null then
    raise exception 'Escribe la credencial';
  end if;

  if c.credencial_id is null then
    update conectores
       set credencial_id = vault.create_secret(trim(p_valor), 'conector_' || c.id::text,
                                               'Credencial del conector ' || c.tipo),
           credencial_guardada_en = now()
     where id = c.id;
  else
    perform vault.update_secret(c.credencial_id, trim(p_valor));
    update conectores set credencial_guardada_en = now() where id = c.id;
  end if;
end;
$$;

-- Solo el cron (llave de servicio).
create or replace function credencial_conector(p_conector uuid)
returns text language sql stable security definer set search_path = public as $$
  select s.decrypted_secret
    from conectores c join vault.decrypted_secrets s on s.id = c.credencial_id
   where c.id = p_conector;
$$;

-- ------------------------------------------------------------
-- 2. LO QUE ENTRA DEL SISTEMA EXTERNO
-- ------------------------------------------------------------

-- El cron entra sin usuario; el botón "sincronizar ahora", con la
-- sesión de admin_org de esa organización. Nadie más.
create or replace function puede_operar_conector(p_conector uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is null
      or exists (select 1 from conectores where id = p_conector and organizacion_id = mi_org() and soy_admin_org());
$$;

-- 'sin_trabajo' · 'sin_cambios' · 'actualizado' · 'alerta'
create or replace function registrar_lectura(
  p_conector     uuid,
  p_externo_id   text,
  p_titulo       text,
  p_etapa        text,
  p_fecha_visita date
)
returns text language plpgsql security definer set search_path = public as $$
declare
  k          conectores%rowtype;
  s          solicitudes%rowtype;
  v_prefijo  text;
  v_folio    text;
  v_estatus  text;
  v_alerta   boolean := false;
begin
  if not puede_operar_conector(p_conector) then
    raise exception 'Solo admin_org sincroniza el conector';
  end if;
  select * into k from conectores where id = p_conector;
  select prefijo_folio into v_prefijo from organizaciones where id = k.organizacion_id;

  select * into s from solicitudes
   where organizacion_id = k.organizacion_id and externo_id = p_externo_id for update;
  if not found then
    return 'sin_trabajo';
  end if;

  v_folio := coalesce(substring(p_titulo from v_prefijo || '-[0-9]{4}-[0-9]{4}'), s.folio);

  v_estatus := s.estatus_publico;
  if p_etapa = coalesce(k.configuracion->>'valor_cancelado', 'Cancelado') then
    if s.estado <> 'cancelada' then
      insert into alertas (organizacion_id, tipo, solicitud_id, mensaje)
      values (k.organizacion_id, 'cancelado_externo', s.id,
              'Cancelado en ' || initcap(k.tipo) || ', confirmar en Tasa: '
              || coalesce(v_folio, 'sin folio') || ' · ' || s.cliente_nombre)
      on conflict (solicitud_id, tipo) where resuelta_en is null do nothing;
      v_alerta := found;
    end if;
  elsif s.estado = 'tramite' and s.estatus_publico not in ('pagado', 'cancelada') then
    select estatus_publico into v_estatus from mapeo_estatus
     where conector_id = k.id and valor_externo = p_etapa;
    if v_estatus = 'aceptada' and p_fecha_visita is not null then
      v_estatus := 'visita_agendada';
    end if;
    v_estatus := coalesce(v_estatus, s.estatus_publico);
  end if;

  update solicitudes
     set folio            = v_folio,
         estatus_externo  = p_etapa,
         estatus_publico  = v_estatus,
         externo_leido_en = now()
   where id = s.id;

  if v_alerta then
    return 'alerta';
  elsif v_folio is distinct from s.folio
     or v_estatus is distinct from s.estatus_publico
     or p_etapa is distinct from s.estatus_externo then
    return 'actualizado';
  end if;
  return 'sin_cambios';
end;
$$;

-- El registro que el conector creó afuera al aceptarse el trámite.
create or replace function registrar_registro_externo(p_conector uuid, p_solicitud uuid, p_externo_id text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not puede_operar_conector(p_conector) then
    raise exception 'Solo admin_org sincroniza el conector';
  end if;
  update solicitudes s
     set externo_id = p_externo_id, externo_leido_en = now()
    from conectores k
   where k.id = p_conector and s.id = p_solicitud
     and s.organizacion_id = k.organizacion_id and s.externo_id is null;
end;
$$;

create or replace function registrar_error_conector(p_conector uuid, p_codigo text, p_mensaje text)
returns void language plpgsql security definer set search_path = public as $$
declare
  k conectores%rowtype;
begin
  if not puede_operar_conector(p_conector) then
    raise exception 'Solo admin_org sincroniza el conector';
  end if;
  if p_codigo not in ('propiedad_no_encontrada', 'credencial_invalida', 'inaccesible', 'limite', 'otro') then
    raise exception 'Código de error no válido';
  end if;
  select * into k from conectores where id = p_conector;
  update conectores set estado = 'error', ultimo_error = left(p_mensaje, 500) where id = k.id;
  insert into alertas (organizacion_id, tipo, conector_id, codigo, mensaje)
  values (k.organizacion_id, 'conector', k.id, p_codigo, left(p_mensaje, 500))
  on conflict (conector_id, codigo) where resuelta_en is null and tipo = 'conector'
  do update set mensaje = excluded.mensaje;
end;
$$;

create or replace function registrar_sync_ok(p_conector uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not puede_operar_conector(p_conector) then
    raise exception 'Solo admin_org sincroniza el conector';
  end if;
  update conectores set estado = 'activo', ultimo_sync = now(), ultimo_error = null where id = p_conector;
  update alertas
     set resuelta_en = now(), resolucion = 'El siguiente sync salió bien'
   where conector_id = p_conector and tipo = 'conector' and resuelta_en is null;
end;
$$;

-- ------------------------------------------------------------
-- 3. PERMISOS
-- ------------------------------------------------------------

revoke all on function
  activar_conector(text), guardar_credencial_conector(uuid, text), credencial_conector(uuid),
  puede_operar_conector(uuid), registrar_lectura(uuid, text, text, text, date),
  registrar_registro_externo(uuid, uuid, text), registrar_error_conector(uuid, text, text),
  registrar_sync_ok(uuid)
  from public, anon, authenticated;

grant execute on function
  activar_conector(text), guardar_credencial_conector(uuid, text),
  registrar_lectura(uuid, text, text, text, date), registrar_registro_externo(uuid, uuid, text),
  registrar_error_conector(uuid, text, text), registrar_sync_ok(uuid)
  to authenticated;

grant execute on function
  credencial_conector(uuid), puede_operar_conector(uuid), registrar_lectura(uuid, text, text, text, date),
  registrar_registro_externo(uuid, uuid, text), registrar_error_conector(uuid, text, text),
  registrar_sync_ok(uuid)
  to service_role;
