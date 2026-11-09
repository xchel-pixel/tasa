-- ============================================================
-- 0065 — DXF DEL MAPA CATASTRAL, CON SALDO POR PERSONA
--
-- "Descargar DXF" en la ficha del predio. Nadie lo tiene por omisión:
-- admin_org siempre y sin límite; a cualquier otra persona (comisionista
-- o equipo) la autoriza admin_org desde su ficha, con un saldo de
-- descargas o "sin límite". El saldo no vence.
--
-- · dxf_autorizaciones: (organización, persona) → activa y saldo (nulo =
--   sin límite). Solo se escribe por las funciones de abajo.
-- · dxf_movimientos: bitácora visible en la ficha (quién, cuándo, cuánto,
--   motivo) de autorizar, agregar y quitar.
-- · dxf_descargas: una fila por persona y predio (la primera descarga),
--   con el saldo que le quedó; volver a bajar el mismo predio no resta,
--   solo cuenta las veces. Es también el reporte de uso.
-- · catastro_dxf(): la revisión y el descuento van juntos y en la base.
--   La fila de la autorización se bloquea (for update) antes de mirar el
--   saldo: dos descargas al mismo tiempo se forman, y con saldo 1 solo
--   pasa una. Solo predios ya guardados: no consulta la fuente. Tope de
--   seguridad de 200 DXF nuevos al día por persona.
--   Errores con código propio para la ruta: TA403 no autorizado, TA404
--   predio no guardado, TA429 sin saldo o tope del día.
-- · "Pedir más": alerta cupo_agotado para admin_org (una abierta por
--   persona), dentro de Tasa, sin correo; se cierra al dar saldo.
-- ============================================================

create table dxf_autorizaciones (
  organizacion_id uuid not null references organizaciones(id) on delete restrict,
  persona_id      uuid not null references personas(id) on delete cascade,
  activa          boolean not null default true,
  saldo           integer check (saldo >= 0),
  actualizado_en  timestamptz not null default now(),
  primary key (organizacion_id, persona_id)
);
alter table dxf_autorizaciones enable row level security;
revoke all on dxf_autorizaciones from anon;
create policy leer_dxf_autorizaciones on dxf_autorizaciones for select
  using (organizacion_id = (select mi_org()) and ((select soy_staff()) or persona_id = (select mi_persona_id())));
grant select on dxf_autorizaciones to authenticated;
create trigger bitacora after insert or update or delete on dxf_autorizaciones
  for each row execute function registrar_bitacora();

create table dxf_movimientos (
  id              bigint generated always as identity primary key,
  organizacion_id uuid not null references organizaciones(id) on delete restrict,
  persona_id      uuid not null references personas(id) on delete cascade,
  accion          text not null check (accion in ('autorizar', 'agregar', 'quitar')),
  -- autorizar: saldo inicial; agregar: cuántas se sumaron; quitar: nulo.
  cantidad        integer check (cantidad >= 0),
  sin_limite      boolean not null default false,
  saldo_despues   integer,
  motivo          text not null check (char_length(trim(motivo)) between 3 and 300),
  hecho_por       uuid references personas(id) on delete set null,
  creado_en       timestamptz not null default now()
);
create index on dxf_movimientos (organizacion_id, persona_id, creado_en desc);
alter table dxf_movimientos enable row level security;
revoke all on dxf_movimientos from anon;
create policy leer_dxf_movimientos on dxf_movimientos for select
  using (organizacion_id = (select mi_org()) and (select soy_staff()));
grant select on dxf_movimientos to authenticated;

create table dxf_descargas (
  id              bigint generated always as identity primary key,
  organizacion_id uuid not null references organizaciones(id) on delete restrict,
  persona_id      uuid not null references personas(id) on delete cascade,
  clave           text not null,
  -- Lo que le quedó después de la primera descarga; nulo = sin límite.
  saldo_despues   integer,
  veces           integer not null default 1,
  ultima_en       timestamptz not null default now(),
  creado_en       timestamptz not null default now(),
  unique (organizacion_id, persona_id, clave)
);
create index on dxf_descargas (organizacion_id, creado_en desc);
alter table dxf_descargas enable row level security;
revoke all on dxf_descargas from anon;
create policy leer_dxf_descargas on dxf_descargas for select
  using (organizacion_id = (select mi_org()) and ((select soy_staff()) or persona_id = (select mi_persona_id())));
grant select on dxf_descargas to authenticated;

-- ------------------------------------------------------------
-- Estado: ¿puede bajar DXF y cuánto le queda?
-- ------------------------------------------------------------

-- {autorizado, sin_limite, saldo}. Requiere además el mapa en su catálogo.
create or replace function dxf_estado_de(p_org uuid, p_persona uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select case
    when not catastro_tiene_herramienta(p_org, p_persona) then jsonb_build_object('autorizado', false, 'sin_limite', false, 'saldo', 0)
    when catastro_rol_de(p_org, p_persona) = 'admin_org' then jsonb_build_object('autorizado', true, 'sin_limite', true, 'saldo', null)
    else coalesce(
      (select jsonb_build_object('autorizado', true, 'sin_limite', a.saldo is null, 'saldo', a.saldo)
         from dxf_autorizaciones a where a.organizacion_id = p_org and a.persona_id = p_persona and a.activa),
      jsonb_build_object('autorizado', false, 'sin_limite', false, 'saldo', 0))
  end;
$$;

create or replace function mi_dxf()
returns jsonb language sql stable security definer set search_path = public as $$
  select dxf_estado_de(mi_org(), mi_persona_id());
$$;

-- ------------------------------------------------------------
-- La descarga
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
  return jsonb_build_object('clave', p.clave, 'geometria', p.geometria, 'consultado_en', p.consultado_en, 'saldo', v_saldo);
end;
$$;

-- ------------------------------------------------------------
-- admin_org: autorizar, agregar y quitar (con motivo y bitácora)
-- ------------------------------------------------------------

create or replace function dxf_revisar_persona(p_persona uuid, p_motivo text)
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if not soy_admin_org() then
    raise exception 'Solo admin_org autoriza DXF';
  end if;
  if not exists (select 1 from membresias m where m.organizacion_id = mi_org() and m.persona_id = p_persona and m.activa
                   and m.rol <> 'admin_org') then
    raise exception 'Esa persona no está en tu organización (admin_org ya lo tiene sin límite)';
  end if;
  if char_length(trim(coalesce(p_motivo, ''))) < 3 then
    raise exception 'Escribe el motivo';
  end if;
end;
$$;

create or replace function dxf_cerrar_pedido(p_persona uuid, p_resolucion text)
returns void language sql security definer set search_path = public as $$
  update alertas set resuelta_en = now(), resuelta_por = mi_persona_id(), resolucion = p_resolucion
   where organizacion_id = mi_org() and tipo = 'cupo_agotado' and resuelta_en is null
     and codigo = p_persona || ':mapa_catastral_dxf:saldo';
$$;

-- p_saldo nulo = sin límite. Si ya estaba autorizada, el saldo queda en lo que se indique.
create or replace function dxf_autorizar(p_persona uuid, p_saldo integer, p_motivo text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform dxf_revisar_persona(p_persona, p_motivo);
  if p_saldo is not null and p_saldo not between 0 and 10000 then
    raise exception 'El saldo va de 0 a 10,000';
  end if;
  perform set_config('tasa.motivo', 'DXF: ' || trim(p_motivo), true);
  insert into dxf_autorizaciones (organizacion_id, persona_id, activa, saldo)
  values (mi_org(), p_persona, true, p_saldo)
  on conflict (organizacion_id, persona_id) do update set activa = true, saldo = excluded.saldo, actualizado_en = now();
  insert into dxf_movimientos (organizacion_id, persona_id, accion, cantidad, sin_limite, saldo_despues, motivo, hecho_por)
  values (mi_org(), p_persona, 'autorizar', p_saldo, p_saldo is null, p_saldo, trim(p_motivo), mi_persona_id());
  perform dxf_cerrar_pedido(p_persona, case when p_saldo is null then 'DXF sin límite' else 'Saldo de ' || p_saldo || ' DXF' end);
  perform set_config('tasa.motivo', '', true);
end;
$$;

create or replace function dxf_agregar(p_persona uuid, p_cantidad integer, p_motivo text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_saldo integer;
begin
  perform dxf_revisar_persona(p_persona, p_motivo);
  if coalesce(p_cantidad, 0) not between 1 and 1000 then
    raise exception 'La cantidad va de 1 a 1,000';
  end if;
  if not exists (select 1 from dxf_autorizaciones where organizacion_id = mi_org() and persona_id = p_persona and activa) then
    raise exception 'Primero autorízala';
  end if;
  if exists (select 1 from dxf_autorizaciones where organizacion_id = mi_org() and persona_id = p_persona and activa and saldo is null) then
    raise exception 'Ya tiene DXF sin límite';
  end if;
  perform set_config('tasa.motivo', 'DXF: ' || trim(p_motivo), true);
  update dxf_autorizaciones set saldo = saldo + p_cantidad, actualizado_en = now()
   where organizacion_id = mi_org() and persona_id = p_persona
  returning saldo into v_saldo;
  insert into dxf_movimientos (organizacion_id, persona_id, accion, cantidad, saldo_despues, motivo, hecho_por)
  values (mi_org(), p_persona, 'agregar', p_cantidad, v_saldo, trim(p_motivo), mi_persona_id());
  perform dxf_cerrar_pedido(p_persona, 'Se agregaron ' || p_cantidad || ' DXF');
  perform set_config('tasa.motivo', '', true);
end;
$$;

create or replace function dxf_quitar(p_persona uuid, p_motivo text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform dxf_revisar_persona(p_persona, p_motivo);
  perform set_config('tasa.motivo', 'DXF: ' || trim(p_motivo), true);
  update dxf_autorizaciones set activa = false, actualizado_en = now()
   where organizacion_id = mi_org() and persona_id = p_persona and activa;
  if not found then
    raise exception 'No tenía autorización';
  end if;
  insert into dxf_movimientos (organizacion_id, persona_id, accion, motivo, hecho_por)
  values (mi_org(), p_persona, 'quitar', trim(p_motivo), mi_persona_id());
  perform dxf_cerrar_pedido(p_persona, 'Se quitó la autorización');
  perform set_config('tasa.motivo', '', true);
end;
$$;

-- "Pedir más": solo con saldo 0. Una alerta abierta por persona.
create or replace function pedir_mas_dxf()
returns void language plpgsql security definer set search_path = public as $$
declare
  e jsonb := mi_dxf();
begin
  if not (e->>'autorizado')::boolean then
    raise exception 'El DXF no está disponible para ti';
  end if;
  if (e->>'sin_limite')::boolean or (e->>'saldo')::integer > 0 then
    raise exception 'Todavía te quedan DXF';
  end if;
  insert into alertas (organizacion_id, tipo, codigo, mensaje)
  values (mi_org(), 'cupo_agotado', mi_persona_id() || ':mapa_catastral_dxf:saldo',
          (select nombre from personas where id = mi_persona_id()) || ' se quedó sin DXF del mapa catastral y pide más.')
  on conflict do nothing;
end;
$$;

-- Para la ficha de la persona (staff).
create or replace function dxf_estado_persona(p_persona uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not soy_staff() then raise exception 'Solo administración'; end if;
  return dxf_estado_de(mi_org(), p_persona) || jsonb_build_object('tiene_mapa', catastro_tiene_herramienta(mi_org(), p_persona));
end;
$$;

revoke all on function dxf_estado_de(uuid, uuid), mi_dxf(), catastro_dxf(text), dxf_revisar_persona(uuid, text), dxf_cerrar_pedido(uuid, text),
  dxf_autorizar(uuid, integer, text), dxf_agregar(uuid, integer, text), dxf_quitar(uuid, text), pedir_mas_dxf(), dxf_estado_persona(uuid)
  from public, anon, authenticated;
grant execute on function mi_dxf(), catastro_dxf(text), dxf_autorizar(uuid, integer, text), dxf_agregar(uuid, integer, text),
  dxf_quitar(uuid, text), pedir_mas_dxf(), dxf_estado_persona(uuid) to authenticated;
