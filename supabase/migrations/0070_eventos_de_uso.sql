-- ============================================================
-- 0070 — EVENTOS DE USO Y ORIGEN DE LA SOLICITUD
--
-- eventos_uso: un renglón por cada cosa que alguien hace o intenta con
-- las herramientas: consulta del mapa (de la fuente o de lo guardado, con
-- clave, duración y resultado), PDF, DXF, cálculo, acceso a Tasa y cada
-- denegación (403/429: sin herramienta, sin cupo, sin saldo, tope del
-- día…). Las denegaciones se registran en la misma función de la base que
-- niega. Por eso esas funciones ya no lanzan error al negar (un error
-- desharía el registro): registran y devuelven el motivo, y la ruta
-- responde 403 o 429 igual que antes.
--
-- · Solo se escribe con funciones (nadie inserta directo). Lo leen
--   admin_org y finanzas de su organización; cada persona, lo suyo.
-- · No guarda IP. Del navegador, solo un resumen ("Chrome en Android").
-- · solicitudes.origen_herramienta: 'mapa_catastral' (botón "Cotizar
--   avalúo", con la consulta de origen) o 'calculadora_traslado'.
-- ============================================================

create table eventos_uso (
  id              bigint generated always as identity primary key,
  organizacion_id uuid not null references organizaciones(id) on delete cascade,
  persona_id      uuid references personas(id) on delete set null,
  herramienta     text not null check (herramienta in ('mapa_catastral', 'mapa_catastral_pdf', 'mapa_catastral_dxf', 'mapa_catastral_mosaicos',
                                                       'calculadora_traslado', 'calculadora_traslado_completa', 'acceso')),
  evento          text not null check (evento in ('consulta', 'pdf', 'dxf', 'calculo', 'acceso', 'denegado')),
  -- Consultas del mapa: de la fuente externa o de lo ya guardado en Tasa (reuso).
  origen          text check (origen in ('fuente', 'guardado')),
  clave           text check (clave is null or clave ~ '^(0[1-9]|1[0-8])[0-9]{13}$'),
  resultado       text not null check (resultado in ('ok', 'pendiente', 'sin_predio', 'falla', 'denegado')),
  -- Denegaciones: sin_herramienta, rol, demo, sin_cupo, sin_saldo, tope_dia, limite_mosaicos, no_autorizado.
  codigo          text check (codigo is null or char_length(codigo) <= 40),
  estado_http     smallint,
  -- Si gastó cupo o saldo.
  consumio        boolean not null default false,
  duracion_ms     integer check (duracion_ms is null or duracion_ms >= 0),
  -- Un id del cálculo, o el resumen del navegador en un acceso.
  referencia      text check (referencia is null or char_length(referencia) <= 80),
  creado_en       timestamptz not null default now()
);
create index on eventos_uso (organizacion_id, creado_en desc);
create index on eventos_uso (persona_id, creado_en desc);
create index on eventos_uso (organizacion_id, herramienta, evento, creado_en desc);
alter table eventos_uso enable row level security;
revoke all on eventos_uso from anon;
create policy leer_eventos_uso on eventos_uso for select
  using (organizacion_id = (select mi_org()) and ((select soy_staff()) or persona_id = (select mi_persona_id())));
grant select on eventos_uso to authenticated;

create or replace function registrar_evento(
  p_org uuid, p_persona uuid, p_herramienta text, p_evento text, p_origen text, p_clave text, p_resultado text,
  p_codigo text default null, p_http smallint default null, p_consumio boolean default false, p_duracion integer default null,
  p_referencia text default null)
returns bigint language plpgsql security definer set search_path = public as $$
declare
  v_id bigint;
begin
  if p_org is null then
    return null;
  end if;
  insert into eventos_uso (organizacion_id, persona_id, herramienta, evento, origen, clave, resultado, codigo, estado_http, consumio,
                           duracion_ms, referencia)
  values (p_org, p_persona, p_herramienta, p_evento, p_origen,
          case when p_clave ~ '^(0[1-9]|1[0-8])[0-9]{13}$' then p_clave end,
          p_resultado, p_codigo, p_http, coalesce(p_consumio, false), p_duracion, left(p_referencia, 80))
  returning id into v_id;
  return v_id;
end;
$$;

-- Una denegación de quien tiene la sesión.
create or replace function registrar_denegacion(p_herramienta text, p_codigo text, p_http smallint, p_clave text default null)
returns void language sql security definer set search_path = public as $$
  select registrar_evento(mi_org(), mi_persona_id(), p_herramienta, 'denegado', null, p_clave, 'denegado', p_codigo, p_http);
$$;

-- ------------------------------------------------------------
-- Mapa: la consulta
-- ------------------------------------------------------------

-- Antes de ir a la fuente: nulo = adelante; si no, el motivo, y la denegación queda registrada.
create or replace function catastro_pedir_consulta(p_clave text default null)
returns text language plpgsql security definer set search_path = public as $$
declare
  v text := catastro_impedimento();
begin
  if v is not null then
    perform registrar_denegacion('mapa_catastral',
      case when v like '%no está disponible%' then 'sin_herramienta'
           when v like '%DEMO%' then 'demo'
           when v like '%tope%' then 'tope_dia'
           else 'sin_cupo' end,
      (case when v like '%no está disponible%' or v like '%DEMO%' then 403 else 429 end)::smallint, p_clave);
  end if;
  return v;
end;
$$;

-- Lo que resolvió el servidor: de la fuente (ok, pendiente, sin_predio, falla) o de lo guardado. Solo el servidor.
create or replace function catastro_registrar_consulta(p_org uuid, p_persona uuid, p_clave text, p_origen text, p_resultado text,
                                                       p_duracion integer)
returns bigint language plpgsql security definer set search_path = public as $$
begin
  if p_origen not in ('fuente', 'guardado') or p_resultado not in ('ok', 'pendiente', 'sin_predio', 'falla') then
    raise exception 'Evento inválido';
  end if;
  return registrar_evento(p_org, p_persona, 'mapa_catastral', 'consulta', p_origen, p_clave, p_resultado, null, null,
                          p_origen = 'fuente' and p_resultado in ('ok'), p_duracion);
end;
$$;

-- El acceso a Tasa (al entrar con el código). Solo el resumen del navegador.
create or replace function registrar_acceso(p_navegador text)
returns void language sql security definer set search_path = public as $$
  select registrar_evento(mi_org(), mi_persona_id(), 'acceso', 'acceso', null, null, 'ok', null, null, false, null,
                          nullif(trim(p_navegador), ''))
   where mi_persona_id() is not null;
$$;

-- ------------------------------------------------------------
-- PDF (0060): registra y, al negar, devuelve {error, estado} en vez de lanzar.
-- ------------------------------------------------------------

create or replace function catastro_pdf(p_clave text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_ficha jsonb;
  c       record;
  v_nuevo boolean := false;
begin
  if not exists (select 1 from mis_herramientas() where clave = 'mapa_catastral_pdf')
     or not exists (select 1 from mis_herramientas() where clave = 'mapa_catastral') then
    perform registrar_denegacion('mapa_catastral_pdf', 'sin_herramienta', 403::smallint, p_clave);
    return jsonb_build_object('error', 'El PDF del mapa catastral no está disponible para ti', 'estado', 403);
  end if;
  v_ficha := catastro_ficha_para(p_clave, true);
  if v_ficha is null then
    return jsonb_build_object('error', 'Ese predio no está guardado en Tasa; consúltalo primero en el mapa', 'estado', 404);
  end if;
  if not exists (select 1 from usos_herramienta u where u.organizacion_id = mi_org() and u.persona_id = mi_persona_id()
                   and u.herramienta = 'mapa_catastral_pdf' and u.referencia = p_clave and mes_mx(u.creado_en) = mes_mx(now())) then
    select * into c from mi_cupo('mapa_catastral_pdf');
    if c.disponibles is not null and c.disponibles <= 0 then
      perform registrar_denegacion('mapa_catastral_pdf', 'sin_cupo', 429::smallint, p_clave);
      return jsonb_build_object('error', 'Llegaste a tu límite de PDF del mes. Sube de nivel o pide más.', 'estado', 429);
    end if;
    insert into usos_herramienta (organizacion_id, persona_id, herramienta, modo, referencia)
    values (mi_org(), mi_persona_id(), 'mapa_catastral_pdf', 'pdf', p_clave);
    v_nuevo := true;
  end if;
  perform registrar_evento(mi_org(), mi_persona_id(), 'mapa_catastral_pdf', 'pdf', 'guardado', p_clave, 'ok', null, null, v_nuevo);
  return v_ficha;
end;
$$;

-- ------------------------------------------------------------
-- DXF (0065/0066): igual; 403 no autorizado, 429 sin saldo o tope del día, 404 no guardado.
-- ------------------------------------------------------------

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
                            'saldo', v_saldo);
end;
$$;

-- ------------------------------------------------------------
-- Mosaicos (0063): las negaciones, una vez por hora y motivo (no cada mosaico).
-- ------------------------------------------------------------

create or replace function catastro_permiso_mosaico()
returns text language plpgsql security definer set search_path = public as $$
declare
  v_hora     timestamptz := date_trunc('hour', now());
  v_cantidad integer;
  v_motivo   text;
begin
  if mi_persona_id() is null or coalesce(mi_rol(), '') not in ('admin_org', 'finanzas', 'equipo') then
    v_motivo := 'rol';
  elsif not exists (select 1 from mis_herramientas() where clave = 'mapa_catastral') then
    v_motivo := 'sin_herramienta';
  end if;
  if v_motivo is not null then
    if mi_org() is not null and not exists (
         select 1 from eventos_uso e where e.persona_id = mi_persona_id() and e.herramienta = 'mapa_catastral_mosaicos'
            and e.codigo = v_motivo and e.creado_en > now() - interval '1 hour') then
      perform registrar_denegacion('mapa_catastral_mosaicos', v_motivo, 403::smallint);
    end if;
    return v_motivo;
  end if;
  insert into catastro_mosaicos as m (organizacion_id, persona_id, hora, cantidad)
  values (mi_org(), mi_persona_id(), v_hora, 1)
  on conflict (organizacion_id, persona_id, hora) do update set cantidad = m.cantidad + 1
  returning cantidad into v_cantidad;
  if v_cantidad = 1 then
    delete from catastro_mosaicos where hora < now() - interval '2 days';
  end if;
  if v_cantidad = 601 then
    perform registrar_denegacion('mapa_catastral_mosaicos', 'limite_mosaicos', 429::smallint);
  end if;
  return case when v_cantidad > 600 then 'limite' else 'ok' end;
end;
$$;

-- ------------------------------------------------------------
-- Calculadora (0057): sin el modo o sin cupo, registra y devuelve nulo (la app avisa).
-- ------------------------------------------------------------

create or replace function guardar_calculo_traslado(p_modo text, p_referencia text, p_municipio text, p_lado text, p_entrada jsonb, p_resultado jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id   uuid;
  v_herr text := case when p_modo = 'completa' then 'calculadora_traslado_completa' else 'calculadora_traslado' end;
  c      record;
begin
  if not exists (select 1 from mis_herramientas() where clave = v_herr) then
    perform registrar_denegacion(v_herr, 'sin_herramienta', 403::smallint);
    return null;
  end if;
  select * into c from mi_cupo(v_herr);
  if c.disponibles is not null and c.disponibles <= 0 then
    perform registrar_denegacion(v_herr, 'sin_cupo', 429::smallint);
    return null;
  end if;
  insert into calculos_traslado (modo, referencia, municipio, lado, entrada, resultado)
  values (p_modo, nullif(left(trim(coalesce(p_referencia, '')), 80), ''), p_municipio, p_lado, p_entrada, p_resultado)
  returning id into v_id;
  perform consumir_cupo(v_herr, p_modo, v_id);
  perform registrar_evento(mi_org(), mi_persona_id(), v_herr, 'calculo', null, null, 'ok', null, null, true, null, v_id::text);
  return v_id;
end;
$$;

-- ------------------------------------------------------------
-- Origen de la solicitud
-- ------------------------------------------------------------

alter table solicitudes
  add column origen_herramienta text check (origen_herramienta in ('mapa_catastral', 'calculadora_traslado')),
  add column evento_origen_id   bigint references eventos_uso(id) on delete set null;
update solicitudes set origen_herramienta = 'calculadora_traslado' where calculo_traslado_id is not null;

create or replace function ligar_calculo_a_solicitud(p_solicitud uuid, p_calculo uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from calculos_traslado where id = p_calculo and organizacion_id = mi_org() and persona_id = mi_persona_id()) then
    raise exception 'Ese cálculo no es tuyo';
  end if;
  update solicitudes set calculo_traslado_id = p_calculo, origen_herramienta = 'calculadora_traslado'
   where id = p_solicitud and organizacion_id = mi_org() and comisionista_id = mi_persona_id() and estado = 'solicitada';
  if not found then
    raise exception 'Esa solicitud no es tuya';
  end if;
  update usos_herramienta set solicitud_id = p_solicitud where calculo_id = p_calculo and organizacion_id = mi_org() and solicitud_id is null;
end;
$$;

-- "Cotizar avalúo" desde la ficha del mapa: la solicitud queda marcada y ligada a la última consulta propia de esa clave.
create or replace function ligar_solicitud_al_mapa(p_solicitud uuid, p_clave text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_evento bigint;
begin
  select e.id into v_evento from eventos_uso e
   where e.organizacion_id = mi_org() and e.persona_id = mi_persona_id() and e.herramienta = 'mapa_catastral'
     and e.evento = 'consulta' and e.clave = p_clave and e.resultado in ('ok', 'pendiente')
     and e.creado_en > now() - interval '30 days'
   order by e.creado_en desc limit 1;
  update solicitudes set origen_herramienta = 'mapa_catastral', evento_origen_id = v_evento
   where id = p_solicitud and organizacion_id = mi_org() and comisionista_id = mi_persona_id() and estado = 'solicitada'
     and inmueble_clave_catastral = p_clave and origen_herramienta is null;
  if not found then
    raise exception 'Esa solicitud no es tuya';
  end if;
end;
$$;

revoke all on function registrar_evento(uuid, uuid, text, text, text, text, text, text, smallint, boolean, integer, text),
  registrar_denegacion(text, text, smallint, text), catastro_pedir_consulta(text),
  catastro_registrar_consulta(uuid, uuid, text, text, text, integer), registrar_acceso(text), ligar_solicitud_al_mapa(uuid, text)
  from public, anon, authenticated;
grant execute on function catastro_pedir_consulta(text), registrar_acceso(text), ligar_solicitud_al_mapa(uuid, text) to authenticated;
grant execute on function catastro_registrar_consulta(uuid, uuid, text, text, text, integer) to service_role;
