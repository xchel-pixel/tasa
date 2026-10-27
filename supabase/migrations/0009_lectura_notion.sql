-- ============================================================
-- 0009 — LECTURA DE NOTION Y ALERTAS
--
-- Lo que la aplicación trae de Notion (cada 15 min o con el botón
-- "actualizar") entra por una sola puerta: `registrar_lectura_notion`.
-- Las reglas viven aquí y no en el código que llama a Notion, para que
-- el adaptador real y el simulado se comporten igual.
--
--   · Folio: Tasa crea la página como "Pendiente de folio – <cliente>".
--     El proceso de siempre (a mano o la skill tramites-mgp) pone el
--     folio en el título; aquí se copia en cuanto aparece.
--   · Etapa: se traduce con `mapeo_estatus`. Con fecha de visita, una
--     etapa que daría "aceptada" da "visita_agendada".
--   · "Cancelado": NO cancela. Levanta una alerta para que super_admin
--     confirme en Tasa, que es quien sabe si borrar la comisión o
--     meter un cargo.
-- ============================================================

create table alertas (
  id            uuid primary key default gen_random_uuid(),
  tipo          text not null check (tipo in ('cancelado_en_notion')),
  solicitud_id  uuid not null references solicitudes(id) on delete cascade,
  mensaje       text not null,
  creada_en     timestamptz not null default now(),
  resuelta_en   timestamptz,
  resuelta_por  uuid references personas(id) on delete set null,
  resolucion    text
);

-- Una sola alerta abierta por trabajo y tipo: leer Notion cada 15
-- minutos no puede llenar el panel con la misma alerta.
create unique index alertas_una_abierta
  on alertas (solicitud_id, tipo) where resuelta_en is null;

create trigger bitacora after insert or update or delete on alertas
  for each row execute function registrar_bitacora();

-- ------------------------------------------------------------
-- 1. LA LECTURA
-- ------------------------------------------------------------
-- Devuelve qué pasó, para que el cron lo registre:
--   'sin_trabajo' · 'sin_cambios' · 'actualizado' · 'alerta'

create or replace function registrar_lectura_notion(
  p_notion_page_id text,
  p_titulo         text,
  p_etapa          text,
  p_fecha_visita   date
)
returns text language plpgsql security definer set search_path = public as $$
declare
  s          solicitudes%rowtype;
  v_folio    text;
  v_estatus  text;
  v_alerta   boolean := false;
begin
  -- El cron entra con la llave de servicio (sin usuario); el botón
  -- "actualizar", con la sesión del staff. Nadie más.
  if auth.uid() is not null and not soy_staff() then
    raise exception 'Solo el staff actualiza desde Notion';
  end if;

  select * into s from solicitudes where notion_page_id = p_notion_page_id for update;
  if not found then
    return 'sin_trabajo';
  end if;

  v_folio := coalesce(substring(p_titulo from 'MGP-[0-9]{4}-[0-9]{4}'), s.folio);

  v_estatus := s.estatus_publico;
  if p_etapa = 'Cancelado' then
    if s.estado <> 'cancelada' then
      insert into alertas (tipo, solicitud_id, mensaje)
      values ('cancelado_en_notion', s.id,
              'Cancelado en Notion, confirmar en Tasa: '
              || coalesce(v_folio, 'sin folio') || ' · ' || s.cliente_nombre)
      on conflict (solicitud_id, tipo) where resuelta_en is null do nothing;
      v_alerta := found;
    end if;
  elsif s.estado = 'tramite' and s.estatus_publico not in ('pagado', 'cancelada') then
    select estatus_publico into v_estatus from mapeo_estatus where etapa_notion = p_etapa;
    if v_estatus = 'aceptada' and p_fecha_visita is not null then
      v_estatus := 'visita_agendada';
    end if;
    -- Etapa desconocida: el estatus se queda quieto.
    v_estatus := coalesce(v_estatus, s.estatus_publico);
  end if;

  update solicitudes
     set folio           = v_folio,
         estatus_notion  = p_etapa,
         estatus_publico = v_estatus,
         notion_leido_en = now()
   where id = s.id;

  if v_alerta then
    return 'alerta';
  elsif v_folio is distinct from s.folio
     or v_estatus is distinct from s.estatus_publico
     or p_etapa is distinct from s.estatus_notion then
    return 'actualizado';
  end if;
  return 'sin_cambios';
end;
$$;

revoke all on function registrar_lectura_notion(text, text, text, date) from public, anon;
grant execute on function registrar_lectura_notion(text, text, text, date) to authenticated;

-- ------------------------------------------------------------
-- 2. CERRAR LA ALERTA
-- ------------------------------------------------------------
-- Se cierra sola al cancelar el trabajo en Tasa. Si Notion se
-- equivocó, super_admin la descarta con una nota (desde el panel).

create or replace function cerrar_alertas_al_cancelar()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.estado = 'cancelada' and old.estado is distinct from 'cancelada' then
    update alertas
       set resuelta_en = now(), resuelta_por = mi_persona_id(),
           resolucion = 'Trabajo cancelado en Tasa'
     where solicitud_id = new.id and resuelta_en is null;
  end if;
  return null;
end;
$$;

create trigger al_cancelar_cierra_alertas
  after update of estado on solicitudes
  for each row execute function cerrar_alertas_al_cancelar();

create or replace function descartar_alerta(p_alerta uuid, p_nota text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not soy_super_admin() then
    raise exception 'Solo super_admin descarta alertas';
  end if;
  if nullif(trim(p_nota), '') is null then
    raise exception 'Hace falta una nota de por qué se descarta';
  end if;
  update alertas
     set resuelta_en = now(), resuelta_por = mi_persona_id(), resolucion = p_nota
   where id = p_alerta and resuelta_en is null;
end;
$$;

revoke all on function descartar_alerta(uuid, text) from public, anon;
grant execute on function descartar_alerta(uuid, text) to authenticated;

-- ------------------------------------------------------------
-- 3. RLS
-- ------------------------------------------------------------

alter table alertas enable row level security;
revoke all on alertas from anon;

create policy staff_lee_alertas on alertas for select using (soy_staff());
-- Nadie las escribe directo: nacen de la lectura y se cierran por función.
revoke insert, update, delete on alertas from authenticated;
