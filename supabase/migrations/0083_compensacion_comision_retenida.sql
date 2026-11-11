-- ============================================================
-- 0083 — PAR DE COMPENSACIÓN EN COBROS Y GASTOS (ACCIÓN B)
--
-- Con "el comisionista ya tomó su comisión" (0079, B), lo que retuvo no
-- pasa por ninguna cuenta. Para que en Notion el trámite quede con Saldo
-- 0 y la comisión quede como gasto, Tasa crea en Cobros y Gastos un par
-- por el mismo monto en la cuenta de compensación (sin banco, saldo 0):
--   · INGRESO "Comisión retenida por el comisionista", ligado al trámite
--     (cuenta en "Pagos" del trámite);
--   · GASTO "Comisión de … cobrada directamente", ligado al comisionista
--     (Ext Comisionista), NO al trámite: si lo estuviera, "Pagos" lo
--     restaría y el par se anularía.
-- Al revertir B, Tasa manda los dos a la papelera de Notion. Solo con
-- la cuenta de compensación en la configuración del conector.
-- ============================================================

alter table solicitudes
  add column externo_compensacion_ids       text[],
  add column externo_compensacion_pendiente text check (externo_compensacion_pendiente in ('crear', 'borrar'));

create or replace function compensacion_por_accion_b()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.externo_id is null or not hay_conector_notion(new.organizacion_id) then
    return null;
  end if;
  if new.modalidad_comision = 'tomada' and old.modalidad_comision is distinct from 'tomada' then
    update solicitudes set externo_compensacion_pendiente = 'crear' where id = new.id;
  elsif old.modalidad_comision = 'tomada' and new.modalidad_comision is distinct from 'tomada' then
    -- Si ya se escribió, se borra; si todavía no, ya no se escribe.
    update solicitudes set externo_compensacion_pendiente = case when externo_compensacion_ids is not null then 'borrar' end
     where id = new.id;
  end if;
  return null;
end;
$$;
create trigger compensacion_por_accion_b after update of modalidad_comision on solicitudes
  for each row execute function compensacion_por_accion_b();

-- Lo que el sync tiene por hacer: crear (con monto, fecha, folio, comisionista y su página) o borrar (con los ids).
create or replace function por_compensar_afuera(p_conector uuid)
returns table (solicitud_id uuid, accion text, externo_id text, monto numeric, fecha date, folio text, comisionista text, pagina text, ids text[])
language sql stable security definer set search_path = public as $$
  select s.id, s.externo_compensacion_pendiente, s.externo_id, s.modalidad_monto, coalesce(s.pagado_en, hoy_mx()), s.folio,
         (select nombre from personas where id = s.comisionista_id), c.notion_pagina, s.externo_compensacion_ids
    from solicitudes s join conectores k on k.id = p_conector and k.organizacion_id = s.organizacion_id
    left join comisionistas c on c.organizacion_id = s.organizacion_id and c.persona_id = s.comisionista_id
   where puede_operar_conector(p_conector) and s.externo_compensacion_pendiente is not null and s.externo_id is not null
     and (s.externo_compensacion_pendiente = 'borrar' or (s.modalidad_comision = 'tomada' and coalesce(s.modalidad_monto, 0) > 0));
$$;

create or replace function registrar_compensacion_afuera(p_conector uuid, p_solicitud uuid, p_ids text[], p_error text)
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
  perform set_config('tasa.motivo', case when p_error is not null then 'Notion no aceptó la compensación: ' || p_error
                                         when s.externo_compensacion_pendiente = 'crear' then 'Notion: par de compensación creado'
                                         else 'Notion: par de compensación a la papelera' end, true);
  if p_error is null then
    update solicitudes
       set externo_compensacion_ids = case when externo_compensacion_pendiente = 'crear' then p_ids end,
           externo_compensacion_pendiente = null
     where id = s.id;
    -- El gasto se creó sin "Ext Comisionista": alerta en Hoy para ligarlo (0084).
    if s.externo_compensacion_pendiente = 'crear'
       and (select notion_pagina from comisionistas where organizacion_id = s.organizacion_id and persona_id = s.comisionista_id) is null then
      perform avisar_sin_pagina(s.organizacion_id, s.comisionista_id, 'el gasto de compensación de ' || coalesce(s.folio, 'un trabajo'));
    end if;
  else
    update solicitudes set externo_compensacion_pendiente = null where id = s.id;
    insert into alertas (organizacion_id, tipo, solicitud_id, mensaje)
    values (s.organizacion_id, 'externo_comision', s.id,
            'No se pudo ' || case when s.externo_compensacion_pendiente = 'crear' then 'crear' else 'borrar' end
            || ' el par de compensación en Cobros y Gastos (' || p_error || '): ' || coalesce(s.folio, 'sin folio') || '. Hazlo a mano.')
    on conflict (solicitud_id, tipo) where resuelta_en is null do update set mensaje = excluded.mensaje;
  end if;
  perform set_config('tasa.motivo', '', true);
end;
$$;

revoke all on function compensacion_por_accion_b(), por_compensar_afuera(uuid), registrar_compensacion_afuera(uuid, uuid, text[], text)
  from public, anon, authenticated;
grant execute on function por_compensar_afuera(uuid), registrar_compensacion_afuera(uuid, uuid, text[], text) to authenticated, service_role;
