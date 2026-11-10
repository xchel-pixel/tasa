-- ============================================================
-- 0079 — COMISIÓN DESCONTADA AL CLIENTE O COBRADA DIRECTAMENTE
--
-- Dos acciones en el detalle del trámite (admin_org y finanzas; quedan
-- en la bitácora), solo en trámites sin pagar y sin crédito aplicado:
--
-- A) "Pago con comisión descontada": el cliente paga el total menos la
--    comisión. Los honorarios bajan a honorarios − comisión (el IVA, si
--    lleva factura, se recalcula sobre el nuevo honorario). No se devenga
--    comisión ni bono por referido; el nivel cuenta el honorario neto. En
--    el estado de cuenta sale en $0: "Comisión descontada al cliente".
--    Notion: Honorario, Ext Comisión = 0 y Ref Bono = 0.
-- B) "El comisionista ya tomó su comisión": el total no cambia. Entra un
--    pago "comision" por el monto de la comisión (lo que retuvo el
--    comisionista); con el neto entregado el trabajo queda pagado. La
--    comisión se devenga normal pero nace pagada (cobrada_directo): no
--    entra al pendiente del cierre ni a su total. El bono por referido y
--    el nivel, normales (sobre el total).
--
-- La tasa es la vigente del trámite (convenio con % fijo, Élite,
-- bienvenida… vía porcentaje_vigente) y queda congelada. Las dos se
-- revierten mientras su mes no esté en un cierre aprobado. Un trámite
-- con crédito no admite A ni B, ni uno con A o B admite crédito.
-- ============================================================

alter table solicitudes
  add column modalidad_comision          text check (modalidad_comision in ('descontada', 'tomada')),
  add column modalidad_pct               numeric(5,2),
  add column modalidad_monto             numeric(12,2),
  add column honorario_original          numeric(12,2),
  add column modalidad_regla_antes       text,
  add column modalidad_pct_antes         numeric(5,2),
  add column externo_honorario_pendiente boolean not null default false;

alter table comisiones add column cobrada_directo boolean not null default false;

alter table pagos drop constraint pagos_via_check;
alter table pagos add constraint pagos_via_check check (via in ('comprobante', 'directo', 'aviso', 'efectivo', 'credito', 'comision'));

-- La cuenta antes de confirmar: tasa, comisión, honorario nuevo y si se puede.
create or replace function vista_modalidad_comision(p_solicitud uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  s        solicitudes;
  v_pct    numeric;
  v_com    numeric;
  v_conf   numeric;
  v_motivo text;
  v_mes    date;
begin
  select * into s from solicitudes where id = p_solicitud and organizacion_id = mi_org();
  if s.id is null then
    return jsonb_build_object('motivo', 'No existe');
  end if;
  v_mes := mes_abierto_desde(s.organizacion_id, hoy_mx());
  v_pct := case when s.comision_regla = 'fija' then s.comision_pct
                when s.comision_regla = 'ninguna' then 0
                when s.comisionista_id is not null then porcentaje_vigente(s.organizacion_id, s.comisionista_id, v_mes) end;
  v_com := round(coalesce(s.monto_honorarios, 0) * coalesce(v_pct, 0) / 100, 2);
  select coalesce(sum(monto), 0) into v_conf from pagos where solicitud_id = s.id and estado = 'confirmado';
  v_motivo := case
    when s.modalidad_comision is not null then null
    when s.estado <> 'tramite' then 'Solo trámites'
    when s.pagado_en is not null then 'El trabajo ya está pagado'
    when s.comisionista_id is null then 'No tiene comisionista'
    when s.comision_regla = 'ninguna' then 'Este trabajo no genera comisión'
    when s.honorario_tipo = 'sin_costo' or coalesce(s.monto_honorarios, 0) <= 0 then 'Trabajo sin costo'
    when s.honorario_tipo = 'estimado' and s.honorario_final_en is null then 'Falta fijar el honorario final'
    when s.credito_honorarios > 0 or exists (select 1 from movimientos_credito m where m.solicitud_id = s.id) then 'Tiene crédito aplicado'
    when v_com <= 0 then 'La comisión sale en cero'
  end;
  return jsonb_build_object(
    'modalidad', s.modalidad_comision, 'motivo', v_motivo,
    'pct', coalesce(s.modalidad_pct, v_pct), 'comision', coalesce(s.modalidad_monto, v_com),
    'honorario', coalesce(s.honorario_original, s.monto_honorarios), 'requiere_factura', s.requiere_factura,
    'honorario_neto', coalesce(s.honorario_original, s.monto_honorarios) - coalesce(s.modalidad_monto, v_com),
    'total', s.monto_total, 'confirmado', v_conf,
    'regla', case when s.comision_regla = 'fija' then 'convenio' else 'nivel' end,
    'mes_aprobado', s.mes_cierre is not null and mes_aprobado(s.organizacion_id, s.mes_cierre));
end;
$$;

create or replace function aplicar_modalidad_comision(p_solicitud uuid, p_modalidad text, p_motivo text)
returns void language plpgsql security definer set search_path = public as $$
declare
  s       solicitudes;
  v       jsonb;
  v_pct   numeric;
  v_com   numeric;
  v_pago  uuid;
  v_conf  numeric;
  v_neto  numeric;
begin
  if mi_rol() not in ('admin_org', 'finanzas') then
    raise exception 'Solo finanzas o administración';
  end if;
  if p_modalidad not in ('descontada', 'tomada') then
    raise exception 'Modalidad no válida';
  end if;
  v := vista_modalidad_comision(p_solicitud);
  if v->>'modalidad' is not null then
    raise exception 'Este trámite ya tiene la comisión %', case v->>'modalidad' when 'descontada' then 'descontada' else 'cobrada directamente' end;
  end if;
  if v->>'motivo' is not null then
    raise exception 'No se puede: %', v->>'motivo';
  end if;
  select * into s from solicitudes where id = p_solicitud for update;
  v_pct := (v->>'pct')::numeric;
  v_com := (v->>'comision')::numeric;
  select coalesce(sum(monto), 0) into v_conf from pagos where solicitud_id = s.id and estado = 'confirmado';
  perform set_config('tasa.motivo', case p_modalidad when 'descontada' then 'Comisión descontada al cliente' else 'Comisión cobrada directamente' end
                                    || coalesce(': ' || nullif(trim(p_motivo), ''), ''), true);

  if p_modalidad = 'descontada' then
    v_neto := s.monto_honorarios - v_com;
    if v_conf > round(v_neto * case when s.requiere_factura then 1.16 else 1 end, 2) + s.monto_terceros then
      raise exception 'Ya hay más pagado (%) que el total con la comisión descontada', v_conf;
    end if;
    update solicitudes
       set honorario_original = monto_honorarios, monto_honorarios = v_neto, modalidad_comision = 'descontada',
           modalidad_pct = v_pct, modalidad_monto = v_com,
           externo_honorario_pendiente = externo_id is not null and hay_conector_notion(organizacion_id),
           externo_comision_pendiente = externo_id is not null and hay_conector_notion(organizacion_id),
           externo_ref_pendiente = externo_id is not null and hay_conector_notion(organizacion_id)
     where id = s.id;
    perform liquidar_si_completo(s.id);
  else
    if v_conf + v_com > s.monto_total then
      raise exception 'Con la comisión, lo pagado (%) pasaría del total (%)', v_conf + v_com, s.monto_total;
    end if;
    update solicitudes
       set modalidad_comision = 'tomada', modalidad_pct = v_pct, modalidad_monto = v_com,
           modalidad_regla_antes = comision_regla, modalidad_pct_antes = comision_pct,
           comision_regla = 'fija', comision_pct = v_pct
     where id = s.id;
    insert into pagos (solicitud_id, via, monto, fecha_pago, referencia, nota, reportado_por)
    values (s.id, 'comision', v_com, hoy_mx(), 'Comisión cobrada directamente',
            'El comisionista tomó su comisión del pago del cliente', mi_persona_id())
    returning id into v_pago;
    update pagos set estado = 'confirmado' where id = v_pago;
  end if;
  perform set_config('tasa.motivo', '', true);
end;
$$;

create or replace function revertir_modalidad_comision(p_solicitud uuid, p_motivo text)
returns void language plpgsql security definer set search_path = public as $$
declare
  s          solicitudes;
  g          pagos;
  v_anterior text;
begin
  if mi_rol() not in ('admin_org', 'finanzas') then
    raise exception 'Solo finanzas o administración';
  end if;
  if char_length(trim(coalesce(p_motivo, ''))) < 3 then
    raise exception 'Escribe el motivo';
  end if;
  select * into s from solicitudes where id = p_solicitud and organizacion_id = mi_org() for update;
  if s.modalidad_comision is null then
    raise exception 'Este trámite no tiene la comisión descontada ni cobrada directamente';
  end if;
  if s.mes_cierre is not null and mes_aprobado(s.organizacion_id, s.mes_cierre) then
    raise exception 'El trabajo ya entró a un cierre aprobado: corrige con un ajuste en el mes abierto';
  end if;
  perform set_config('tasa.motivo', 'Se revierte la comisión ' || case s.modalidad_comision when 'descontada' then 'descontada' else 'cobrada directamente' end
                                    || ': ' || trim(p_motivo), true);

  -- Si ya estaba pagado, deja de estarlo (sin comisión en mes abierto, como revertir un pago).
  if s.pagado_en is not null then
    delete from comisiones where solicitud_id = s.id and tipo = 'comision';
    select estatus_publico into v_anterior from historial_estatus
     where solicitud_id = s.id and estatus_publico <> 'pagado' order by desde desc limit 1;
    update solicitudes set pagado_en = null, mes_cierre = null, estatus_publico = coalesce(v_anterior, 'entregado') where id = s.id;
  end if;

  if s.modalidad_comision = 'descontada' then
    update solicitudes
       set monto_honorarios = honorario_original, honorario_original = null, modalidad_comision = null, modalidad_pct = null, modalidad_monto = null,
           externo_honorario_pendiente = externo_id is not null and hay_conector_notion(organizacion_id),
           externo_comision_pendiente = externo_id is not null and hay_conector_notion(organizacion_id),
           externo_ref_pendiente = externo_id is not null and hay_conector_notion(organizacion_id)
     where id = s.id;
  else
    for g in select * from pagos where solicitud_id = s.id and via = 'comision' and estado in ('confirmado', 'reportado') loop
      if g.estado = 'confirmado' then
        perform set_config('tasa.revertir', 'on', true);
        update pagos set estado = 'reportado' where id = g.id;
        perform set_config('tasa.revertir', '', true);
      end if;
      update pagos set estado = 'retirado', motivo_retiro = 'Se revirtió "el comisionista ya tomó su comisión"' where id = g.id;
    end loop;
    update solicitudes
       set comision_regla = coalesce(modalidad_regla_antes, 'normal'), comision_pct = modalidad_pct_antes,
           modalidad_comision = null, modalidad_pct = null, modalidad_monto = null, modalidad_regla_antes = null, modalidad_pct_antes = null
     where id = s.id;
  end if;
  -- Con lo confirmado que quede, por si alcanza el total.
  perform liquidar_si_completo(s.id);
  perform set_config('tasa.motivo', '', true);
end;
$$;

-- ------------------------------------------------------------
-- Comisión, bono, crédito y cierre
-- ------------------------------------------------------------

-- 0077 + descontada: no se devenga; tomada: nace pagada y cobrada directamente.
create or replace function devengar_comision(p_solicitud uuid, p_tarde boolean, p_nota text)
returns void language plpgsql security definer set search_path = public as $$
declare
  s       solicitudes%rowtype;
  v_mes   date;
  v_pct   numeric;
  v_tipo  text := 'comision';
begin
  select * into s from solicitudes where id = p_solicitud;
  if s.pagado_en is null or coalesce(s.monto_honorarios, 0) - s.credito_honorarios <= 0 or s.comisionista_id is null
     or s.comision_regla = 'ninguna' or s.modalidad_comision = 'descontada' then
    return;
  end if;
  if exists (select 1 from comisiones c
              where c.solicitud_id = s.id and c.comisionista_id = s.comisionista_id and c.tipo in ('comision', 'ajuste')
                and c.anula_id is null and not exists (select 1 from comisiones x where x.anula_id = c.id)) then
    return;
  end if;

  v_mes := mes_abierto_desde(s.organizacion_id, s.pagado_en);
  if p_tarde and (mes_aprobado(s.organizacion_id, mes_de(s.pagado_en))
                  or exists (select 1 from comisiones c where c.solicitud_id = s.id
                                and c.comisionista_id = s.comisionista_id and c.tipo = 'comision')) then
    v_tipo := 'ajuste';
  end if;
  v_pct := case when s.comision_regla = 'fija' then s.comision_pct
                else porcentaje_vigente(s.organizacion_id, s.comisionista_id, v_mes) end;

  insert into comisiones (organizacion_id, comisionista_id, solicitud_id, tipo, base, porcentaje,
                          provisional, monto, mes, nota, creada_por, cobrada_directo, estado, pagada_en)
  values (s.organizacion_id, s.comisionista_id, s.id, v_tipo, s.monto_honorarios - s.credito_honorarios, v_pct,
          v_tipo = 'comision' and s.comision_regla <> 'fija'
            and porcentaje_es_provisional(s.organizacion_id, s.comisionista_id, v_mes),
          round((s.monto_honorarios - s.credito_honorarios) * v_pct / 100, 2), v_mes,
          case when s.modalidad_comision = 'tomada' then 'Cobrada directamente'
               else coalesce(p_nota,
            case when s.comision_regla = 'fija' then 'Devengada al quedar pagado el trabajo (% fijo del convenio)'
                 else 'Devengada al quedar pagado el trabajo' end) end,
          case when p_tarde then mi_persona_id() end,
          s.modalidad_comision is not distinct from 'tomada',
          case when s.modalidad_comision = 'tomada' then 'pagada' else 'devengada' end,
          case when s.modalidad_comision = 'tomada' then s.pagado_en end);
end;
$$;

-- 0077 + sin bono por referido en un trámite con la comisión descontada.
create or replace function bonos_referido_calculados(p_org uuid, p_mes date)
returns table (beneficiario uuid, tipo text, referido uuid, solicitud uuid, base numeric, porcentaje numeric,
               bruto numeric, monto numeric, tope_ajustado boolean, activos integer)
language plpgsql stable security definer set search_path = public as $$
declare
  a        ajustes%rowtype;
  v_mes    date := mes_de(p_mes);
  v_fin    date := (mes_de(p_mes) + interval '1 month' - interval '1 day')::date;
  r        record;
  t        record;
  v_pct    numeric;
  v_act    integer;
  v_ya     numeric;
  v_bruto  numeric;
  v_monto  numeric;
begin
  select * into a from ajustes where organizacion_id = p_org;

  for r in
    select distinct vr.referidor_id, vr.tipo from vinculos_referido vr
     where vr.organizacion_id = p_org and vr.estado = 'activo'
  loop
    if r.tipo = 'comisionista' then
      -- Regla 4: el que refiere tuvo un trabajo pagado en los últimos N meses (contando éste).
      if not exists (select 1 from solicitudes s
                      where s.organizacion_id = p_org and s.comisionista_id = r.referidor_id and s.pagado_en is not null
                        and s.estado <> 'cancelada'
                        and s.mes_cierre between (v_mes - make_interval(months => a.referido_actividad_meses - 1))::date and v_mes) then
        continue;
      end if;
      -- Regla 2: referidos activos con vínculo vigente en el mes.
      select count(*) into v_act from vinculos_referido vr
       where vr.organizacion_id = p_org and vr.referidor_id = r.referidor_id and vr.tipo = 'comisionista'
         and estado_vinculo(vr, v_mes) = 'vigente'
         and exists (select 1 from solicitudes s
                      where s.organizacion_id = p_org and s.comisionista_id = vr.referido_id and s.pagado_en is not null
                        and s.estado <> 'cancelada'
                        and s.mes_cierre between (v_mes - make_interval(months => a.referido_activo_meses - 1))::date and v_mes);
      v_pct := escalon_referidos(p_org, v_act);
    else
      -- Equipo: los dos interruptores, no admin_org, y su % fijo.
      select case when coalesce(a.bono_referido_equipo, false) and m.bono_referido and m.rol <> 'admin_org' and m.activa
                  then m.bono_referido_pct end, null
        into v_pct, v_act
        from membresias m where m.organizacion_id = p_org and m.persona_id = r.referidor_id;
    end if;
    if coalesce(v_pct, 0) <= 0 then
      continue;
    end if;

    for t in
      select s.id, s.comisionista_id, s.monto_honorarios - s.credito_honorarios as monto_honorarios, s.monto_honorarios as honorarios_completos, s.pagado_en,
             (select m.bono_referido_hasta from membresias m where m.organizacion_id = p_org and m.persona_id = r.referidor_id) as hasta
        from vinculos_referido vr
        join solicitudes s on s.organizacion_id = p_org and s.comisionista_id = vr.referido_id
       where vr.organizacion_id = p_org and vr.referidor_id = r.referidor_id and vr.tipo = r.tipo and vr.estado = 'activo'
         and s.mes_cierre = v_mes and s.pagado_en is not null and s.estado <> 'cancelada'
         and coalesce(s.monto_honorarios, 0) - s.credito_honorarios > 0 and s.comision_regla <> 'ninguna' and s.honorario_tipo <> 'sin_costo'
         and s.modalidad_comision is distinct from 'descontada'
         -- Dentro de la vigencia del vínculo (desde el primer trabajo pagado).
         and s.pagado_en >= coalesce(vr.inicio, primer_pago_de(p_org, vr.referido_id))
         and s.pagado_en <= coalesce(vr.fin, (coalesce(vr.inicio, primer_pago_de(p_org, vr.referido_id))
                                              + make_interval(months => a.referido_vigencia_meses) - interval '1 day')::date)
    loop
      if r.tipo = 'equipo' and t.hasta is not null and t.hasta < t.pagado_en then
        continue;
      end if;
      -- Regla 7: lo que ya lleva el trabajo (comisión + ajustes) y el tope de 30%.
      select coalesce(sum(c.monto), 0) into v_ya from comisiones c
       where c.organizacion_id = p_org and c.solicitud_id = t.id and c.tipo in ('comision', 'ajuste', 'bono');
      v_bruto := round(t.monto_honorarios * v_pct / 100, 2);
      v_monto := least(v_bruto, greatest(round(t.honorarios_completos * 0.30, 2) - v_ya, 0));
      beneficiario := r.referidor_id; tipo := r.tipo; referido := t.comisionista_id; solicitud := t.id;
      base := t.monto_honorarios; porcentaje := v_pct; bruto := v_bruto; monto := v_monto;
      tope_ajustado := v_monto < v_bruto; activos := v_act;
      return next;
    end loop;
  end loop;
end;
$$;

-- 0077 + un trámite con comisión descontada o cobrada directamente no admite crédito.
create or replace function credito_aplicable(p_solicitud uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  s          solicitudes;
  v_factor   numeric;
  v_hon      numeric;
  v_conf     numeric;
  v_max      numeric;
begin
  select * into s from solicitudes where id = p_solicitud;
  if s.id is null then return jsonb_build_object('monto', 0, 'motivo', 'No existe'); end if;
  if s.estado <> 'tramite' or s.pagado_en is not null then return jsonb_build_object('monto', 0, 'motivo', 'Solo trámites sin pagar'); end if;
  if s.honorario_tipo = 'sin_costo' or coalesce(s.monto_honorarios, 0) <= 0 then return jsonb_build_object('monto', 0, 'motivo', 'Trabajo sin costo'); end if;
  if s.modalidad_comision is not null then return jsonb_build_object('monto', 0, 'motivo', 'Tiene la comisión descontada o cobrada directamente'); end if;
  if s.convenio_id is not null then return jsonb_build_object('monto', 0, 'motivo', 'Trabajo con convenio'); end if;
  if s.honorario_tipo = 'estimado' and s.honorario_final_en is null then return jsonb_build_object('monto', 0, 'motivo', 'Falta el honorario final'); end if;
  v_factor := case when s.requiere_factura then 1.16 else 1 end;
  v_hon := round((s.monto_honorarios - s.credito_honorarios) * v_factor, 2);
  select coalesce(sum(monto), 0) into v_conf from pagos where solicitud_id = s.id and estado in ('confirmado', 'reportado');
  v_max := greatest(0, least(v_hon, s.monto_total - v_conf));
  return jsonb_build_object('monto', v_max, 'saldo', saldo_credito(s.organizacion_id, s.comisionista_id),
                            'motivo', case when v_max <= 0 then 'Ya está cubierto' end);
end;
$$;

-- 0044 + lo cobrado directamente no entra al pendiente de pago ni al arrastre.
create or replace function ejecutar_aprobacion_cierre(p_org uuid, p_mes date, p_persona uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_mes       date := mes_de(p_mes);
  v_siguiente date := (mes_de(p_mes) + interval '1 month')::date;
  v_destino   date;
  v_cierre    cierres%rowtype;
  v_previo    date;
  k           record;
  n           record;
begin
  select * into v_cierre from cierres where organizacion_id = p_org and mes = v_mes for update;
  if not found then
    raise exception 'Primero hay que preparar el cierre de %', to_char(v_mes, 'YYYY-MM');
  end if;
  if v_cierre.estado = 'aprobado' then
    raise exception 'El cierre de % ya estaba aprobado', to_char(v_mes, 'YYYY-MM');
  end if;

  select min(mes) into v_previo
    from comisiones
   where organizacion_id = p_org and mes < v_mes and not mes_aprobado(p_org, mes);
  if v_previo is not null then
    raise exception 'Antes hay que aprobar %', to_char(v_previo, 'YYYY-MM');
  end if;

  perform recalcular_comisiones_del_mes(p_org, v_mes);
  update comisiones set provisional = false
   where organizacion_id = p_org and mes = v_mes and provisional;

  -- Bono de referidos: vínculos al día y cálculo definitivo, antes de saldos y pago del día 10.
  perform actualizar_vinculos(p_org, v_mes);
  perform calcular_bonos_referido(p_org, v_mes);

  v_destino := mes_abierto_desde(p_org, v_siguiente);
  for k in
    select comisionista_id, sum(monto) as total
      from comisiones where organizacion_id = p_org and mes = v_mes and not cobrada_directo
     group by comisionista_id having sum(monto) < 0
  loop
    insert into comisiones (organizacion_id, comisionista_id, tipo, monto, mes, nota, creada_por)
    values (p_org, k.comisionista_id, 'arrastre', -k.total, v_mes,
            'Saldo negativo que pasa a ' || to_char(v_destino, 'YYYY-MM'), p_persona);
    insert into comisiones (organizacion_id, comisionista_id, tipo, monto, mes, nota, creada_por)
    values (p_org, k.comisionista_id, 'arrastre', k.total, v_destino,
            'Saldo negativo de ' || to_char(v_mes, 'YYYY-MM'), p_persona);
  end loop;

  update comisiones set cierre_id = v_cierre.id where organizacion_id = p_org and mes = v_mes;

  update cierres
     set estado = 'aprobado',
         resumen = resumen_del_mes(p_org, v_mes),
         aprobado_por = p_persona,
         aprobado_en = now()
   where id = v_cierre.id;

  insert into pendientes_comision (organizacion_id, comisionista_id, cierre_id, mes, monto)
  select p_org, comisionista_id, v_cierre.id, v_mes, sum(monto)
    from comisiones where organizacion_id = p_org and mes = v_mes and not cobrada_directo
   group by comisionista_id having sum(monto) > 0;

  for k in
    select c.persona_id
      from comisionistas c
      join membresias m on m.persona_id = c.persona_id and m.organizacion_id = p_org and m.rol = 'comisionista'
      join personas p on p.id = c.persona_id
     where c.organizacion_id = p_org and m.activa and p.activo and mes_de(c.fecha_alta) <= v_siguiente
  loop
    select * into n from calcular_nivel(p_org, k.persona_id, v_siguiente);
    insert into niveles_mensuales
      (organizacion_id, comisionista_id, mes, nivel_id, porcentaje, promedio, meses_considerados, cierre_id, motivo)
    values
      (p_org, k.persona_id, v_siguiente, n.nivel_id, n.porcentaje, n.promedio, n.meses_considerados, v_cierre.id, n.motivo)
    on conflict (organizacion_id, comisionista_id, mes) do update
       set nivel_id = excluded.nivel_id,
           porcentaje = excluded.porcentaje,
           promedio = excluded.promedio,
           meses_considerados = excluded.meses_considerados,
           cierre_id = excluded.cierre_id,
           motivo = excluded.motivo;
  end loop;

  if not mes_aprobado(p_org, v_siguiente) then
    perform recalcular_comisiones_del_mes(p_org, v_siguiente);
  end if;

  return v_cierre.id;
end;
$$;

-- 0016 + ni al total del cierre.
create or replace function resumen_del_mes(p_org uuid, p_mes date)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(fila order by fila->>'comisionista'), '[]'::jsonb)
    from (
      select jsonb_build_object(
               'comisionista_id', c.comisionista_id,
               'comisionista',    p.nombre,
               'total',           sum(c.monto),
               'por_cuenta',      (
                 select jsonb_object_agg(cuenta, total)
                   from (
                     select case when c2.tipo = 'arrastre' then 'Saldo arrastrado'
                                 else coalesce(cr.alias, 'Sin cuenta') end as cuenta,
                            sum(c2.monto) as total
                       from comisiones c2
                       left join cuentas_receptoras cr on cr.id = c2.cuenta_receptora_id
                      where c2.organizacion_id = p_org and c2.mes = mes_de(p_mes)
                        and c2.comisionista_id = c.comisionista_id and not c2.cobrada_directo
                      group by 1
                   ) t
               )
             ) as fila
        from comisiones c
        join personas p on p.id = c.comisionista_id
       where c.organizacion_id = p_org and c.mes = mes_de(p_mes) and not c.cobrada_directo
       group by c.comisionista_id, p.nombre
    ) x;
$$;

-- ------------------------------------------------------------
-- Notion: "Honorario" del trámite (solo con la propiedad en el mapeo)
-- ------------------------------------------------------------
update conectores set mapeo_campos = mapeo_campos || '{"honorario": "Honorario"}'::jsonb
 where tipo = 'notion' and not (mapeo_campos ? 'honorario');

create or replace function por_actualizar_honorario_afuera(p_conector uuid)
returns table (solicitud_id uuid, externo_id text, monto numeric)
language sql stable security definer set search_path = public as $$
  select s.id, s.externo_id, s.monto_honorarios
    from solicitudes s join conectores k on k.id = p_conector and k.organizacion_id = s.organizacion_id
   where puede_operar_conector(p_conector)
     and s.externo_honorario_pendiente and s.externo_id is not null and s.externo_baja_en is null;
$$;

create or replace function registrar_honorario_afuera(p_conector uuid, p_solicitud uuid, p_monto numeric, p_error text)
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
  perform set_config('tasa.motivo', case when p_error is null then 'Notion: Honorario → ' || p_monto
                                         else 'Notion no aceptó "Honorario": ' || p_error end, true);
  update solicitudes set externo_honorario_pendiente = false where id = s.id;
  if p_error is not null then
    insert into alertas (organizacion_id, tipo, solicitud_id, mensaje)
    values (s.organizacion_id, 'externo_comision', s.id,
            'No se pudo escribir el honorario en Notion (' || p_error || '): ' || coalesce(s.folio, 'sin folio') || ' · ' || s.cliente_nombre
            || '. Corrígelo a mano en Notion: $' || to_char(p_monto, 'FM999,999,990.00') || '.')
    on conflict (solicitud_id, tipo) where resuelta_en is null do update set mensaje = excluded.mensaje;
  end if;
  perform set_config('tasa.motivo', '', true);
end;
$$;

revoke all on function vista_modalidad_comision(uuid), aplicar_modalidad_comision(uuid, text, text), revertir_modalidad_comision(uuid, text),
  por_actualizar_honorario_afuera(uuid), registrar_honorario_afuera(uuid, uuid, numeric, text) from public, anon, authenticated;
grant execute on function vista_modalidad_comision(uuid), aplicar_modalidad_comision(uuid, text, text), revertir_modalidad_comision(uuid, text)
  to authenticated;
grant execute on function por_actualizar_honorario_afuera(uuid), registrar_honorario_afuera(uuid, uuid, numeric, text) to authenticated, service_role;
