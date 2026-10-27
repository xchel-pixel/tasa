-- ============================================================
-- 0004 — PAGOS Y DEVENGO
--
-- Tres vías, todas entran como "reportado":
--   · comprobante: el comisionista sube PDF o imagen;
--   · directo: finanzas registra un pago del cliente con referencia;
--   · aviso: el comisionista avisa (monto, fecha, nota), sin archivo.
-- Después: reportado → confirmado | rechazado. No hay más caminos.
--
-- Cuando lo confirmado alcanza el total, el trabajo queda pagado y la
-- comisión se devenga en la misma transacción que la confirmación.
-- ============================================================

create table pagos (
  id                uuid primary key default gen_random_uuid(),
  solicitud_id      uuid not null references solicitudes(id) on delete restrict,
  via               text not null check (via in ('comprobante', 'directo', 'aviso')),
  monto             numeric(12,2) not null check (monto > 0),
  -- Cuándo entró el dinero, según quien reporta. Define el mes.
  fecha_pago        date not null,
  referencia        text,
  nota              text,
  -- Ruta dentro del bucket privado `comprobantes`, nunca una URL.
  comprobante_ruta  text,
  estado            text not null default 'reportado'
                      check (estado in ('reportado', 'confirmado', 'rechazado')),
  motivo_rechazo    text,
  reportado_por     uuid references personas(id) on delete set null,
  reportado_en      timestamptz not null default now(),
  revisado_por      uuid references personas(id) on delete set null,
  revisado_en       timestamptz,

  check (via <> 'comprobante' or comprobante_ruta is not null),
  check (via <> 'directo' or referencia is not null),
  constraint pagos_rechazo_con_motivo
    check (estado <> 'rechazado' or nullif(trim(motivo_rechazo), '') is not null)
);

create index on pagos (solicitud_id);
create index pagos_por_revisar on pagos (reportado_en) where estado = 'reportado';

-- ------------------------------------------------------------
-- 1. REGLAS DEL PAGO
-- ------------------------------------------------------------

create or replace function reglas_pago()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  s            solicitudes%rowtype;
  v_confirmado numeric;
begin
  if tg_op = 'INSERT' then
    if new.estado <> 'reportado' then
      raise exception 'Todo pago entra como reportado';
    end if;
    select * into s from solicitudes where id = new.solicitud_id;
    if s.estado <> 'tramite' then
      raise exception 'Solo se registran pagos de trámites (este está en "%")', s.estado;
    end if;
    if s.pagado_en is not null then
      raise exception 'Este trabajo ya está pagado al 100%%';
    end if;
    new.reportado_en := now();
    return new;
  end if;

  -- UPDATE: los datos del pago no se reescriben; solo se revisa.
  if (to_jsonb(new) - array['estado', 'motivo_rechazo', 'revisado_por', 'revisado_en'])
     is distinct from (to_jsonb(old) - array['estado', 'motivo_rechazo', 'revisado_por', 'revisado_en']) then
    raise exception 'Un pago reportado no se edita: recházalo con motivo y que se reporte de nuevo';
  end if;

  if new.estado is distinct from old.estado then
    if old.estado <> 'reportado' then
      raise exception 'Un pago % ya no cambia de estado', old.estado;
    end if;
    new.revisado_en := now();
    new.revisado_por := coalesce(mi_persona_id(), new.revisado_por);

    if new.estado = 'confirmado' then
      select * into s from solicitudes where id = new.solicitud_id for update;
      select coalesce(sum(monto), 0) into v_confirmado
        from pagos where solicitud_id = new.solicitud_id and estado = 'confirmado';
      if v_confirmado + new.monto > s.monto_total then
        raise exception 'Con este pago lo confirmado (%) pasaría del total del trabajo (%)',
          v_confirmado + new.monto, s.monto_total;
      end if;
    end if;
  end if;

  return new;
end;
$$;

create trigger al_guardar_pago
  before insert or update on pagos
  for each row execute function reglas_pago();

-- ------------------------------------------------------------
-- 2. DEVENGO
-- ------------------------------------------------------------
-- Recorre los pagos confirmados por fecha de pago. El que hace que la
-- suma alcance el total es "el pago que completa el 100%": su fecha es
-- `pagado_en`, y su mes (o el siguiente abierto) es `mes_cierre`.
--
-- Se ordena por fecha de pago y no por orden de confirmación: si el
-- anticipo del 28 se confirma después del finiquito del 3, el trabajo
-- quedó pagado el 3, que es cuando de verdad se juntó el dinero.

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

  v_mes := mes_abierto_desde(v_fecha);

  update solicitudes
     set pagado_en = v_fecha, mes_cierre = v_mes, estatus_publico = 'pagado'
   where id = p_solicitud;

  if coalesce(s.monto_honorarios, 0) > 0 then
    v_pct := porcentaje_vigente(s.comisionista_id, v_mes);
    insert into comisiones (comisionista_id, solicitud_id, tipo, base, porcentaje, provisional, monto, mes, nota)
    values (s.comisionista_id, s.id, 'comision', s.monto_honorarios, v_pct,
            porcentaje_es_provisional(s.comisionista_id, v_mes),
            round(s.monto_honorarios * v_pct / 100, 2), v_mes,
            'Devengada al quedar pagado el trabajo');
  end if;
end;
$$;

create or replace function al_confirmar_pago()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.estado = 'confirmado' and old.estado is distinct from 'confirmado' then
    perform liquidar_si_completo(new.solicitud_id);
  end if;
  return null;
end;
$$;

create trigger al_mover_pago
  after update of estado on pagos
  for each row execute function al_confirmar_pago();

create trigger bitacora after insert or update or delete on pagos
  for each row execute function registrar_bitacora();

revoke all on function liquidar_si_completo(uuid) from public, anon, authenticated;

-- ------------------------------------------------------------
-- 3. CANCELAR UN TRABAJO
-- ------------------------------------------------------------
-- Si su comisión está en un mes abierto, se borra. Si ya está en un
-- cierre aprobado, no se toca: entra un cargo por el mismo monto en el
-- primer mes abierto. Así el cierre aprobado sigue diciendo la verdad
-- de lo que se sabía cuando se aprobó.

create or replace function cancelar_trabajo(p_solicitud uuid, p_motivo text)
returns void language plpgsql security definer set search_path = public as $$
declare
  s  solicitudes%rowtype;
  c  record;
begin
  if not soy_super_admin() and auth.uid() is not null then
    raise exception 'Solo super_admin cancela trabajos';
  end if;
  if nullif(trim(p_motivo), '') is null then
    raise exception 'Hace falta el motivo de la cancelación';
  end if;

  select * into s from solicitudes where id = p_solicitud for update;
  if s.estado = 'cancelada' then
    raise exception 'Ese trabajo ya estaba cancelado';
  end if;

  for c in
    select * from comisiones
     where solicitud_id = p_solicitud and tipo <> 'cargo'
  loop
    if mes_aprobado(c.mes) then
      insert into comisiones (comisionista_id, solicitud_id, tipo, monto, mes, nota, creada_por)
      values (c.comisionista_id, p_solicitud, 'cargo', -c.monto, mes_abierto_desde(hoy_mx()),
              'Cancelación posterior al cierre de ' || to_char(c.mes, 'YYYY-MM') || ': ' || p_motivo,
              mi_persona_id());
    else
      delete from comisiones where id = c.id;
    end if;
  end loop;

  update cotizaciones set estado = 'vencida', respondida_en = now()
   where solicitud_id = p_solicitud and estado = 'emitida';

  update solicitudes
     set estado = 'cancelada',
         estatus_publico = 'cancelada',
         cancelada_en = now(),
         motivo_cancelacion = p_motivo
   where id = p_solicitud;
end;
$$;

revoke all on function cancelar_trabajo(uuid, text) from public, anon;
grant execute on function cancelar_trabajo(uuid, text) to authenticated;

-- ------------------------------------------------------------
-- 4. RLS
-- ------------------------------------------------------------

alter table pagos enable row level security;
revoke all on pagos from anon;

create policy leer_pagos on pagos for select
  using (
    soy_staff()
    or solicitud_id in (select id from solicitudes where comisionista_id = mi_persona_id())
  );

-- El comisionista reporta con comprobante o con aviso, sobre un trámite suyo.
create policy reportar_pago on pagos for insert
  with check (
    mi_rol() = 'comisionista'
    and via in ('comprobante', 'aviso')
    and estado = 'reportado'
    and reportado_por = mi_persona_id()
    and solicitud_id in (
      select id from solicitudes
       where comisionista_id = mi_persona_id() and estado = 'tramite'
    )
  );

-- El staff registra cualquier vía (finanzas, los pagos directos).
create policy staff_registra_pago on pagos for insert
  with check (soy_staff() and estado = 'reportado' and reportado_por = mi_persona_id());

-- Confirmar o rechazar: el staff. El disparador impide todo lo demás.
create policy staff_revisa_pago on pagos for update
  using (soy_staff()) with check (soy_staff());

-- Nadie borra pagos: son el respaldo de lo que se cobró.
