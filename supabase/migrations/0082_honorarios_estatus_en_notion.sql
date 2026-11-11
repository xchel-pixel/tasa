-- ============================================================
-- 0082 — "HONORARIOS ESTATUS" EN NOTION CUANDO TASA LO CAUSA
--
-- Cuando un trámite queda pagado al 100% y lo causó Tasa (lleva
-- crédito aplicado, o la comisión descontada o cobrada directamente,
-- 0077-0079), Tasa escribe en Notion "Honorarios estatus" = Pagado en
-- la siguiente sincronización y lo recuerda (honorarios_pagado_por_tasa).
-- Si después deja de estar pagado (se revierte el pago con crédito o la
-- acción), solo esos regresan a "No Pagado 🔥". Los que el equipo marca
-- a mano por otros pagos no se tocan. Se escribe solo con la propiedad
-- en el mapeo del conector (honorarios_estatus).
-- ============================================================

alter table solicitudes
  add column honorarios_pagado_por_tasa    boolean not null default false,
  add column externo_honorarios_estatus    text check (externo_honorarios_estatus in ('Pagado', 'No Pagado 🔥')),
  add column externo_honorarios_pendiente  boolean not null default false;

create or replace function honorarios_estatus_por_tasa()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_causa boolean;
begin
  if new.externo_id is null or not hay_conector_notion(new.organizacion_id) then
    return null;
  end if;
  if new.pagado_en is not null and old.pagado_en is null then
    v_causa := new.credito_honorarios > 0 or new.modalidad_comision is not null
               or exists (select 1 from movimientos_credito m where m.solicitud_id = new.id and m.tipo = 'aplicacion'
                            and not exists (select 1 from movimientos_credito d where d.devuelve_id = m.id));
    if v_causa then
      update solicitudes set honorarios_pagado_por_tasa = true, externo_honorarios_estatus = 'Pagado', externo_honorarios_pendiente = true
       where id = new.id;
    end if;
  elsif new.pagado_en is null and old.pagado_en is not null and new.honorarios_pagado_por_tasa then
    update solicitudes set honorarios_pagado_por_tasa = false, externo_honorarios_estatus = 'No Pagado 🔥', externo_honorarios_pendiente = true
     where id = new.id;
  end if;
  return null;
end;
$$;
create trigger honorarios_estatus_por_tasa after update of pagado_en on solicitudes
  for each row execute function honorarios_estatus_por_tasa();

create or replace function por_actualizar_honorarios_estatus_afuera(p_conector uuid)
returns table (solicitud_id uuid, externo_id text, estatus text)
language sql stable security definer set search_path = public as $$
  select s.id, s.externo_id, s.externo_honorarios_estatus
    from solicitudes s join conectores k on k.id = p_conector and k.organizacion_id = s.organizacion_id
   where puede_operar_conector(p_conector)
     and s.externo_honorarios_pendiente and s.externo_honorarios_estatus is not null and s.externo_id is not null and s.externo_baja_en is null;
$$;

create or replace function registrar_honorarios_estatus_afuera(p_conector uuid, p_solicitud uuid, p_estatus text, p_error text)
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
  perform set_config('tasa.motivo', case when p_error is null then 'Notion: Honorarios estatus → ' || p_estatus
                                         else 'Notion no aceptó "Honorarios estatus": ' || p_error end, true);
  update solicitudes set externo_honorarios_pendiente = false where id = s.id;
  if p_error is not null then
    insert into alertas (organizacion_id, tipo, solicitud_id, mensaje)
    values (s.organizacion_id, 'externo_comision', s.id,
            'No se pudo escribir "Honorarios estatus" en Notion (' || p_error || '): ' || coalesce(s.folio, 'sin folio') || ' · '
            || s.cliente_nombre || '. Ponlo a mano: ' || p_estatus || '.')
    on conflict (solicitud_id, tipo) where resuelta_en is null do update set mensaje = excluded.mensaje;
  end if;
  perform set_config('tasa.motivo', '', true);
end;
$$;

revoke all on function honorarios_estatus_por_tasa(), por_actualizar_honorarios_estatus_afuera(uuid),
  registrar_honorarios_estatus_afuera(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function por_actualizar_honorarios_estatus_afuera(uuid), registrar_honorarios_estatus_afuera(uuid, uuid, text, text)
  to authenticated, service_role;
