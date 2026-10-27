-- ============================================================
-- 0001 — BASE
-- Personas, comisionistas, marcas, cuentas receptoras, servicios,
-- utilidades de fecha y la bitácora.
--
-- Tasa es un solo negocio: no hay columna de empresa (D-009 de la
-- propuesta). El RLS se amarra a la persona y a su rol.
-- ============================================================

-- ------------------------------------------------------------
-- 1. FECHAS
-- ------------------------------------------------------------
-- Todo corte se mide en hora de la Ciudad de México. El servidor de
-- Supabase vive en UTC: el 31 a las 20:00 de aquí ya es el día 1 allá.
-- Si alguna consulta usa `current_date` a secas, un pago de la noche
-- del 31 cae en el mes equivocado.

create or replace function hoy_mx()
returns date language sql stable as $$
  select (now() at time zone 'America/Mexico_City')::date;
$$;

-- El primer día del mes de una fecha. Los meses se guardan siempre así.
create or replace function mes_de(p_fecha date)
returns date language sql immutable as $$
  select date_trunc('month', p_fecha)::date;
$$;

-- ------------------------------------------------------------
-- 2. PERSONAS
-- ------------------------------------------------------------
-- Toda persona que entra al portal. Nadie se registra solo: el
-- super_admin da de alta el correo y el acceso solo amarra el usuario
-- de autenticación a esta fila (ver 0005).

create table personas (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid unique references auth.users(id) on delete set null,
  nombre     text not null,
  correo     text not null,
  telefono   text,
  rol        text not null check (rol in ('super_admin', 'finanzas', 'comisionista')),
  activo     boolean not null default true,
  creado_en  timestamptz not null default now()
);

create unique index personas_correo_unico on personas (lower(correo));

-- Lo propio de quien vende. Una fila por persona con rol comisionista.
create table comisionistas (
  persona_id          uuid primary key references personas(id) on delete restrict,
  -- Para la futura tarjeta: tasa.xgplataform.com/t/<slug>. Sin UI en el MVP.
  slug                text not null unique
                        check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  -- Quién lo trajo. Fase 2; en el MVP siempre vacío.
  referido_por        uuid references comisionistas(persona_id) on delete set null,
  -- Élite: si tiene valor, este porcentaje manda sobre el calculado.
  -- Nunca más de 30: es el tope total por trabajo.
  porcentaje_forzado  numeric(5,2)
                        check (porcentaje_forzado is null
                               or (porcentaje_forzado > 0 and porcentaje_forzado <= 30)),
  -- Desde aquí cuentan los meses del promedio (meses en cero incluidos).
  fecha_alta          date not null default hoy_mx(),
  check (referido_por is distinct from persona_id)
);

-- Un comisionista tiene que ser una persona con ese rol. Sin esto,
-- Gaby podría acabar con nivel y estado de cuenta.
create or replace function validar_comisionista()
returns trigger language plpgsql as $$
begin
  if not exists (
    select 1 from personas where id = new.persona_id and rol = 'comisionista'
  ) then
    raise exception 'La persona % no tiene rol de comisionista', new.persona_id;
  end if;
  return new;
end;
$$;

create trigger al_guardar_comisionista
  before insert or update on comisionistas
  for each row execute function validar_comisionista();

-- ------------------------------------------------------------
-- 3. MARCAS Y CUENTAS RECEPTORAS
-- ------------------------------------------------------------
-- Marca = quien ejecuta el trabajo (MGP, AP73, Arqos, XG).
-- Cuenta receptora = a nombre de quién entra el dinero. No son lo
-- mismo: ROMI es titular de la cuenta de MGP, no una marca.

create table marcas (
  id                  uuid primary key default gen_random_uuid(),
  clave               text not null unique,
  nombre              text not null,
  cuenta_sugerida_id  uuid,   -- se amarra abajo, cuando existe la tabla
  activa              boolean not null default true
);

create table cuentas_receptoras (
  id         uuid primary key default gen_random_uuid(),
  titular    text not null,
  banco      text,                 -- nulo = por definir
  clabe      text not null check (clabe ~ '^[0-9]{18}$'),
  rfc        text,
  marca_id   uuid not null references marcas(id) on delete restrict,
  activa     boolean not null default true,
  creado_en  timestamptz not null default now()
);

alter table marcas
  add constraint marcas_cuenta_sugerida_fk
  foreign key (cuenta_sugerida_id) references cuentas_receptoras(id) on delete set null;

-- Catálogo de servicios. El nombre es el mismo que la opción de
-- "Tipo de Trámite" en Notion, para que la página nazca bien clasificada.
create table servicios (
  id      uuid primary key default gen_random_uuid(),
  nombre  text not null unique,
  orden   smallint not null default 0,
  activo  boolean not null default true
);

-- ------------------------------------------------------------
-- 4. QUIÉN SOY
-- ------------------------------------------------------------
-- Las políticas preguntan por el rol a través de estas funciones.
-- Son `security definer` para poder leer `personas` sin que la
-- política de `personas` se llame a sí misma.

create or replace function mi_persona_id()
returns uuid language sql stable security definer set search_path = public as $$
  select id from personas where user_id = auth.uid() and activo;
$$;

create or replace function mi_rol()
returns text language sql stable security definer set search_path = public as $$
  select rol from personas where user_id = auth.uid() and activo;
$$;

create or replace function soy_staff()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(mi_rol() in ('super_admin', 'finanzas'), false);
$$;

create or replace function soy_super_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(mi_rol() = 'super_admin', false);
$$;

revoke all on function mi_persona_id(), mi_rol(), soy_staff(), soy_super_admin()
  from public, anon;
grant execute on function mi_persona_id(), mi_rol(), soy_staff(), soy_super_admin()
  to authenticated;

-- ------------------------------------------------------------
-- 5. BITÁCORA
-- ------------------------------------------------------------
-- La llena un disparador, no la aplicación: así no depende de que
-- alguien se acuerde de llamarla en cada botón. Guarda todo cambio,
-- de quien sea; la persona nula es el sistema (cron o editor SQL).

create table bitacora (
  id           bigint generated always as identity primary key,
  persona_id   uuid references personas(id) on delete set null,
  rol          text,
  accion       text not null check (accion in ('INSERT', 'UPDATE', 'DELETE')),
  tabla        text not null,
  registro_id  text,
  antes        jsonb,
  despues      jsonb,
  creado_en    timestamptz not null default now()
);

create index on bitacora (tabla, registro_id);
create index on bitacora (creado_en desc);

create or replace function registrar_bitacora()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_antes   jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  v_despues jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  v_fila    jsonb := coalesce(v_despues, v_antes);
begin
  -- Un UPDATE que no cambió nada no es una acción.
  if tg_op = 'UPDATE' and v_antes = v_despues then
    return null;
  end if;

  insert into bitacora (persona_id, rol, accion, tabla, registro_id, antes, despues)
  values (
    mi_persona_id(),
    mi_rol(),
    tg_op,
    tg_table_name,
    coalesce(v_fila->>'id', v_fila->>'persona_id', v_fila->>'etapa_notion'),
    v_antes,
    v_despues
  );
  return null;
end;
$$;

create trigger bitacora after insert or update or delete on personas
  for each row execute function registrar_bitacora();
create trigger bitacora after insert or update or delete on comisionistas
  for each row execute function registrar_bitacora();
create trigger bitacora after insert or update or delete on marcas
  for each row execute function registrar_bitacora();
create trigger bitacora after insert or update or delete on cuentas_receptoras
  for each row execute function registrar_bitacora();
create trigger bitacora after insert or update or delete on servicios
  for each row execute function registrar_bitacora();

-- ------------------------------------------------------------
-- 6. RLS
-- ------------------------------------------------------------

alter table personas            enable row level security;
alter table comisionistas       enable row level security;
alter table marcas              enable row level security;
alter table cuentas_receptoras  enable row level security;
alter table servicios           enable row level security;
alter table bitacora            enable row level security;

revoke all on personas, comisionistas, marcas, cuentas_receptoras, servicios, bitacora
  from anon;

-- personas: cada quien la suya; el staff, todas. Solo super_admin da de alta.
create policy leer_personas on personas for select
  using (id = mi_persona_id() or soy_staff());
create policy admin_personas on personas for all
  using (soy_super_admin()) with check (soy_super_admin());

create policy leer_comisionistas on comisionistas for select
  using (persona_id = mi_persona_id() or soy_staff());
create policy admin_comisionistas on comisionistas for all
  using (soy_super_admin()) with check (soy_super_admin());

-- Catálogos: cualquiera con sesión los lee, solo super_admin los toca.
create policy leer_marcas on marcas for select to authenticated using (true);
create policy admin_marcas on marcas for all
  using (soy_super_admin()) with check (soy_super_admin());

create policy leer_servicios on servicios for select to authenticated using (true);
create policy admin_servicios on servicios for all
  using (soy_super_admin()) with check (soy_super_admin());

-- Cuentas: el staff ve el catálogo; el comisionista, solo las cuentas
-- de sus propios trabajos (la política vive en 0002, cuando existen).
create policy staff_lee_cuentas on cuentas_receptoras for select
  using (soy_staff());
create policy admin_cuentas on cuentas_receptoras for all
  using (soy_super_admin()) with check (soy_super_admin());

-- Bitácora: solo se lee, y solo super_admin. Nadie escribe a mano.
create policy leer_bitacora on bitacora for select using (soy_super_admin());
revoke insert, update, delete on bitacora from authenticated;
