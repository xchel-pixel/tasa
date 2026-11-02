-- ============================================================
-- 0049 — "SOLICITADO POR" EN NOTION AL ASIGNAR COMISIONISTA
--
-- Al asignar o cambiar el comisionista de un trabajo que ya tiene página
-- (o al traerlo de Notion), el trabajo queda pendiente y en la siguiente
-- vuelta del cron se escribe SOLO la propiedad "Solicitado por" con el
-- nombre para mostrar del comisionista. Nada más se escribe en Notion.
--
-- El cambio en Tasa nunca espera a Notion. Si la página ya no existe o
-- Notion falla, se le avisa a admin_org con una alerta y no se reintenta
-- (salvo que Notion pida esperar). Lo escrito queda en el historial del
-- trabajo y en bitácora.
-- ============================================================

alter table solicitudes add column externo_solicitado_pendiente boolean not null default false;

create or replace function marcar_solicitado_pendiente()
returns trigger language plpgsql as $$
begin
  if new.externo_id is not null and new.comisionista_id is not null
     and (tg_op = 'INSERT' or new.comisionista_id is distinct from old.comisionista_id) then
    new.externo_solicitado_pendiente := true;
  end if;
  return new;
end;
$$;
create trigger al_asignar_en_notion before insert or update of comisionista_id on solicitudes
  for each row execute function marcar_solicitado_pendiente();

alter table eventos_trabajo drop constraint eventos_trabajo_accion_check;
alter table eventos_trabajo add constraint eventos_trabajo_accion_check check (accion in (
  'revertir_confirmacion', 'revertir_rechazo', 'retirar_pago', 'anular_cotizacion', 'cancelar',
  'asignar_comisionista', 'sin_comision', 'con_comision', 'importar', 'notion_solicitado'));

alter table alertas drop constraint alertas_tipo_check;
alter table alertas drop constraint alertas_tipo_completo;
alter table alertas
  add constraint alertas_tipo_check check (tipo in ('cancelado_externo', 'externo_borrado', 'liga_inactiva', 'conector',
                                                    'estimado_sin_final', 'liga_limite', 'pago_por_entregar', 'externo_solicitado')),
  add constraint alertas_tipo_completo check (
    (tipo in ('cancelado_externo', 'externo_borrado', 'liga_inactiva', 'estimado_sin_final', 'pago_por_entregar', 'externo_solicitado')
     and solicitud_id is not null)
    or (tipo = 'conector' and conector_id is not null and codigo is not null)
    or (tipo = 'liga_limite' and codigo is not null));

create or replace function por_actualizar_solicitado_afuera(p_conector uuid)
returns table (solicitud_id uuid, externo_id text, nombre text)
language sql stable security definer set search_path = public as $$
  select s.id, s.externo_id, nombre_visible(p)
    from solicitudes s
    join conectores k on k.id = p_conector and k.organizacion_id = s.organizacion_id
    join personas p on p.id = s.comisionista_id
   where puede_operar_conector(p_conector)
     and s.externo_solicitado_pendiente and s.externo_id is not null and s.externo_baja_en is null;
$$;

-- p_error nulo: se escribió. Con error: alerta para admin_org y no se reintenta.
create or replace function registrar_solicitado_afuera(p_conector uuid, p_solicitud uuid, p_error text)
returns void language plpgsql security definer set search_path = public as $$
declare
  s        solicitudes%rowtype;
  v_nombre text;
begin
  if not puede_operar_conector(p_conector) then
    raise exception 'Solo admin_org sincroniza el conector';
  end if;
  select x.* into s from solicitudes x join conectores k on k.id = p_conector and k.organizacion_id = x.organizacion_id
   where x.id = p_solicitud for update;
  if not found then
    return;
  end if;
  select nombre_visible(p) into v_nombre from personas p where p.id = s.comisionista_id;

  perform set_config('tasa.motivo', case when p_error is null then 'Notion: Solicitado por → ' || v_nombre
                                         else 'Notion no aceptó "Solicitado por": ' || p_error end, true);
  update solicitudes set externo_solicitado_pendiente = false where id = s.id;
  if p_error is null then
    insert into eventos_trabajo (organizacion_id, solicitud_id, accion, detalle)
    values (s.organizacion_id, s.id, 'notion_solicitado', 'En Notion, "Solicitado por": ' || v_nombre);
  else
    insert into alertas (organizacion_id, tipo, solicitud_id, mensaje)
    values (s.organizacion_id, 'externo_solicitado', s.id,
            'No se pudo poner "Solicitado por: ' || v_nombre || '" en Notion (' || p_error || '): '
            || coalesce(s.folio, 'sin folio') || ' · ' || s.cliente_nombre || '. En Tasa ya quedó asignado; corrígelo a mano en Notion.')
    on conflict (solicitud_id, tipo) where resuelta_en is null do update set mensaje = excluded.mensaje;
  end if;
  perform set_config('tasa.motivo', '', true);
end;
$$;

revoke all on function marcar_solicitado_pendiente(), por_actualizar_solicitado_afuera(uuid),
  registrar_solicitado_afuera(uuid, uuid, text) from public, anon, authenticated;
grant execute on function por_actualizar_solicitado_afuera(uuid), registrar_solicitado_afuera(uuid, uuid, text)
  to authenticated, service_role;
