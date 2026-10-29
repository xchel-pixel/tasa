-- ============================================================
-- 0034 — CANCELAR CON NOTION Y PÁGINAS BORRADAS
--
-- Hasta aquí, Etapa "Cancelado" en Notion solo dejaba una alerta
-- ("confirmar en Tasa") y el trabajo seguía igual. Reglas nuevas:
--
-- 1. Etapa "Cancelado" en Notion → Tasa cancela el trabajo para todos
--    (bitácora "Cancelado desde Notion"). Si tenía pagos o comisión, se
--    cancela sin tocar el dinero (no se borra nada) y queda una alerta
--    para admin_org.
-- 2. Cancelar en Tasa → el cron escribe Etapa "Cancelado" en Notion. Un
--    trabajo cancelado nunca revive por una lectura (ya lo impedía
--    `reglas_solicitud` y `registrar_lectura` solo mueve trabajos vivos).
-- 3. Página borrada o archivada en Notion → Tasa no cambia el estatus:
--    alerta "la página ya no existe" y deja de sincronizar ese trabajo
--    (`externo_baja_en`). El cron revisa cada trabajo vivo una vez por hora.
-- ============================================================

alter table solicitudes
  add column externo_revisado_en timestamptz,
  add column externo_baja_en timestamptz;

alter table alertas drop constraint alertas_tipo_check;
alter table alertas drop constraint alertas_tipo_completo;
alter table alertas
  add constraint alertas_tipo_check check (tipo in ('cancelado_externo', 'externo_borrado', 'conector')),
  add constraint alertas_tipo_completo check (
    (tipo in ('cancelado_externo', 'externo_borrado') and solicitud_id is not null)
    or (tipo = 'conector' and conector_id is not null and codigo is not null));

-- ------------------------------------------------------------
-- 1. LEER: "Cancelado" cancela; una página dada de baja ya no se lee.
-- ------------------------------------------------------------

create or replace function registrar_lectura(
  p_conector     uuid,
  p_externo_id   text,
  p_titulo       text,
  p_etapa        text,
  p_fecha_visita date
)
returns text language plpgsql security definer set search_path = public as $$
declare
  k          conectores%rowtype;
  s          solicitudes%rowtype;
  v_prefijo  text;
  v_folio    text;
  v_estatus  text;
  v_dinero   boolean;
  v_alerta   boolean := false;
  v_cancelo  boolean := false;
begin
  if not puede_operar_conector(p_conector) then
    raise exception 'Solo admin_org sincroniza el conector';
  end if;
  select * into k from conectores where id = p_conector;
  select prefijo_folio into v_prefijo from organizaciones where id = k.organizacion_id;

  select * into s from solicitudes
   where organizacion_id = k.organizacion_id and externo_id = p_externo_id for update;
  if not found then
    return 'sin_trabajo';
  end if;
  if s.externo_baja_en is not null then
    return 'sin_cambios';
  end if;

  v_folio := coalesce(substring(p_titulo from v_prefijo || '-[0-9]{4}-[0-9]{4}'), s.folio);
  v_estatus := s.estatus_publico;

  if p_etapa = coalesce(k.configuracion->>'valor_cancelado', 'Cancelado') then
    if s.estado <> 'cancelada' then
      perform set_config('tasa.motivo', 'Cancelado desde ' || initcap(k.tipo), true);
      v_dinero := exists (select 1 from pagos p where p.solicitud_id = s.id and p.estado in ('reportado', 'confirmado'))
               or exists (select 1 from comisiones c where c.solicitud_id = s.id);
      if v_dinero then
        -- Con dinero de por medio no se borra nada: se cancela y admin_org decide los ajustes.
        update cotizaciones set estado = 'vencida', respondida_en = now() where solicitud_id = s.id and estado = 'emitida';
        update solicitudes
           set estado = 'cancelada', estatus_publico = 'cancelada', cancelada_en = now(),
               motivo_cancelacion = 'Cancelado desde ' || initcap(k.tipo)
         where id = s.id;
        insert into alertas (organizacion_id, tipo, solicitud_id, mensaje)
        values (k.organizacion_id, 'cancelado_externo', s.id,
                'Cancelado desde ' || initcap(k.tipo) || ' con pagos o comisión (no se borró nada; revisa si hay que ajustar): '
                || coalesce(v_folio, 'sin folio') || ' · ' || s.cliente_nombre)
        on conflict (solicitud_id, tipo) where resuelta_en is null
        do update set mensaje = excluded.mensaje;
        v_alerta := true;
      else
        perform cancelar_trabajo(s.id, 'Cancelado desde ' || initcap(k.tipo));
        -- La alerta vieja de "confirmar en Tasa" ya no aplica.
        update alertas set resuelta_en = now(), resolucion = 'Cancelado desde ' || initcap(k.tipo) || ' automáticamente'
         where solicitud_id = s.id and tipo = 'cancelado_externo' and resuelta_en is null;
      end if;
      v_cancelo := true;
      select estatus_publico into v_estatus from solicitudes where id = s.id;
    end if;
  elsif s.estado = 'tramite' and s.estatus_publico not in ('pagado', 'cancelada') then
    select estatus_publico into v_estatus from mapeo_estatus
     where conector_id = k.id and valor_externo = p_etapa;
    if v_estatus = 'aceptada' and p_fecha_visita is not null then
      v_estatus := 'visita_agendada';
    end if;
    v_estatus := coalesce(v_estatus, s.estatus_publico);
  end if;

  update solicitudes
     set folio            = v_folio,
         estatus_externo  = p_etapa,
         estatus_publico  = v_estatus,
         externo_leido_en = now(),
         externo_revisado_en = now()
   where id = s.id;
  perform set_config('tasa.motivo', '', true);

  if v_alerta then
    return 'alerta';
  elsif v_cancelo
     or v_folio is distinct from s.folio
     or v_estatus is distinct from s.estatus_publico
     or p_etapa is distinct from s.estatus_externo then
    return 'actualizado';
  end if;
  return 'sin_cambios';
end;
$$;

-- ------------------------------------------------------------
-- 2. CANCELADO EN TASA → "Cancelado" EN NOTION
-- ------------------------------------------------------------

create or replace function por_cancelar_afuera(p_conector uuid)
returns table (solicitud_id uuid, externo_id text, etapa text)
language sql stable security definer set search_path = public as $$
  select s.id, s.externo_id, coalesce(k.configuracion->>'valor_cancelado', 'Cancelado')
    from solicitudes s join conectores k on k.id = p_conector and k.organizacion_id = s.organizacion_id
   where puede_operar_conector(p_conector)
     and s.estado = 'cancelada' and s.externo_id is not null and s.externo_baja_en is null
     and s.estatus_externo is distinct from coalesce(k.configuracion->>'valor_cancelado', 'Cancelado');
$$;

create or replace function registrar_cancelado_afuera(p_conector uuid, p_solicitud uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  k conectores%rowtype;
begin
  if not puede_operar_conector(p_conector) then
    raise exception 'Solo admin_org sincroniza el conector';
  end if;
  select * into k from conectores where id = p_conector;
  update solicitudes set estatus_externo = coalesce(k.configuracion->>'valor_cancelado', 'Cancelado'), externo_revisado_en = now()
   where id = p_solicitud and organizacion_id = k.organizacion_id and estado = 'cancelada';
end;
$$;

-- ------------------------------------------------------------
-- 3. PÁGINA BORRADA O ARCHIVADA
-- ------------------------------------------------------------

-- Trabajos vivos con página afuera que no se han revisado en la última hora.
create or replace function por_revisar_afuera(p_conector uuid, p_limite integer default 30)
returns table (solicitud_id uuid, externo_id text)
language sql stable security definer set search_path = public as $$
  select s.id, s.externo_id
    from solicitudes s join conectores k on k.id = p_conector and k.organizacion_id = s.organizacion_id
   where puede_operar_conector(p_conector)
     and s.estado = 'tramite' and s.externo_id is not null and s.externo_baja_en is null
     and (s.externo_revisado_en is null or s.externo_revisado_en < now() - interval '1 hour')
   order by s.externo_revisado_en nulls first
   limit p_limite;
$$;

create or replace function registrar_revision_externa(p_conector uuid, p_solicitud uuid, p_existe boolean)
returns void language plpgsql security definer set search_path = public as $$
declare
  k conectores%rowtype;
  s solicitudes%rowtype;
begin
  if not puede_operar_conector(p_conector) then
    raise exception 'Solo admin_org sincroniza el conector';
  end if;
  select * into k from conectores where id = p_conector;
  select * into s from solicitudes where id = p_solicitud and organizacion_id = k.organizacion_id for update;
  if not found then
    return;
  end if;
  if p_existe then
    update solicitudes set externo_revisado_en = now() where id = s.id;
    return;
  end if;
  perform set_config('tasa.motivo', 'La página de ' || initcap(k.tipo) || ' ya no existe', true);
  update solicitudes set externo_baja_en = now(), externo_revisado_en = now() where id = s.id;
  insert into alertas (organizacion_id, tipo, solicitud_id, mensaje)
  values (k.organizacion_id, 'externo_borrado', s.id,
          'La página de ' || initcap(k.tipo) || ' ya no existe (borrada o archivada). Tasa dejó de sincronizar este trabajo y no cambió su estatus: '
          || coalesce(s.folio, 'sin folio') || ' · ' || s.cliente_nombre)
  on conflict (solicitud_id, tipo) where resuelta_en is null do nothing;
  perform set_config('tasa.motivo', '', true);
end;
$$;

revoke all on function
  registrar_lectura(uuid, text, text, text, date), por_cancelar_afuera(uuid), registrar_cancelado_afuera(uuid, uuid),
  por_revisar_afuera(uuid, integer), registrar_revision_externa(uuid, uuid, boolean)
  from public, anon, authenticated;
-- Como en 0018: las llama el cron (servicio) o admin_org desde "Sincronizar ahora"; cada una revisa
-- puede_operar_conector.
grant execute on function
  registrar_lectura(uuid, text, text, text, date), por_cancelar_afuera(uuid), registrar_cancelado_afuera(uuid, uuid),
  por_revisar_afuera(uuid, integer), registrar_revision_externa(uuid, uuid, boolean)
  to authenticated, service_role;
