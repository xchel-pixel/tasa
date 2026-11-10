-- ============================================================
-- 0078 — CRÉDITO: AVISOS AL NO APLICARSE Y MONTOS PARA NOTION
--
-- 1. "Pagar con mi crédito" ya no falla en silencio. Al aceptarse la
--    cotización, si el trabajo no admite crédito (convenio, sin costo,
--    estimado sin monto final, sin saldo) el comisionista recibe un aviso
--    dentro de Tasa ("No se pudo aplicar tu crédito a [folio] porque
--    [motivo]. Se cobrará normal; si tienes dudas, escríbenos.") y finanzas
--    una alerta. Con saldo insuficiente se aplica lo que hay y se avisa del
--    resto.
-- 2. Para Notion: cada aplicación guarda su "costo" (la bonificación
--    consumida, sin IVA: crédito aplicado sin IVA × (1 − precio ÷ crédito
--    de su lote)); la devolución lo regresa. El trámite queda pendiente de
--    escribir "Crédito Tasa" (lo pagado con crédito, con IVA si lleva
--    factura) y "Costo crédito". La app solo escribe si las dos propiedades
--    están en el mapeo del conector (credito_tasa y costo_credito): hasta
--    que se agreguen, no se escribe nada en Notion.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Aviso al comisionista y alerta para finanzas
-- ------------------------------------------------------------

create table avisos_comisionista (
  id              uuid primary key default gen_random_uuid(),
  organizacion_id uuid not null references organizaciones(id) on delete restrict,
  persona_id      uuid not null references personas(id) on delete cascade,
  solicitud_id    uuid references solicitudes(id) on delete cascade,
  texto           text not null check (char_length(texto) between 10 and 400),
  creado_en       timestamptz not null default now(),
  visto_en        timestamptz
);
create index on avisos_comisionista (organizacion_id, persona_id) where visto_en is null;
alter table avisos_comisionista enable row level security;
revoke all on avisos_comisionista from anon;
create policy leer_avisos_comisionista on avisos_comisionista for select
  using (organizacion_id = (select mi_org()) and ((select soy_staff()) or persona_id = (select mi_persona_id())));
grant select on avisos_comisionista to authenticated;

-- "Entendido" (o abrir el trabajo): el aviso deja de salir en su portada.
create or replace function marcar_aviso_comisionista(p_aviso uuid)
returns void language sql security definer set search_path = public as $$
  update avisos_comisionista set visto_en = now()
   where id = p_aviso and persona_id = mi_persona_id() and visto_en is null;
$$;
create or replace function marcar_avisos_del_trabajo(p_solicitud uuid)
returns void language sql security definer set search_path = public as $$
  update avisos_comisionista set visto_en = now()
   where solicitud_id = p_solicitud and persona_id = mi_persona_id() and visto_en is null;
$$;

alter table alertas drop constraint alertas_tipo_check;
alter table alertas drop constraint alertas_tipo_completo;
alter table alertas
  add constraint alertas_tipo_check check (tipo in ('cancelado_externo', 'externo_borrado', 'liga_inactiva', 'conector',
                                                    'estimado_sin_final', 'liga_limite', 'pago_por_entregar', 'externo_solicitado',
                                                    'perfil_por_aprobar', 'externo_comision', 'notion_sin_pagina', 'notion_pago',
                                                    'parametros_fiscales', 'cupo_agotado', 'catastro', 'credito_no_aplicado',
                                                    'externo_credito')),
  add constraint alertas_tipo_completo check (
    (tipo in ('cancelado_externo', 'externo_borrado', 'liga_inactiva', 'estimado_sin_final', 'pago_por_entregar',
              'externo_solicitado', 'externo_comision', 'credito_no_aplicado', 'externo_credito')
     and solicitud_id is not null)
    or (tipo = 'conector' and conector_id is not null and codigo is not null)
    or (tipo in ('liga_limite', 'perfil_por_aprobar', 'notion_sin_pagina', 'notion_pago', 'parametros_fiscales', 'cupo_agotado', 'catastro')
        and codigo is not null));

alter table eventos_trabajo drop constraint eventos_trabajo_accion_check;
alter table eventos_trabajo add constraint eventos_trabajo_accion_check check (accion in (
  'revertir_confirmacion', 'revertir_rechazo', 'retirar_pago', 'anular_cotizacion', 'cancelar',
  'asignar_comisionista', 'sin_comision', 'con_comision', 'importar', 'notion_solicitado',
  'notion_comision', 'notion_referido', 'notion_credito'));

create or replace function avisar_credito(s solicitudes, p_texto text, p_alerta text)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into avisos_comisionista (organizacion_id, persona_id, solicitud_id, texto)
  values (s.organizacion_id, s.comisionista_id, s.id, left(p_texto, 400));
  insert into alertas (organizacion_id, tipo, solicitud_id, mensaje)
  values (s.organizacion_id, 'credito_no_aplicado', s.id, p_alerta)
  on conflict (solicitud_id, tipo) where resuelta_en is null do update set mensaje = excluded.mensaje;
end;
$$;

create or replace function al_tramite_pagar_con_credito()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_ap      jsonb;
  v_max     numeric;
  v_saldo   numeric;
  v_motivo  text;
  v_aplic   numeric;
  v_trabajo text := coalesce(new.folio, 'tu trabajo de ' || new.cliente_nombre);
  v_quien   text := (select nombre from personas where id = new.comisionista_id);
  dinero    text;
begin
  v_ap := credito_aplicable(new.id);
  v_max := coalesce((v_ap->>'monto')::numeric, 0);
  v_saldo := saldo_credito(new.organizacion_id, new.comisionista_id);
  v_motivo := case
    when v_max <= 0 and v_ap->>'motivo' = 'Ya está cubierto' then null
    when v_max <= 0 and v_ap->>'motivo' = 'Trabajo con convenio' then 'el trabajo tiene un convenio con precio pactado'
    when v_max <= 0 and v_ap->>'motivo' = 'Trabajo sin costo' then 'es un trabajo sin costo'
    when v_max <= 0 and v_ap->>'motivo' = 'Falta el honorario final' then 'su honorario es estimado y todavía no tiene monto final'
    when v_max <= 0 then lower(coalesce(v_ap->>'motivo', 'el trabajo no admite crédito'))
    when v_saldo <= 0 then 'no tienes saldo vigente'
  end;
  if v_max <= 0 and v_motivo is null then
    return null;
  end if;
  if v_motivo is not null then
    perform avisar_credito(new, 'No se pudo aplicar tu crédito a ' || v_trabajo || ' porque ' || v_motivo
                                || '. Se cobrará normal; si tienes dudas, escríbenos.',
                           'No se aplicó el crédito de ' || coalesce(v_quien, 'el comisionista') || ' a ' || coalesce(new.folio, new.cliente_nombre)
                           || ' (pidió "Pagar con mi crédito"): ' || v_motivo || '. Se cobra normal.');
    return null;
  end if;
  begin
    v_aplic := ejecutar_aplicar_credito(new.id, null, new.comisionista_id);
  exception when others then
    perform avisar_credito(new, 'No se pudo aplicar tu crédito a ' || v_trabajo
                                || ' por un problema al aplicarlo. Se cobrará normal; si tienes dudas, escríbenos.',
                           'No se aplicó el crédito de ' || coalesce(v_quien, 'el comisionista') || ' a ' || coalesce(new.folio, new.cliente_nombre)
                           || ': ' || sqlerrm || '. Se cobra normal; puedes aplicarlo desde el trámite.');
    return null;
  end;
  if v_aplic < v_max then
    dinero := '$' || to_char(v_max - v_aplic, 'FM999,999,990.00');
    perform avisar_credito(new, 'Se aplicaron $' || to_char(v_aplic, 'FM999,999,990.00') || ' de tu crédito a ' || v_trabajo
                                || '; tu saldo no alcanzó para ' || dinero || ', que se cobrará normal. Si tienes dudas, escríbenos.',
                           'Crédito insuficiente de ' || coalesce(v_quien, 'el comisionista') || ' en ' || coalesce(new.folio, new.cliente_nombre)
                           || ': se aplicaron $' || to_char(v_aplic, 'FM999,999,990.00') || ' y faltan ' || dinero || ' por cobrar normal.');
  end if;
  return null;
end;
$$;

-- ------------------------------------------------------------
-- 2. Costo de la bonificación y lo que va a Notion
-- ------------------------------------------------------------

alter table movimientos_credito add column costo numeric(12,2) not null default 0;
alter table solicitudes add column externo_credito_pendiente boolean not null default false;

-- Lo que se pagó por un lote ÷ el crédito que dio (con su subida, si la hubo).
create or replace function razon_lote(p_compra uuid)
returns numeric language sql stable security definer set search_path = public as $$
  select case when c.credito > 0 then
           (c.precio + coalesce((select sum(x.precio) from compras_paquete x where x.original_id = c.id and x.estado = 'confirmada'), 0)) / c.credito
         else 1 end
    from compras_paquete c where c.id = p_compra;
$$;

-- Lo de crédito de un trabajo: lo pagado con crédito (con IVA si lleva factura) y el costo de la bonificación (sin IVA).
create or replace function credito_del_trabajo(p_solicitud uuid)
returns table (credito numeric, costo numeric)
language sql stable security definer set search_path = public as $$
  select coalesce(-sum(monto), 0), coalesce(sum(costo), 0)
    from movimientos_credito where solicitud_id = p_solicitud and tipo in ('aplicacion', 'devolucion');
$$;

-- El pendiente de finanzas se cierra solo cuando el trabajo queda pagado; o a mano (admin_org o finanzas), con nota.
create or replace function cerrar_alerta_credito(p_alerta uuid, p_nota text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if mi_rol() not in ('admin_org', 'finanzas') then
    raise exception 'Solo finanzas o administración';
  end if;
  update alertas set resuelta_en = now(), resuelta_por = mi_persona_id(), resolucion = coalesce(nullif(trim(p_nota), ''), 'Revisado')
   where id = p_alerta and organizacion_id = mi_org() and tipo = 'credito_no_aplicado' and resuelta_en is null;
end;
$$;
create or replace function cerrar_alerta_credito_al_pagar()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update alertas set resuelta_en = now(), resolucion = 'El trabajo quedó pagado'
   where solicitud_id = new.id and tipo = 'credito_no_aplicado' and resuelta_en is null;
  return null;
end;
$$;
create trigger cerrar_alerta_credito after update of pagado_en on solicitudes
  for each row when (new.pagado_en is not null and old.pagado_en is null) execute function cerrar_alerta_credito_al_pagar();
revoke all on function cerrar_alerta_credito(uuid, text), cerrar_alerta_credito_al_pagar() from public, anon, authenticated;
grant execute on function cerrar_alerta_credito(uuid, text) to authenticated;

-- 0077 + el costo de la bonificación en cada aplicación.
create or replace function ejecutar_aplicar_credito(p_solicitud uuid, p_monto numeric, p_quien uuid)
returns numeric language plpgsql security definer set search_path = public as $$
declare
  s        solicitudes;
  v_ap     jsonb := credito_aplicable(p_solicitud);
  v_monto  numeric;
  v_factor numeric;
  v_resta  numeric;
  v_toma   numeric;
  v_pago   uuid;
  l        record;
begin
  select * into s from solicitudes where id = p_solicitud for update;
  v_monto := least((v_ap->>'monto')::numeric, saldo_credito(s.organizacion_id, s.comisionista_id), coalesce(p_monto, 1e12));
  if coalesce(v_monto, 0) <= 0 then
    raise exception 'No se puede aplicar crédito: %', coalesce(v_ap->>'motivo', 'sin saldo vigente');
  end if;
  v_monto := round(v_monto, 2);
  v_factor := case when s.requiere_factura then 1.16 else 1 end;
  -- Primero la parte con crédito (la comisión que se devengue al liquidarse ya la descuenta), luego el pago.
  update solicitudes set credito_honorarios = least(monto_honorarios, credito_honorarios + round(v_monto / v_factor, 2)) where id = s.id;
  insert into pagos (solicitud_id, via, monto, fecha_pago, referencia, nota, reportado_por)
  values (s.id, 'credito', v_monto, hoy_mx(), 'Crédito Tasa', 'Pagado con crédito del paquete', p_quien)
  returning id into v_pago;
  v_resta := v_monto;
  for l in select x.id, saldo_lote(x.id) as saldo from lotes_vigentes(s.organizacion_id, s.comisionista_id) x loop
    exit when v_resta <= 0;
    continue when l.saldo <= 0;
    v_toma := least(l.saldo, v_resta);
    insert into movimientos_credito (organizacion_id, persona_id, compra_id, tipo, monto, solicitud_id, pago_id, nota, creado_por, costo)
    values (s.organizacion_id, s.comisionista_id, l.id, 'aplicacion', -v_toma, s.id, v_pago,
            'Trabajo ' || coalesce(s.folio, s.cliente_nombre), p_quien,
            round(v_toma / v_factor * (1 - razon_lote(l.id)), 2));
    v_resta := v_resta - v_toma;
  end loop;
  update pagos set estado = 'confirmado' where id = v_pago;
  return v_monto;
end;
$$;

-- 0077 + la devolución regresa también el costo.
create or replace function devolver_credito(p_solicitud uuid, p_pago uuid, p_nota text)
returns numeric language plpgsql security definer set search_path = public as $$
declare
  m       record;
  v_total numeric := 0;
  v_fac   numeric;
begin
  for m in select * from movimientos_credito x
            where x.tipo = 'aplicacion' and (x.solicitud_id = p_solicitud or x.pago_id = p_pago)
              and not exists (select 1 from movimientos_credito d where d.devuelve_id = x.id) loop
    insert into movimientos_credito (organizacion_id, persona_id, compra_id, tipo, monto, solicitud_id, pago_id, devuelve_id, nota, creado_por, costo)
    values (m.organizacion_id, m.persona_id, m.compra_id, 'devolucion', -m.monto, m.solicitud_id, m.pago_id, m.id, p_nota, mi_persona_id(), -m.costo);
    v_total := v_total - m.monto;
  end loop;
  if v_total > 0 and p_pago is not null then
    select case when requiere_factura then 1.16 else 1 end into v_fac from solicitudes s join pagos g on g.solicitud_id = s.id where g.id = p_pago;
    update solicitudes s set credito_honorarios = greatest(0, s.credito_honorarios - round(v_total / v_fac, 2))
      from pagos g where g.id = p_pago and s.id = g.solicitud_id;
  end if;
  return v_total;
end;
$$;

-- Lo ya aplicado (DEMO): su costo.
update movimientos_credito m set costo = round(-m.monto / case when s.requiere_factura then 1.16 else 1 end * (1 - razon_lote(m.compra_id)), 2)
  from solicitudes s where s.id = m.solicitud_id and m.tipo = 'aplicacion';
update movimientos_credito d set costo = -m.costo from movimientos_credito m where d.devuelve_id = m.id;

-- Aplicar o devolver crédito deja el trámite pendiente de escribir en Notion (si hay conector de Notion).
create or replace function marcar_credito_pendiente()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.solicitud_id is not null and hay_conector_notion(new.organizacion_id) then
    update solicitudes set externo_credito_pendiente = true where id = new.solicitud_id and externo_id is not null;
  end if;
  return null;
end;
$$;
create trigger credito_a_notion after insert on movimientos_credito
  for each row when (new.tipo in ('aplicacion', 'devolucion')) execute function marcar_credito_pendiente();

-- Lo que el sync escribe: "Crédito Tasa" y "Costo crédito" del trámite (como Ext Comisión, 0052).
create or replace function por_actualizar_credito_afuera(p_conector uuid)
returns table (solicitud_id uuid, externo_id text, credito numeric, costo numeric)
language sql stable security definer set search_path = public as $$
  select s.id, s.externo_id, c.credito, c.costo
    from solicitudes s
    join conectores k on k.id = p_conector and k.organizacion_id = s.organizacion_id,
    lateral credito_del_trabajo(s.id) c
   where puede_operar_conector(p_conector)
     and s.externo_credito_pendiente and s.externo_id is not null and s.externo_baja_en is null;
$$;

create or replace function registrar_credito_afuera(p_conector uuid, p_solicitud uuid, p_credito numeric, p_costo numeric, p_error text)
returns void language plpgsql security definer set search_path = public as $$
declare
  s solicitudes%rowtype;
begin
  if not puede_operar_conector(p_conector) then
    raise exception 'Solo admin_org sincroniza el conector';
  end if;
  select x.* into s from solicitudes x join conectores k on k.id = p_conector and k.organizacion_id = x.organizacion_id
   where x.id = p_solicitud for update;
  if not found then
    return;
  end if;
  perform set_config('tasa.motivo', case when p_error is null then 'Notion: Crédito Tasa → ' || p_credito || ', Costo crédito → ' || p_costo
                                         else 'Notion no aceptó "Crédito Tasa": ' || p_error end, true);
  update solicitudes set externo_credito_pendiente = false where id = s.id;
  if p_error is null then
    insert into eventos_trabajo (organizacion_id, solicitud_id, accion, detalle)
    values (s.organizacion_id, s.id, 'notion_credito', 'En Notion, "Crédito Tasa": $' || to_char(p_credito, 'FM999,999,990.00')
            || ' y "Costo crédito": $' || to_char(p_costo, 'FM999,999,990.00'));
  else
    insert into alertas (organizacion_id, tipo, solicitud_id, mensaje)
    values (s.organizacion_id, 'externo_credito', s.id,
            'No se pudo escribir el crédito en Notion (' || p_error || '): ' || coalesce(s.folio, 'sin folio') || ' · '
            || s.cliente_nombre || '. En Tasa no cambia nada; corrígelo a mano en Notion.')
    on conflict (solicitud_id, tipo) where resuelta_en is null do update set mensaje = excluded.mensaje;
  end if;
  perform set_config('tasa.motivo', '', true);
end;
$$;

revoke all on function marcar_aviso_comisionista(uuid), marcar_avisos_del_trabajo(uuid), avisar_credito(solicitudes, text, text),
  razon_lote(uuid), credito_del_trabajo(uuid), marcar_credito_pendiente(), por_actualizar_credito_afuera(uuid),
  registrar_credito_afuera(uuid, uuid, numeric, numeric, text) from public, anon, authenticated;
grant execute on function marcar_aviso_comisionista(uuid), marcar_avisos_del_trabajo(uuid), por_actualizar_credito_afuera(uuid),
  registrar_credito_afuera(uuid, uuid, numeric, numeric, text) to authenticated;
grant execute on function por_actualizar_credito_afuera(uuid), registrar_credito_afuera(uuid, uuid, numeric, numeric, text) to service_role;
