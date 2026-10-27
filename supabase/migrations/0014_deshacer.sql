-- ============================================================
-- 0014 — DESHACER Y ANULAR
--
-- Nada que toque dinero se borra: cambia de estado o se compensa con
-- un movimiento contrario. Toda acción lleva motivo, y el motivo queda
-- en la bitácora junto al antes y el después.
--
--   Comisionista
--     · retirar un pago suyo que siga "reportado";
--     · cancelar su solicitud mientras esté "solicitada".
--   Staff, solo con el mes del movimiento ABIERTO
--     · revertir la confirmación de un pago (vuelve a "reportado"; si ya
--       había devengado comisión, la comisión se quita y el trabajo
--       deja de estar pagado);
--     · revertir el rechazo de un pago (vuelve a "reportado");
--     · anular una cotización emitida y no aceptada (la solicitud vuelve
--       a "por cotizar");
--     · anular un pago de comisión (el pendiente recupera su saldo).
--   super_admin, con el mes abierto
--     · anular un bono, ajuste o cargo manual (entra el contrario).
--
-- Con el mes cerrado no se deshace nada: se corrige con un ajuste en
-- el mes abierto.
-- ============================================================

-- ------------------------------------------------------------
-- 1. EL MOTIVO EN LA BITÁCORA
-- ------------------------------------------------------------
-- Cada función de deshacer pone el motivo en `tasa.motivo` (solo dura
-- la transacción) y el disparador de la bitácora lo copia.

alter table bitacora add column motivo text;

create or replace function registrar_bitacora()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_antes   jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  v_despues jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  v_fila    jsonb := coalesce(v_despues, v_antes);
begin
  if tg_op = 'UPDATE' and v_antes = v_despues then
    return null;
  end if;

  insert into bitacora (persona_id, rol, accion, tabla, registro_id, antes, despues, motivo)
  values (
    mi_persona_id(),
    mi_rol(),
    tg_op,
    tg_table_name,
    coalesce(v_fila->>'id', v_fila->>'persona_id', v_fila->>'etapa_notion'),
    v_antes,
    v_despues,
    nullif(current_setting('tasa.motivo', true), '')
  );
  return null;
end;
$$;

-- Exige motivo y lo deja listo para la bitácora.
create or replace function poner_motivo(p_motivo text)
returns void language plpgsql set search_path = public as $$
begin
  if nullif(trim(p_motivo), '') is null then
    raise exception 'Escribe el motivo';
  end if;
  perform set_config('tasa.motivo', trim(p_motivo), true);
end;
$$;

create or replace function mes_cerrado_para(p_mes date)
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if mes_aprobado(p_mes) then
    raise exception 'Mes cerrado: corrige con un ajuste en el mes abierto';
  end if;
end;
$$;

-- ------------------------------------------------------------
-- 2. PAGOS DEL CLIENTE: RETIRAR Y REVERTIR
-- ------------------------------------------------------------

alter table pagos drop constraint pagos_estado_check;
alter table pagos
  add constraint pagos_estado_check check (estado in ('reportado', 'confirmado', 'rechazado', 'retirado')),
  add column motivo_retiro text,
  add constraint pagos_retiro_con_motivo
    check (estado <> 'retirado' or nullif(trim(motivo_retiro), '') is not null);

-- Igual que en 0004, más dos caminos:
--   · reportado → retirado (lo retira quien lo reportó);
--   · confirmado/rechazado → reportado, SOLO desde `revertir_pago`
--     (marca `tasa.revertir`, que nadie más puede poner).
create or replace function reglas_pago()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  s            solicitudes%rowtype;
  v_confirmado numeric;
  v_libres     text[] := array['estado', 'motivo_rechazo', 'motivo_retiro', 'revisado_por', 'revisado_en'];
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

  if (to_jsonb(new) - v_libres) is distinct from (to_jsonb(old) - v_libres) then
    raise exception 'Un pago reportado no se edita: recházalo con motivo y que se reporte de nuevo';
  end if;

  if new.estado is distinct from old.estado then
    if old.estado in ('confirmado', 'rechazado') and new.estado = 'reportado'
       and current_setting('tasa.revertir', true) = 'on' then
      new.revisado_en := null;
      new.revisado_por := null;
      new.motivo_rechazo := null;
      return new;
    end if;
    if old.estado <> 'reportado' then
      raise exception 'Un pago % ya no cambia de estado', old.estado;
    end if;
    if new.estado = 'retirado' then
      return new;
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

create or replace function retirar_pago(p_pago uuid, p_motivo text)
returns void language plpgsql security definer set search_path = public as $$
declare
  p pagos%rowtype;
begin
  select * into p from pagos where id = p_pago for update;
  if not found or p.reportado_por is distinct from mi_persona_id() then
    raise exception 'Ese pago no lo reportaste tú';
  end if;
  if p.estado <> 'reportado' then
    raise exception 'El pago ya está %: pídele a Administración que lo revise', p.estado;
  end if;
  perform poner_motivo(p_motivo);
  update pagos set estado = 'retirado', motivo_retiro = trim(p_motivo) where id = p_pago;
  perform set_config('tasa.motivo', '', true);
end;
$$;

-- Confirmado o rechazado → reportado. Si su confirmación había dejado
-- el trabajo pagado, el trabajo deja de estarlo y su comisión se quita
-- (está en un mes abierto: si no, no se llega aquí).
create or replace function revertir_pago(p_pago uuid, p_motivo text)
returns void language plpgsql security definer set search_path = public as $$
declare
  p          pagos%rowtype;
  s          solicitudes%rowtype;
  v_anterior text;
begin
  if not soy_staff() then
    raise exception 'Solo finanzas o super_admin revierten pagos';
  end if;
  select * into p from pagos where id = p_pago for update;
  if not found then
    raise exception 'No existe ese pago';
  end if;
  if p.estado not in ('confirmado', 'rechazado') then
    raise exception 'Solo se revierte un pago confirmado o rechazado (este está %)', p.estado;
  end if;
  perform mes_cerrado_para(p.fecha_pago);
  perform poner_motivo(p_motivo);

  if p.estado = 'confirmado' then
    select * into s from solicitudes where id = p.solicitud_id for update;
    if s.pagado_en is not null then
      if exists (select 1 from comisiones
                  where solicitud_id = s.id and tipo = 'comision' and mes_aprobado(mes)) then
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

-- ------------------------------------------------------------
-- 3. SOLICITUDES Y COTIZACIONES
-- ------------------------------------------------------------

create or replace function cancelar_mi_solicitud(p_solicitud uuid, p_motivo text)
returns void language plpgsql security definer set search_path = public as $$
declare
  s solicitudes%rowtype;
begin
  select * into s from solicitudes where id = p_solicitud for update;
  if not found or s.comisionista_id is distinct from mi_persona_id() then
    raise exception 'Esa solicitud no es tuya';
  end if;
  if s.estado <> 'solicitada' then
    raise exception 'Ya se cotizó: pídele a Administración que la cancele';
  end if;
  perform poner_motivo(p_motivo);
  update solicitudes
     set estado = 'cancelada', estatus_publico = 'cancelada',
         cancelada_en = now(), motivo_cancelacion = trim(p_motivo)
   where id = s.id;
  perform set_config('tasa.motivo', '', true);
end;
$$;

alter table cotizaciones drop constraint cotizaciones_estado_check;
alter table cotizaciones
  add constraint cotizaciones_estado_check
    check (estado in ('emitida', 'aceptada', 'vencida', 'reemplazada', 'anulada')),
  add column motivo_anulacion text;

create or replace function anular_cotizacion(p_cotizacion uuid, p_motivo text)
returns void language plpgsql security definer set search_path = public as $$
declare
  c cotizaciones%rowtype;
begin
  if not soy_staff() then
    raise exception 'Solo finanzas o super_admin anulan cotizaciones';
  end if;
  select * into c from cotizaciones where id = p_cotizacion for update;
  if not found or c.estado <> 'emitida' then
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
-- 4. PAGOS DE COMISIÓN
-- ------------------------------------------------------------
-- El mes del movimiento es el de la fecha del pago.

alter table pagos_comision
  add column estado text not null default 'registrado' check (estado in ('registrado', 'anulado')),
  add column motivo_anulacion text,
  add column anulado_por uuid references personas(id) on delete set null,
  add column anulado_en timestamptz,
  add constraint pagos_comision_anulado_con_motivo
    check (estado <> 'anulado' or nullif(trim(motivo_anulacion), '') is not null);

create or replace function anular_pago_comision(p_pago uuid, p_motivo text)
returns void language plpgsql security definer set search_path = public as $$
declare
  p  pagos_comision%rowtype;
  a  record;
begin
  if not soy_staff() then
    raise exception 'Solo finanzas o super_admin anulan pagos de comisión';
  end if;
  select * into p from pagos_comision where id = p_pago for update;
  if not found or p.estado <> 'registrado' then
    raise exception 'Ese pago ya estaba anulado';
  end if;
  perform mes_cerrado_para(p.fecha);
  perform poner_motivo(p_motivo);

  for a in
    select ap.monto, pc.id as pendiente_id, pc.comisionista_id, pc.mes
      from aplicaciones_pago_comision ap
      join pendientes_comision pc on pc.id = ap.pendiente_id
     where ap.pago_id = p.id
  loop
    update pendientes_comision
       set pagado = pagado - a.monto, pagado_en = null
     where id = a.pendiente_id;
    update comisiones set estado = 'devengada', pagada_en = null
     where comisionista_id = a.comisionista_id and mes = a.mes and estado = 'pagada';
  end loop;

  update pagos_comision
     set estado = 'anulado', motivo_anulacion = trim(p_motivo),
         anulado_por = mi_persona_id(), anulado_en = now()
   where id = p.id;
  perform set_config('tasa.motivo', '', true);
end;
$$;

-- Lo que el comisionista ve: los pagos anulados ya no.
create or replace function mis_pagos_comision()
returns table (pendiente_id uuid, fecha date, referencia text, monto numeric)
language sql stable security definer set search_path = public as $$
  select a.pendiente_id, p.fecha, p.referencia, a.monto
    from aplicaciones_pago_comision a
    join pagos_comision p on p.id = a.pago_id
   where p.comisionista_id = mi_persona_id()
     and p.estado = 'registrado'
   order by p.fecha, p.registrado_en;
$$;

-- ------------------------------------------------------------
-- 5. BONOS, AJUSTES Y CARGOS MANUALES
-- ------------------------------------------------------------
-- No se borran: entra un ajuste por el contrario, amarrado al original
-- (`anula_id`). Los dos quedan a la vista y suman cero.

alter table comisiones add column anula_id uuid references comisiones(id) on delete restrict;
create unique index comisiones_una_anulacion on comisiones (anula_id) where anula_id is not null;

create or replace function anular_movimiento(p_comision uuid, p_motivo text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  c     comisiones%rowtype;
  v_id  uuid;
begin
  if not soy_super_admin() then
    raise exception 'Solo super_admin anula bonos, ajustes o cargos';
  end if;
  select * into c from comisiones where id = p_comision for update;
  if not found or c.tipo not in ('bono', 'ajuste', 'cargo') or c.solicitud_id is not null or c.anula_id is not null then
    raise exception 'Solo se anula un bono, ajuste o cargo hecho a mano';
  end if;
  if exists (select 1 from comisiones where anula_id = c.id) then
    raise exception 'Ese movimiento ya estaba anulado';
  end if;
  perform mes_cerrado_para(c.mes);
  perform poner_motivo(p_motivo);

  insert into comisiones (comisionista_id, tipo, monto, mes, cuenta_receptora_id, servicio_id, nota, creada_por, anula_id)
  values (c.comisionista_id, 'ajuste', -c.monto, c.mes, c.cuenta_receptora_id, c.servicio_id,
          'Anulación: ' || trim(p_motivo), mi_persona_id(), c.id)
  returning id into v_id;
  perform set_config('tasa.motivo', '', true);
  return v_id;
end;
$$;

-- ------------------------------------------------------------
-- 6. PERMISOS
-- ------------------------------------------------------------

revoke all on function
  poner_motivo(text), mes_cerrado_para(date),
  retirar_pago(uuid, text), revertir_pago(uuid, text), cancelar_mi_solicitud(uuid, text),
  anular_cotizacion(uuid, text), anular_pago_comision(uuid, text), anular_movimiento(uuid, text)
  from public, anon, authenticated;

grant execute on function
  retirar_pago(uuid, text), revertir_pago(uuid, text), cancelar_mi_solicitud(uuid, text),
  anular_cotizacion(uuid, text), anular_pago_comision(uuid, text), anular_movimiento(uuid, text),
  mes_aprobado(date)
  to authenticated;
