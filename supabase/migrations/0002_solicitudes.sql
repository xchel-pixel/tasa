-- ============================================================
-- 0002 — SOLICITUDES, COTIZACIONES Y ESTATUS
--
-- Una solicitud es la misma fila de principio a fin: nace como
-- "solicitada", puede cotizarse, y al aceptarse se vuelve trámite con
-- los mismos datos. No se copia a otra tabla: copiar es la forma más
-- rápida de tener dos montos distintos para el mismo trabajo.
--
-- Dos estados distintos, a propósito:
--   · `estado`: el ciclo de vida en Tasa (solicitada, cotizada,
--     vencida, tramite, cancelada). Decide qué se puede hacer.
--   · `estatus_publico`: lo que ve el comisionista. Lo mueve Tasa
--     hasta "aceptada" y en "pagado"; en medio lo traduce Notion
--     a través de `mapeo_estatus`.
-- ============================================================

-- Los estatus que ve el comisionista, en orden. "vencida" y
-- "cancelada" quedan fuera de la progresión pero hacen falta: una
-- cotización vencida que siguiera diciendo "Cotizada" sería mentira.
create or replace function estatus_publicos()
returns text[] language sql immutable as $$
  select array['solicitada', 'cotizada', 'aceptada', 'visita_agendada',
               'en_elaboracion', 'en_revision', 'entregado', 'pagado',
               'vencida', 'cancelada'];
$$;

-- ------------------------------------------------------------
-- 1. SOLICITUDES
-- ------------------------------------------------------------

create table solicitudes (
  id                    uuid primary key default gen_random_uuid(),
  comisionista_id       uuid not null references comisionistas(persona_id) on delete restrict,
  tipo                  text not null check (tipo in ('cotizacion', 'tramite_directo')),
  -- En el MVP solo 'portal' o 'admin'. 'tarjeta' y 'referido' son fase 2.
  origen                text not null default 'portal'
                          check (origen in ('portal', 'tarjeta', 'referido', 'admin')),
  servicio_id           uuid not null references servicios(id) on delete restrict,

  -- El inmueble
  inmueble_direccion    text not null,
  inmueble_municipio    text,
  inmueble_clave_catastral text,
  inmueble_descripcion  text,

  -- El cliente final
  cliente_nombre        text not null,
  cliente_telefono      text,
  cliente_correo        text,

  -- Lo que pone el staff
  marca_id              uuid references marcas(id) on delete restrict,
  cuenta_receptora_id   uuid references cuentas_receptoras(id) on delete restrict,
  requiere_factura      boolean not null default false,
  -- Base de comisión, sin IVA.
  monto_honorarios      numeric(12,2) check (monto_honorarios >= 0),
  -- Derechos y gestorías. Se cobran al cliente, no generan comisión.
  monto_terceros        numeric(12,2) not null default 0 check (monto_terceros >= 0),
  -- El IVA va solo sobre honorarios y solo si hay factura.
  monto_iva             numeric(12,2) generated always as (
                          case when requiere_factura
                               then round(coalesce(monto_honorarios, 0) * 0.16, 2)
                               else 0 end
                        ) stored,
  monto_total           numeric(12,2) generated always as (
                          coalesce(monto_honorarios, 0)
                          + case when requiere_factura
                                 then round(coalesce(monto_honorarios, 0) * 0.16, 2)
                                 else 0 end
                          + monto_terceros
                        ) stored,

  estado                text not null default 'solicitada'
                          check (estado in ('solicitada', 'cotizada', 'vencida', 'tramite', 'cancelada')),
  estatus_publico       text not null default 'solicitada'
                          check (estatus_publico = any (estatus_publicos())),

  -- Notion: la única fuente del folio. Tasa nunca lo inventa.
  folio                 text unique,
  notion_page_id        text unique,
  estatus_notion        text,           -- la "Etapa" tal cual viene de Notion
  notion_leido_en       timestamptz,

  aceptada_en           timestamptz,
  cancelada_en          timestamptz,
  motivo_cancelacion    text,

  -- Fecha del pago que completó el 100% (fecha del pago, no de la
  -- confirmación). Define el mes, pero no siempre es el mes de cierre:
  -- si ese mes ya estaba aprobado, el trabajo cae en el siguiente abierto.
  pagado_en             date,
  mes_cierre            date check (mes_cierre = mes_de(mes_cierre)),

  creado_por            uuid references personas(id) on delete set null,
  creado_en             timestamptz not null default now(),
  actualizado_en        timestamptz not null default now(),

  check ((pagado_en is null) = (mes_cierre is null)),
  check (estado <> 'tramite' or monto_honorarios is not null)
);

create index on solicitudes (comisionista_id, creado_en desc);
create index on solicitudes (estado);
create index on solicitudes (mes_cierre) where mes_cierre is not null;

-- ------------------------------------------------------------
-- 2. COTIZACIONES
-- ------------------------------------------------------------
-- Puede haber varias por solicitud (se recotiza), pero una sola viva.
-- Al aceptarse, sus montos y su cuenta se copian a la solicitud: desde
-- ese momento la solicitud es la verdad y la cotización es historia.

create table cotizaciones (
  id                   uuid primary key default gen_random_uuid(),
  solicitud_id         uuid not null references solicitudes(id) on delete cascade,
  requiere_factura     boolean not null default false,
  monto_honorarios     numeric(12,2) not null check (monto_honorarios > 0),
  monto_terceros       numeric(12,2) not null default 0 check (monto_terceros >= 0),
  monto_iva            numeric(12,2) generated always as (
                         case when requiere_factura then round(monto_honorarios * 0.16, 2) else 0 end
                       ) stored,
  monto_total          numeric(12,2) generated always as (
                         monto_honorarios
                         + case when requiere_factura then round(monto_honorarios * 0.16, 2) else 0 end
                         + monto_terceros
                       ) stored,
  cuenta_receptora_id  uuid not null references cuentas_receptoras(id) on delete restrict,
  vigente_hasta        date not null,
  pdf_ruta             text,
  estado               text not null default 'emitida'
                         check (estado in ('emitida', 'aceptada', 'vencida', 'reemplazada')),
  emitida_por          uuid references personas(id) on delete set null,
  emitida_en           timestamptz not null default now(),
  respondida_en        timestamptz
);

create unique index cotizaciones_una_viva
  on cotizaciones (solicitud_id) where estado in ('emitida', 'aceptada');

-- ------------------------------------------------------------
-- 3. MAPEO DE ESTATUS
-- ------------------------------------------------------------
-- La "Etapa" de Notion → el estatus que ve el comisionista. Lo edita
-- super_admin. Si Notion trae una etapa que no está aquí, el estatus
-- público no se mueve (mejor quieto que inventado).

create table mapeo_estatus (
  etapa_notion     text primary key,
  estatus_publico  text not null check (estatus_publico = any (estatus_publicos())),
  actualizado_en   timestamptz not null default now()
);

-- ------------------------------------------------------------
-- 4. HISTORIAL DE ESTATUS
-- ------------------------------------------------------------
-- Cada cambio del estatus público. `notificado_en` nulo = falta mandar
-- el correo al comisionista; el cron lo manda y lo marca.

create table historial_estatus (
  id               bigint generated always as identity primary key,
  solicitud_id     uuid not null references solicitudes(id) on delete cascade,
  estatus_publico  text not null check (estatus_publico = any (estatus_publicos())),
  desde            timestamptz not null default now(),
  notificado_en    timestamptz
);

create index on historial_estatus (solicitud_id, desde);
create index historial_por_notificar on historial_estatus (desde) where notificado_en is null;

-- ------------------------------------------------------------
-- 5. REGLAS DE LA SOLICITUD
-- ------------------------------------------------------------

create or replace function reglas_solicitud()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_confirmados integer;
begin
  new.actualizado_en := now();

  if tg_op = 'UPDATE' then
    -- "Pagado" y "Cancelada" los decide Tasa. Una lectura de Notion
    -- que llegue después no los puede pisar.
    if old.estatus_publico in ('pagado', 'cancelada')
       and new.estatus_publico is distinct from old.estatus_publico
       and new.estado = old.estado
       and new.pagado_en is not distinct from old.pagado_en then
      new.estatus_publico := old.estatus_publico;
    end if;

    -- Un trabajo pagado ya devengó comisión sobre estos montos.
    if old.pagado_en is not null and (
         new.monto_honorarios is distinct from old.monto_honorarios
      or new.monto_terceros   is distinct from old.monto_terceros
      or new.requiere_factura is distinct from old.requiere_factura
    ) then
      raise exception 'El trabajo ya está pagado: sus montos no se pueden cambiar';
    end if;

    -- Cambiar la cuenta con dinero ya confirmado: solo super_admin.
    -- La bitácora guarda el antes y el después.
    if new.cuenta_receptora_id is distinct from old.cuenta_receptora_id then
      select count(*) into v_confirmados
        from pagos where solicitud_id = new.id and estado = 'confirmado';
      if v_confirmados > 0 and not soy_super_admin() and auth.uid() is not null then
        raise exception 'Este trabajo ya tiene pagos confirmados: solo super_admin puede cambiar la cuenta';
      end if;
    end if;
  end if;

  return new;
end;
$$;

-- La tabla de pagos nace en 0003; la función se resuelve al correr.
create trigger al_guardar_solicitud
  before insert or update on solicitudes
  for each row execute function reglas_solicitud();

create or replace function anotar_historial()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' or new.estatus_publico is distinct from old.estatus_publico then
    insert into historial_estatus (solicitud_id, estatus_publico)
    values (new.id, new.estatus_publico);
  end if;
  return null;
end;
$$;

create trigger al_cambiar_estatus
  after insert or update of estatus_publico on solicitudes
  for each row execute function anotar_historial();

create trigger bitacora after insert or update or delete on solicitudes
  for each row execute function registrar_bitacora();
create trigger bitacora after insert or update or delete on cotizaciones
  for each row execute function registrar_bitacora();
create trigger bitacora after insert or update or delete on mapeo_estatus
  for each row execute function registrar_bitacora();

-- ------------------------------------------------------------
-- 6. EMITIR, ACEPTAR Y VENCER
-- ------------------------------------------------------------

-- Emitir una cotización nueva reemplaza la viva y deja la solicitud en
-- "cotizada". Va en la base para que el reemplazo y el cambio de
-- estado no puedan quedar a medias.
create or replace function al_emitir_cotizacion()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_estado text;
begin
  select estado into v_estado from solicitudes where id = new.solicitud_id for update;
  if v_estado not in ('solicitada', 'cotizada', 'vencida') then
    raise exception 'La solicitud está en "%": ya no se cotiza', v_estado;
  end if;

  update cotizaciones
     set estado = 'reemplazada', respondida_en = now()
   where solicitud_id = new.solicitud_id and estado = 'emitida';

  update solicitudes
     set estado = 'cotizada', estatus_publico = 'cotizada'
   where id = new.solicitud_id;

  return new;
end;
$$;

create trigger al_emitir
  before insert on cotizaciones
  for each row execute function al_emitir_cotizacion();

-- El comisionista acepta su cotización. La página de Notion la crea la
-- aplicación después; mientras no exista, el estatus es "aceptada".
create or replace function aceptar_cotizacion(p_cotizacion uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  c cotizaciones%rowtype;
  s solicitudes%rowtype;
begin
  select * into c from cotizaciones where id = p_cotizacion for update;
  if not found then
    raise exception 'No existe esa cotización';
  end if;

  select * into s from solicitudes where id = c.solicitud_id for update;
  if s.comisionista_id is distinct from mi_persona_id() and not soy_staff() then
    raise exception 'Esa cotización no es tuya';
  end if;
  if c.estado <> 'emitida' then
    raise exception 'La cotización ya no está vigente';
  end if;
  if c.vigente_hasta < hoy_mx() then
    raise exception 'La cotización venció el %', c.vigente_hasta;
  end if;

  update cotizaciones
     set estado = 'aceptada', respondida_en = now()
   where id = c.id;

  update solicitudes
     set estado              = 'tramite',
         estatus_publico     = 'aceptada',
         aceptada_en         = now(),
         requiere_factura    = c.requiere_factura,
         monto_honorarios    = c.monto_honorarios,
         monto_terceros      = c.monto_terceros,
         cuenta_receptora_id = c.cuenta_receptora_id
   where id = s.id;
end;
$$;

-- La corre el cron. Idempotente: lo vencido ya no vuelve a vencer.
create or replace function vencer_cotizaciones()
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_total integer;
begin
  with vencidas as (
    update cotizaciones
       set estado = 'vencida', respondida_en = now()
     where estado = 'emitida' and vigente_hasta < hoy_mx()
    returning solicitud_id
  )
  update solicitudes s
     set estado = 'vencida', estatus_publico = 'vencida'
    from vencidas v
   where s.id = v.solicitud_id and s.estado = 'cotizada';

  get diagnostics v_total = row_count;
  return v_total;
end;
$$;

revoke all on function aceptar_cotizacion(uuid), vencer_cotizaciones() from public, anon;
grant execute on function aceptar_cotizacion(uuid) to authenticated;
-- vencer_cotizaciones solo la llama el cron con la llave de servicio.

-- ------------------------------------------------------------
-- 7. RLS
-- ------------------------------------------------------------

alter table solicitudes        enable row level security;
alter table cotizaciones       enable row level security;
alter table mapeo_estatus      enable row level security;
alter table historial_estatus  enable row level security;

revoke all on solicitudes, cotizaciones, mapeo_estatus, historial_estatus from anon;

create policy leer_solicitudes on solicitudes for select
  using (comisionista_id = mi_persona_id() or soy_staff());

-- El comisionista solo pide: sin montos, sin cuenta, sin marca, sin
-- folio. Todo eso lo pone el staff.
create policy pedir_solicitud on solicitudes for insert
  with check (
    comisionista_id = mi_persona_id()
    and mi_rol() = 'comisionista'
    and origen = 'portal'
    and estado = 'solicitada'
    and estatus_publico = 'solicitada'
    and monto_honorarios is null
    and monto_terceros = 0
    and marca_id is null
    and cuenta_receptora_id is null
    and folio is null
    and notion_page_id is null
    and pagado_en is null
  );

create policy staff_solicitudes on solicitudes for all
  using (soy_staff()) with check (soy_staff());

create policy leer_cotizaciones on cotizaciones for select
  using (
    soy_staff()
    or solicitud_id in (select id from solicitudes where comisionista_id = mi_persona_id())
  );
create policy staff_cotizaciones on cotizaciones for all
  using (soy_staff()) with check (soy_staff());

create policy leer_mapeo on mapeo_estatus for select to authenticated using (true);
create policy admin_mapeo on mapeo_estatus for all
  using (soy_super_admin()) with check (soy_super_admin());

create policy leer_historial on historial_estatus for select
  using (
    soy_staff()
    or solicitud_id in (select id from solicitudes where comisionista_id = mi_persona_id())
  );
revoke insert, update, delete on historial_estatus from authenticated;

-- La CLABE de sus propios trabajos y cotizaciones: la necesita para
-- decirle al cliente dónde depositar.
create policy comisionista_lee_sus_cuentas on cuentas_receptoras for select
  using (
    id in (select cuenta_receptora_id from solicitudes where comisionista_id = mi_persona_id())
    or id in (
      select c.cuenta_receptora_id
        from cotizaciones c join solicitudes s on s.id = c.solicitud_id
       where s.comisionista_id = mi_persona_id()
    )
  );
