-- ============================================================
-- 0019 — DESHACER POR ROL, EVENTOS DEL TRABAJO Y CATÁLOGOS
--
-- 1. admin_marca también revierte pagos y anula cotizaciones, solo de
--    trabajos de sus marcas. Finanzas sigue sin anular bonos/ajustes
--    (eso es de admin_org, 0016).
-- 2. Eventos del trabajo: cada deshacer con su motivo queda también en
--    el historial del trabajo, que el staff ve en la ficha (la bitácora
--    solo la lee admin_org). Los anotan disparadores, así ninguna
--    función se puede olvidar.
-- 3. meses_cerrados(): para que la pantalla sepa cuándo NO ofrecer el
--    botón (admin_marca no lee la tabla de cierres).
-- 4. Color opcional por marca.
-- ============================================================

-- ------------------------------------------------------------
-- 1. QUIÉN OPERA UN TRABAJO
-- ------------------------------------------------------------

create or replace function opero_trabajo(p_solicitud uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from solicitudes s
     where s.id = p_solicitud and s.organizacion_id = mi_org()
       and (soy_staff() or (mi_rol() = 'admin_marca' and s.marca_id = any (mis_marcas())))
  );
$$;

create or replace function revertir_pago(p_pago uuid, p_motivo text)
returns void language plpgsql security definer set search_path = public as $$
declare
  p          pagos%rowtype;
  s          solicitudes%rowtype;
  v_anterior text;
begin
  select * into p from pagos where id = p_pago and organizacion_id = mi_org() for update;
  if not found or not opero_trabajo(p.solicitud_id) then
    raise exception 'No existe ese pago';
  end if;
  if p.estado not in ('confirmado', 'rechazado') then
    raise exception 'Solo se revierte un pago confirmado o rechazado (este está %)', p.estado;
  end if;
  perform mes_cerrado_para(p.organizacion_id, p.fecha_pago);
  perform poner_motivo(p_motivo);

  if p.estado = 'confirmado' then
    select * into s from solicitudes where id = p.solicitud_id for update;
    if s.pagado_en is not null then
      if exists (select 1 from comisiones
                  where solicitud_id = s.id and tipo = 'comision' and mes_aprobado(s.organizacion_id, mes)) then
        raise exception 'Mes cerrado: corrige con un ajuste en el mes abierto';
      end if;
      delete from comisiones where solicitud_id = s.id and tipo = 'comision';

      select estatus_publico into v_anterior
        from historial_estatus
       where solicitud_id = s.id and estatus_publico <> 'pagado'
       order by desde desc limit 1;
      update solicitudes
         set pagado_en = null, mes_cierre = null,
             estatus_publico = coalesce(v_anterior, 'entregado')
       where id = s.id;
    end if;
  end if;

  perform set_config('tasa.revertir', 'on', true);
  update pagos set estado = 'reportado' where id = p_pago;
  perform set_config('tasa.revertir', '', true);
  perform set_config('tasa.motivo', '', true);
end;
$$;

create or replace function anular_cotizacion(p_cotizacion uuid, p_motivo text)
returns void language plpgsql security definer set search_path = public as $$
declare
  c cotizaciones%rowtype;
begin
  select * into c from cotizaciones where id = p_cotizacion and organizacion_id = mi_org() for update;
  if not found or not opero_trabajo(c.solicitud_id) then
    raise exception 'No existe esa cotización';
  end if;
  if c.estado <> 'emitida' then
    raise exception 'Solo se anula una cotización emitida que nadie ha aceptado';
  end if;
  perform poner_motivo(p_motivo);
  update cotizaciones
     set estado = 'anulada', respondida_en = now(), motivo_anulacion = trim(p_motivo)
   where id = c.id;
  update solicitudes
     set estado = 'solicitada', estatus_publico = 'solicitada'
   where id = c.solicitud_id and estado = 'cotizada';
  perform set_config('tasa.motivo', '', true);
end;
$$;

-- ------------------------------------------------------------
-- 2. EVENTOS DEL TRABAJO
-- ------------------------------------------------------------

create table eventos_trabajo (
  id               uuid primary key default gen_random_uuid(),
  organizacion_id  uuid not null default mi_org() references organizaciones(id) on delete restrict,
  solicitud_id     uuid not null,
  accion           text not null check (accion in (
                     'revertir_confirmacion', 'revertir_rechazo', 'retirar_pago',
                     'anular_cotizacion', 'cancelar')),
  motivo           text,
  detalle          text,
  persona_id       uuid references personas(id) on delete set null,
  creado_en        timestamptz not null default now(),
  foreign key (organizacion_id, solicitud_id) references solicitudes (organizacion_id, id) on delete cascade
);

create index on eventos_trabajo (solicitud_id, creado_en);

create or replace function anotar_evento_pago()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_accion text;
begin
  if new.estado = old.estado then
    return null;
  end if;
  v_accion := case
    when old.estado = 'confirmado' and new.estado = 'reportado' then 'revertir_confirmacion'
    when old.estado = 'rechazado' and new.estado = 'reportado' then 'revertir_rechazo'
    when new.estado = 'retirado' then 'retirar_pago'
  end;
  if v_accion is not null then
    insert into eventos_trabajo (organizacion_id, solicitud_id, accion, motivo, detalle, persona_id)
    values (new.organizacion_id, new.solicitud_id, v_accion,
            coalesce(nullif(current_setting('tasa.motivo', true), ''), new.motivo_retiro),
            'Pago de ' || to_char(new.monto, 'FM$999,999,990.00') || ' del ' || to_char(new.fecha_pago, 'DD/MM/YYYY'),
            mi_persona_id());
  end if;
  return null;
end;
$$;

create trigger evento_pago
  after update of estado on pagos
  for each row execute function anotar_evento_pago();

create or replace function anotar_evento_cotizacion()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.estado = 'anulada' and old.estado is distinct from 'anulada' then
    insert into eventos_trabajo (organizacion_id, solicitud_id, accion, motivo, detalle, persona_id)
    values (new.organizacion_id, new.solicitud_id, 'anular_cotizacion', new.motivo_anulacion,
            'Cotización de ' || to_char(new.monto_total, 'FM$999,999,990.00'), mi_persona_id());
  end if;
  return null;
end;
$$;

create trigger evento_cotizacion
  after update of estado on cotizaciones
  for each row execute function anotar_evento_cotizacion();

create or replace function anotar_evento_cancelacion()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.estado = 'cancelada' and old.estado is distinct from 'cancelada' then
    insert into eventos_trabajo (organizacion_id, solicitud_id, accion, motivo, persona_id)
    values (new.organizacion_id, new.id, 'cancelar', new.motivo_cancelacion, mi_persona_id());
  end if;
  return null;
end;
$$;

create trigger evento_cancelacion
  after update of estado on solicitudes
  for each row execute function anotar_evento_cancelacion();

alter table eventos_trabajo enable row level security;
revoke all on eventos_trabajo from anon;
grant select on eventos_trabajo to authenticated;
revoke insert, update, delete on eventos_trabajo from authenticated;

-- El staff y el admin de la marca; el comisionista no (ve el resultado,
-- no la discusión interna).
create policy leer_eventos on eventos_trabajo for select
  using (organizacion_id = (select mi_org()) and (
    (select soy_staff())
    or solicitud_id in (select id from solicitudes where marca_id = any ((select mis_marcas())::uuid[]))));

-- ------------------------------------------------------------
-- 3. MESES CERRADOS
-- ------------------------------------------------------------

create or replace function meses_cerrados()
returns setof date language sql stable security definer set search_path = public as $$
  select mes from cierres
   where organizacion_id = mi_org() and estado = 'aprobado'
     and mi_rol() is not null
   order by mes;
$$;

-- ------------------------------------------------------------
-- 4. COLOR DE MARCA
-- ------------------------------------------------------------

alter table marcas add column color text check (color ~ '^#[0-9a-fA-F]{6}$');

revoke all on function opero_trabajo(uuid), anotar_evento_pago(), anotar_evento_cotizacion(),
  anotar_evento_cancelacion(), meses_cerrados() from public, anon, authenticated;
grant execute on function opero_trabajo(uuid), meses_cerrados() to authenticated;
