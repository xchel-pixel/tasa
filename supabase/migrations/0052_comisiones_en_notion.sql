-- ============================================================
-- 0052 — COMISIONES, BONO DE REFERIDO Y PAGOS EN NOTION
--
-- Mismo mecanismo que "Solicitado por" (0049): Tasa marca "pendiente",
-- el cron escribe en Notion en la siguiente vuelta y deja evento,
-- bitácora o alerta. El cambio en Tasa nunca espera a Notion.
--
-- 1. Comisión directa → Trámites "Ext Comisionista" + "Ext Comisión".
--    Se marca al cambiar las comisiones de un trabajo: al quedar pagado
--    al 100 %, al recalcular el cierre (nivel, tope de 30 %), con un
--    ajuste o al cancelar. Monto = comisión + ajustes + cargos del
--    comisionista del trabajo en ese trabajo (nunca menos de 0). "Genera
--    comisión: no", sin costo o convenio sin comisión: 0.
-- 2. Bono de referido → Trámites "Ref Comisionista" + "Ref Bono". SOLO
--    al aprobar el cierre: el bono que ESE trabajo le generó a quien
--    refirió al comisionista. Sin bono: 0 y relación vacía. Los bonos de
--    equipo entran solo si existen (su bono activo); su relación queda
--    vacía porque Ext Comisionistas es de comisionistas.
-- 3. Pago de comisión (día 10) → un movimiento en "Cobros y Gastos" por
--    la comisión (con Ext Comisionista, cuadra su Saldo) y otro aparte
--    por el bono de referido incluido (sin relación). La cuenta sale del
--    origen del pago (Catálogos → "Cuentas para pagar comisiones").
--    Anular un pago ya escrito crea los movimientos en negativo.
-- 4. "Página en Notion" del comisionista (su página en Ext
--    Comisionistas). Sin página: se escribe el monto, la relación queda
--    vacía y sale una alerta.
-- ============================================================

alter table comisionistas
  add column notion_pagina text check (notion_pagina ~ '^[0-9a-f]{32}$'),
  add column notion_nombre text check (char_length(notion_nombre) <= 200);

alter table origenes_pago
  add column notion_cuenta text check (char_length(trim(notion_cuenta)) between 1 and 120);

alter table solicitudes
  add column externo_comision_pendiente boolean not null default false,
  add column externo_ref_pendiente      boolean not null default false;

alter table pagos_comision
  add column externo_pendiente         boolean not null default false,
  add column externo_ids               text[],
  add column externo_anular_pendiente  boolean not null default false;

-- ------------------------------------------------------------
-- Qué hay que escribir (helpers, sin permisos para nadie)
-- ------------------------------------------------------------

create or replace function hay_conector_notion(p_org uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from conectores where organizacion_id = p_org and tipo = 'notion' and activo);
$$;

-- Comisión directa del trabajo para Notion.
create or replace function comision_externa(p_solicitud uuid)
returns numeric language sql stable security definer set search_path = public as $$
  select greatest(coalesce(sum(c.monto), 0), 0)::numeric(12,2)
    from solicitudes s
    join comisiones c on c.solicitud_id = s.id and c.comisionista_id = s.comisionista_id
   where s.id = p_solicitud and c.tipo in ('comision', 'ajuste', 'cargo');
$$;

-- El bono que generó el trabajo y a quién (comisionista o equipo).
create or replace function bono_del_trabajo(p_solicitud uuid)
returns table (monto numeric, beneficiario uuid, es_comisionista boolean)
language sql stable security definer set search_path = public as $$
  with b as (
    select c.monto, c.comisionista_id as beneficiario, true as es_comisionista
      from comisiones c where c.solicitud_id = p_solicitud and c.tipo = 'referido'
    union all
    select e.monto, e.persona_id, false from bonos_equipo e where e.solicitud_id = p_solicitud
  )
  select coalesce(sum(b.monto), 0)::numeric(12,2),
         (array_agg(b.beneficiario order by b.monto desc))[1],
         coalesce((array_agg(b.es_comisionista order by b.monto desc))[1], false)
    from b;
$$;

-- ------------------------------------------------------------
-- Marcas de "pendiente"
-- ------------------------------------------------------------

create or replace function marcar_comision_pendiente()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_sol uuid := coalesce(new.solicitud_id, old.solicitud_id);
begin
  if tg_op = 'UPDATE' and new.monto = old.monto and new.solicitud_id is not distinct from old.solicitud_id
     and new.tipo = old.tipo then
    return null;
  end if;
  update solicitudes set externo_comision_pendiente = true
   where id in (v_sol, old.solicitud_id) and externo_id is not null and hay_conector_notion(organizacion_id);
  return null;
end;
$$;
create trigger al_cambiar_comision_en_notion after insert or update or delete on comisiones
  for each row execute function marcar_comision_pendiente();

-- Asignar otro comisionista cambia de quién es la comisión.
create or replace function marcar_comision_por_asignar()
returns trigger language plpgsql as $$
begin
  if new.externo_id is not null and new.comisionista_id is distinct from old.comisionista_id
     and exists (select 1 from comisiones where solicitud_id = new.id) then
    new.externo_comision_pendiente := true;
  end if;
  return new;
end;
$$;
create trigger al_asignar_comision_en_notion before update of comisionista_id on solicitudes
  for each row execute function marcar_comision_por_asignar();

-- Al aprobar el cierre: el bono (y la comisión ya definitiva) de los trabajos de ese mes.
create or replace function marcar_ref_pendiente()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.estado = 'aprobado' and old.estado is distinct from 'aprobado' and hay_conector_notion(new.organizacion_id) then
    update solicitudes s set externo_ref_pendiente = true, externo_comision_pendiente = true
     where s.organizacion_id = new.organizacion_id and s.externo_id is not null
       and (exists (select 1 from comisiones c where c.solicitud_id = s.id and c.mes = new.mes
                      and c.tipo in ('comision', 'referido'))
            or exists (select 1 from bonos_equipo e where e.solicitud_id = s.id and e.mes = new.mes));
  end if;
  return null;
end;
$$;
create trigger al_aprobar_cierre_en_notion after update of estado on cierres
  for each row execute function marcar_ref_pendiente();

create or replace function marcar_pago_pendiente()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.externo_pendiente := hay_conector_notion(new.organizacion_id);
  elsif new.estado = 'anulado' and old.estado = 'registrado' then
    if old.externo_pendiente then
      new.externo_pendiente := false;          -- nunca llegó a Notion: no hay nada que deshacer
    elsif old.externo_ids is not null then
      new.externo_anular_pendiente := true;
    end if;
  end if;
  return new;
end;
$$;
create trigger al_pagar_en_notion before insert or update of estado on pagos_comision
  for each row execute function marcar_pago_pendiente();

-- ------------------------------------------------------------
-- Eventos y alertas nuevos
-- ------------------------------------------------------------

alter table eventos_trabajo drop constraint eventos_trabajo_accion_check;
alter table eventos_trabajo add constraint eventos_trabajo_accion_check check (accion in (
  'revertir_confirmacion', 'revertir_rechazo', 'retirar_pago', 'anular_cotizacion', 'cancelar',
  'asignar_comisionista', 'sin_comision', 'con_comision', 'importar', 'notion_solicitado',
  'notion_comision', 'notion_referido'));

alter table alertas drop constraint alertas_tipo_check;
alter table alertas drop constraint alertas_tipo_completo;
alter table alertas
  add constraint alertas_tipo_check check (tipo in ('cancelado_externo', 'externo_borrado', 'liga_inactiva', 'conector',
                                                    'estimado_sin_final', 'liga_limite', 'pago_por_entregar', 'externo_solicitado',
                                                    'perfil_por_aprobar', 'externo_comision', 'notion_sin_pagina', 'notion_pago')),
  add constraint alertas_tipo_completo check (
    (tipo in ('cancelado_externo', 'externo_borrado', 'liga_inactiva', 'estimado_sin_final', 'pago_por_entregar',
              'externo_solicitado', 'externo_comision')
     and solicitud_id is not null)
    or (tipo = 'conector' and conector_id is not null and codigo is not null)
    or (tipo in ('liga_limite', 'perfil_por_aprobar', 'notion_sin_pagina', 'notion_pago') and codigo is not null));

create unique index alertas_notion_una_abierta
  on alertas (organizacion_id, tipo, codigo) where resuelta_en is null and tipo in ('notion_sin_pagina', 'notion_pago');

-- Una alerta por comisionista sin página (codigo = su persona); se cierra al ligarla.
create or replace function avisar_sin_pagina(p_org uuid, p_persona uuid, p_para text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_nombre text := (select nombre from personas where id = p_persona);
begin
  insert into alertas (organizacion_id, tipo, codigo, mensaje)
  values (p_org, 'notion_sin_pagina', p_persona::text,
          v_nombre || ' no tiene "Página en Notion": ' || p_para || ' se escribió sin ligarlo. Lígalo en su ficha.')
  on conflict do nothing;
end;
$$;

-- ------------------------------------------------------------
-- 1. Comisión directa
-- ------------------------------------------------------------

create or replace function por_actualizar_comision_afuera(p_conector uuid)
returns table (solicitud_id uuid, externo_id text, monto numeric, pagina text, comisionista uuid)
language sql stable security definer set search_path = public as $$
  select s.id, s.externo_id, comision_externa(s.id), c.notion_pagina, s.comisionista_id
    from solicitudes s
    join conectores k on k.id = p_conector and k.organizacion_id = s.organizacion_id
    left join comisionistas c on c.organizacion_id = s.organizacion_id and c.persona_id = s.comisionista_id
   where puede_operar_conector(p_conector)
     and s.externo_comision_pendiente and s.externo_id is not null and s.externo_baja_en is null;
$$;

-- p_error nulo: se escribió. Con error: alerta y no se reintenta.
create or replace function registrar_comision_afuera(p_conector uuid, p_solicitud uuid, p_monto numeric, p_error text)
returns void language plpgsql security definer set search_path = public as $$
declare
  s        solicitudes%rowtype;
  v_pagina text;
begin
  if not puede_operar_conector(p_conector) then
    raise exception 'Solo admin_org sincroniza el conector';
  end if;
  select x.* into s from solicitudes x join conectores k on k.id = p_conector and k.organizacion_id = x.organizacion_id
   where x.id = p_solicitud for update;
  if not found then
    return;
  end if;
  select notion_pagina into v_pagina from comisionistas where organizacion_id = s.organizacion_id and persona_id = s.comisionista_id;

  perform set_config('tasa.motivo', case when p_error is null then 'Notion: Ext Comisión → ' || p_monto
                                         else 'Notion no aceptó "Ext Comisión": ' || p_error end, true);
  update solicitudes set externo_comision_pendiente = false where id = s.id;
  if p_error is null then
    insert into eventos_trabajo (organizacion_id, solicitud_id, accion, detalle)
    values (s.organizacion_id, s.id, 'notion_comision', 'En Notion, "Ext Comisión": $' || to_char(p_monto, 'FM999,999,990.00'));
    if v_pagina is null and p_monto > 0 then
      perform avisar_sin_pagina(s.organizacion_id, s.comisionista_id, 'su comisión de ' || coalesce(s.folio, 'un trabajo'));
    end if;
  else
    insert into alertas (organizacion_id, tipo, solicitud_id, mensaje)
    values (s.organizacion_id, 'externo_comision', s.id,
            'No se pudo escribir la comisión en Notion (' || p_error || '): ' || coalesce(s.folio, 'sin folio') || ' · '
            || s.cliente_nombre || '. En Tasa la comisión no cambia; corrígelo a mano en Notion.')
    on conflict (solicitud_id, tipo) where resuelta_en is null do update set mensaje = excluded.mensaje;
  end if;
  perform set_config('tasa.motivo', '', true);
end;
$$;

-- ------------------------------------------------------------
-- 2. Bono de referido (solo al aprobar el cierre)
-- ------------------------------------------------------------

create or replace function por_actualizar_ref_afuera(p_conector uuid)
returns table (solicitud_id uuid, externo_id text, monto numeric, pagina text, beneficiario uuid)
language sql stable security definer set search_path = public as $$
  select s.id, s.externo_id, b.monto,
         case when b.monto > 0 and b.es_comisionista then c.notion_pagina end,
         case when b.monto > 0 then b.beneficiario end
    from solicitudes s
    join conectores k on k.id = p_conector and k.organizacion_id = s.organizacion_id
    cross join lateral bono_del_trabajo(s.id) b
    left join comisionistas c on c.organizacion_id = s.organizacion_id and c.persona_id = b.beneficiario
   where puede_operar_conector(p_conector)
     and s.externo_ref_pendiente and s.externo_id is not null and s.externo_baja_en is null;
$$;

create or replace function registrar_ref_afuera(p_conector uuid, p_solicitud uuid, p_monto numeric, p_error text)
returns void language plpgsql security definer set search_path = public as $$
declare
  s solicitudes%rowtype;
  b record;
begin
  if not puede_operar_conector(p_conector) then
    raise exception 'Solo admin_org sincroniza el conector';
  end if;
  select x.* into s from solicitudes x join conectores k on k.id = p_conector and k.organizacion_id = x.organizacion_id
   where x.id = p_solicitud for update;
  if not found then
    return;
  end if;
  select * into b from bono_del_trabajo(s.id);

  perform set_config('tasa.motivo', case when p_error is null then 'Notion: Ref Bono → ' || p_monto
                                         else 'Notion no aceptó "Ref Bono": ' || p_error end, true);
  update solicitudes set externo_ref_pendiente = false where id = s.id;
  if p_error is null then
    insert into eventos_trabajo (organizacion_id, solicitud_id, accion, detalle)
    values (s.organizacion_id, s.id, 'notion_referido', 'En Notion, "Ref Bono": $' || to_char(p_monto, 'FM999,999,990.00')
            || coalesce(' · ' || (select nombre from personas where id = b.beneficiario and p_monto > 0), ''));
    if p_monto > 0 and b.es_comisionista
       and (select notion_pagina from comisionistas where organizacion_id = s.organizacion_id and persona_id = b.beneficiario) is null then
      perform avisar_sin_pagina(s.organizacion_id, b.beneficiario, 'su bono de referido por ' || coalesce(s.folio, 'un trabajo'));
    end if;
  else
    insert into alertas (organizacion_id, tipo, solicitud_id, mensaje)
    values (s.organizacion_id, 'externo_comision', s.id,
            'No se pudo escribir el bono de referido en Notion (' || p_error || '): ' || coalesce(s.folio, 'sin folio') || ' · '
            || s.cliente_nombre || '. En Tasa el bono no cambia; corrígelo a mano en Notion.')
    on conflict (solicitud_id, tipo) where resuelta_en is null do update set mensaje = excluded.mensaje;
  end if;
  perform set_config('tasa.motivo', '', true);
end;
$$;

-- ------------------------------------------------------------
-- 3. Pagos de comisión → Cobros y Gastos
-- ------------------------------------------------------------

-- Cuánto de un pago es bono de referido: lo que cada pendiente que cubre trae de bono, en proporción.
create or replace function bono_en_pago(p_pago uuid)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(round(sum(a.monto * least(1, coalesce(r.bono, 0) / nullif(p.monto, 0))), 2), 0)::numeric(12,2)
    from aplicaciones_pago_comision a
    join pendientes_comision p on p.id = a.pendiente_id
    left join lateral (
      select sum(c.monto) as bono from comisiones c
       where c.organizacion_id = p.organizacion_id and c.comisionista_id = p.comisionista_id
         and c.mes = p.mes and c.tipo = 'referido'
    ) r on true
   where a.pago_id = p_pago;
$$;

create or replace function por_registrar_pagos_afuera(p_conector uuid)
returns table (pago_id uuid, anular boolean, fecha date, monto numeric, bono numeric, comisionista text, pagina text,
               cuenta text, origen text, referencia text, folios text, registro text, externo_ids text[])
language sql stable security definer set search_path = public as $$
  select g.id, g.externo_anular_pendiente, g.fecha, g.monto, bono_en_pago(g.id), pe.nombre, c.notion_pagina,
         o.notion_cuenta, o.nombre, g.referencia,
         (select string_agg(distinct s.folio, ', ') from aplicaciones_pago_comision a
            join pendientes_comision p on p.id = a.pendiente_id
            join comisiones x on x.organizacion_id = p.organizacion_id and x.comisionista_id = p.comisionista_id
                             and x.mes = p.mes and x.tipo = 'comision'
            join solicitudes s on s.id = x.solicitud_id
           where a.pago_id = g.id and s.folio is not null),
         (select nombre from personas where id = g.registrado_por),
         g.externo_ids
    from pagos_comision g
    join conectores k on k.id = p_conector and k.organizacion_id = g.organizacion_id
    join personas pe on pe.id = g.comisionista_id
    left join comisionistas c on c.organizacion_id = g.organizacion_id and c.persona_id = g.comisionista_id
    left join origenes_pago o on o.id = g.origen_id
   where puede_operar_conector(p_conector)
     and (g.externo_pendiente or g.externo_anular_pendiente)
   order by g.registrado_en;
$$;

-- p_ids: las páginas creadas. p_avisos: lo que se escribió incompleto (sin cuenta o sin página). p_error: no se escribió.
create or replace function registrar_pago_afuera(p_conector uuid, p_pago uuid, p_ids text[], p_avisos text, p_error text)
returns void language plpgsql security definer set search_path = public as $$
declare
  g pagos_comision%rowtype;
  v_quien text;
begin
  if not puede_operar_conector(p_conector) then
    raise exception 'Solo admin_org sincroniza el conector';
  end if;
  select x.* into g from pagos_comision x join conectores k on k.id = p_conector and k.organizacion_id = x.organizacion_id
   where x.id = p_pago for update;
  if not found then
    return;
  end if;
  v_quien := (select nombre from personas where id = g.comisionista_id);

  perform set_config('tasa.motivo', case when p_error is not null then 'Notion no aceptó el pago: ' || p_error
                                         when g.externo_anular_pendiente then 'Notion: pago anulado en Cobros y Gastos'
                                         else 'Notion: pago en Cobros y Gastos' end, true);
  if g.externo_anular_pendiente then
    update pagos_comision set externo_anular_pendiente = false,
           externo_ids = case when p_error is null then externo_ids || p_ids else externo_ids end
     where id = g.id;
  else
    update pagos_comision set externo_pendiente = false, externo_ids = case when p_error is null then p_ids end where id = g.id;
  end if;

  if p_error is not null or p_avisos is not null then
    insert into alertas (organizacion_id, tipo, codigo, mensaje)
    values (g.organizacion_id, 'notion_pago', g.id::text,
            case when p_error is not null
                 then 'No se pudo ' || case when g.externo_anular_pendiente then 'anular' else 'registrar' end
                      || ' en Cobros y Gastos el pago de $' || to_char(g.monto, 'FM999,999,990.00') || ' a ' || v_quien
                      || ' del ' || to_char(g.fecha, 'DD/MM/YYYY') || ' (' || p_error || '). En Tasa ya quedó; regístralo a mano en Notion.'
                 else 'El pago de $' || to_char(g.monto, 'FM999,999,990.00') || ' a ' || v_quien || ' del '
                      || to_char(g.fecha, 'DD/MM/YYYY') || ' quedó en Cobros y Gastos ' || p_avisos || '. Complétalo en Notion.' end)
    on conflict do nothing;
  end if;
  perform set_config('tasa.motivo', '', true);
end;
$$;

-- ------------------------------------------------------------
-- 4. Ligar la página de Notion del comisionista (admin_org)
-- ------------------------------------------------------------

create or replace function ligar_pagina_notion(p_persona uuid, p_pagina text, p_nombre text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_pagina text := nullif(replace(lower(trim(coalesce(p_pagina, ''))), '-', ''), '');
begin
  if not soy_admin_org() then
    raise exception 'Solo admin_org liga comisionistas con Notion';
  end if;
  if v_pagina is not null and v_pagina !~ '^[0-9a-f]{32}$' then
    raise exception 'Esa no es una página de Notion';
  end if;
  if v_pagina is not null and exists (select 1 from comisionistas where organizacion_id = mi_org()
                                         and notion_pagina = v_pagina and persona_id <> p_persona) then
    raise exception 'Esa página de Notion ya está ligada a otro comisionista';
  end if;
  perform set_config('tasa.motivo', case when v_pagina is null then 'Página en Notion: quitada'
                                         else 'Página en Notion: ' || coalesce(trim(p_nombre), v_pagina) end, true);
  update comisionistas set notion_pagina = v_pagina, notion_nombre = case when v_pagina is not null then left(trim(p_nombre), 200) end
   where organizacion_id = mi_org() and persona_id = p_persona;
  if not found then
    raise exception 'No existe ese comisionista';
  end if;
  if v_pagina is not null then
    update alertas set resuelta_en = now(), resuelta_por = mi_persona_id(), resolucion = 'Página en Notion ligada'
     where organizacion_id = mi_org() and tipo = 'notion_sin_pagina' and codigo = p_persona::text and resuelta_en is null;
  end if;
  perform set_config('tasa.motivo', '', true);
end;
$$;

-- ------------------------------------------------------------
-- Permisos
-- ------------------------------------------------------------

revoke all on function hay_conector_notion(uuid), comision_externa(uuid), bono_del_trabajo(uuid), bono_en_pago(uuid),
  marcar_comision_pendiente(), marcar_comision_por_asignar(), marcar_ref_pendiente(), marcar_pago_pendiente(),
  avisar_sin_pagina(uuid, uuid, text),
  por_actualizar_comision_afuera(uuid), registrar_comision_afuera(uuid, uuid, numeric, text),
  por_actualizar_ref_afuera(uuid), registrar_ref_afuera(uuid, uuid, numeric, text),
  por_registrar_pagos_afuera(uuid), registrar_pago_afuera(uuid, uuid, text[], text, text),
  ligar_pagina_notion(uuid, text, text)
  from public, anon, authenticated;
grant execute on function
  por_actualizar_comision_afuera(uuid), registrar_comision_afuera(uuid, uuid, numeric, text),
  por_actualizar_ref_afuera(uuid), registrar_ref_afuera(uuid, uuid, numeric, text),
  por_registrar_pagos_afuera(uuid), registrar_pago_afuera(uuid, uuid, text[], text, text)
  to authenticated, service_role;
grant execute on function ligar_pagina_notion(uuid, text, text) to authenticated;
