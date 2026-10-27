-- ============================================================
-- 0015 — MULTI-ORGANIZACIÓN: ESTRUCTURA
--
-- Tasa deja de ser un solo negocio. Dos niveles:
--   · ORGANIZACIÓN: aislamiento total. Toda tabla de negocio lleva
--     `organizacion_id` y las llaves compuestas (organización + id)
--     impiden que una fila apunte a algo de otra organización.
--   · MARCA: dentro de la organización. Comparten comisionistas y
--     niveles; el rol `admin_marca` opera solo las suyas.
--
-- Personas: identidad global (un correo). Lo que hace en cada
-- organización lo dice su MEMBRESÍA (rol, activa). `super_plataforma`
-- es aparte: da de alta organizaciones y entra a todas.
--
-- Lo que ya existía pasa completo a la organización "XG", con id fijo
-- para que la semilla y las pruebas la encuentren.
--
-- Este archivo solo cambia estructura y datos. Las funciones van en
-- 0016, las políticas en 0017 y los conectores en 0018.
-- ============================================================

-- ------------------------------------------------------------
-- 0. AYUDANTES DE ESTA MIGRACIÓN
-- ------------------------------------------------------------
-- Los nombres de las restricciones viejas los puso Postgres; se
-- buscan por tabla y columna en vez de adivinarlos.

create function pg_temp.quitar_fk(p_tabla text, p_columna text) returns void language plpgsql as $$
declare
  r record;
begin
  for r in
    select c.conname from pg_constraint c
     where c.conrelid = ('public.' || p_tabla)::regclass and c.contype = 'f'
       and c.conkey = array[(select attnum from pg_attribute
                              where attrelid = ('public.' || p_tabla)::regclass and attname = p_columna)]
  loop
    execute format('alter table %I drop constraint %I', p_tabla, r.conname);
  end loop;
end;
$$;

create function pg_temp.quitar_unica(p_tabla text, p_columnas text[]) returns void language plpgsql as $$
declare
  r record;
begin
  for r in
    select c.conname from pg_constraint c
     where c.conrelid = ('public.' || p_tabla)::regclass and c.contype = 'u'
       and (select array_agg(a.attname::text order by a.attname)
              from pg_attribute a where a.attrelid = c.conrelid and a.attnum = any (c.conkey))
           = (select array_agg(x order by x) from unnest(p_columnas) x)
  loop
    execute format('alter table %I drop constraint %I', p_tabla, r.conname);
  end loop;
end;
$$;

-- ------------------------------------------------------------
-- 1. ORGANIZACIONES Y PLATAFORMA
-- ------------------------------------------------------------

create table organizaciones (
  id              uuid primary key default gen_random_uuid(),
  nombre          text not null check (char_length(trim(nombre)) between 1 and 80),
  slug            text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  activa          boolean not null default true,
  plan            text,
  notas           text,
  -- Folio que genera Tasa cuando el conector es manual: PREFIJO-AAAA-NNNN.
  prefijo_folio   text not null check (prefijo_folio ~ '^[A-Z0-9]{2,6}$'),
  -- Identidad (el tema por organización se aplica después).
  color_primario  text check (color_primario ~ '^#[0-9a-fA-F]{6}$'),
  logo_ruta       text,
  creado_en       timestamptz not null default now()
);

-- XG: Xchel, sus marcas y todo lo que ya existía. Paleta MGP 2026.
insert into organizaciones (id, nombre, slug, prefijo_folio, color_primario)
values ('a0000000-0000-4000-8000-000000000001', 'XG', 'xg', 'MGP', '#04386c');

-- Lo que vive por encima de las organizaciones. Una sola fila.
create table ajustes_plataforma (
  id                boolean primary key default true check (id),
  -- Lo ve quien todavía no entra (no se sabe de qué organización es).
  contacto_soporte  text check (char_length(contacto_soporte) <= 120)
);
insert into ajustes_plataforma (contacto_soporte) select contacto_soporte from ajustes;

-- ------------------------------------------------------------
-- 2. PERSONAS Y MEMBRESÍAS
-- ------------------------------------------------------------

alter table personas
  add column super_plataforma boolean not null default false,
  -- La organización con la que está trabajando. La lee el RLS.
  add column organizacion_activa uuid references organizaciones(id) on delete set null;

create table membresias (
  id               uuid primary key default gen_random_uuid(),
  persona_id       uuid not null references personas(id) on delete restrict,
  organizacion_id  uuid not null references organizaciones(id) on delete restrict,
  rol              text not null check (rol in ('admin_org', 'finanzas', 'admin_marca', 'equipo', 'comisionista')),
  activa           boolean not null default true,
  creado_en        timestamptz not null default now(),
  unique (persona_id, organizacion_id),
  unique (organizacion_id, id)
);

create index on membresias (organizacion_id, rol);

-- Lo de antes, en XG: super_admin → admin_org (y super_plataforma).
insert into membresias (persona_id, organizacion_id, rol, activa)
select id, 'a0000000-0000-4000-8000-000000000001',
       case rol when 'super_admin' then 'admin_org' else rol end, activo
  from personas;
update personas set super_plataforma = (rol = 'super_admin'),
                    organizacion_activa = 'a0000000-0000-4000-8000-000000000001';

-- ------------------------------------------------------------
-- 3. LA ORGANIZACIÓN EN TODAS LAS TABLAS DE NEGOCIO
-- ------------------------------------------------------------
-- Con un valor constante la columna nace llena sin reescribir filas ni
-- disparar nada. Después el valor por omisión pasa a ser la
-- organización activa de quien inserta (0016).

do $$
declare
  t text;
begin
  foreach t in array array[
    'marcas', 'cuentas_receptoras', 'servicios', 'niveles', 'comisionistas', 'solicitudes',
    'cotizaciones', 'mapeo_estatus', 'historial_estatus', 'cierres', 'niveles_mensuales',
    'comisiones', 'pagos', 'alertas', 'ajustes', 'origenes_pago', 'pendientes_comision',
    'pagos_comision', 'aplicaciones_pago_comision'
  ] loop
    execute format(
      'alter table %I add column organizacion_id uuid not null
         default %L references organizaciones(id) on delete restrict', t,
      'a0000000-0000-4000-8000-000000000001');
    execute format('create index on %I (organizacion_id)', t);
  end loop;
end;
$$;

-- La bitácora puede tener filas de plataforma (sin organización).
alter table bitacora add column organizacion_id uuid references organizaciones(id) on delete restrict;
update bitacora set organizacion_id = 'a0000000-0000-4000-8000-000000000001';
create index on bitacora (organizacion_id, creado_en desc);

-- ------------------------------------------------------------
-- 4. ÚNICOS POR ORGANIZACIÓN
-- ------------------------------------------------------------

select pg_temp.quitar_unica('marcas', array['clave']);
alter table marcas add unique (organizacion_id, clave);
select pg_temp.quitar_unica('servicios', array['nombre']);
alter table servicios add unique (organizacion_id, nombre);
select pg_temp.quitar_unica('niveles', array['nombre']);
select pg_temp.quitar_unica('niveles', array['orden']);
alter table niveles add unique (organizacion_id, nombre), add unique (organizacion_id, orden);
alter table cuentas_receptoras drop constraint cuentas_alias_unico;
alter table cuentas_receptoras add constraint cuentas_alias_unico unique (organizacion_id, alias);
select pg_temp.quitar_unica('cierres', array['mes']);
alter table cierres add unique (organizacion_id, mes);
select pg_temp.quitar_unica('comisionistas', array['slug']);
alter table comisionistas add unique (organizacion_id, slug);
select pg_temp.quitar_unica('origenes_pago', array['nombre']);
alter table origenes_pago add unique (organizacion_id, nombre);
select pg_temp.quitar_unica('pendientes_comision', array['comisionista_id', 'mes']);
alter table pendientes_comision add unique (organizacion_id, comisionista_id, mes);

-- Folio: cada organización con su prefijo; único dentro de ella.
select pg_temp.quitar_unica('solicitudes', array['folio']);
alter table solicitudes drop constraint solicitudes_folio_check;
alter table solicitudes
  add constraint solicitudes_folio_check check (folio ~ '^[A-Z0-9]{2,6}-[0-9]{4}-[0-9]{4}$'),
  add unique (organizacion_id, folio);

-- ------------------------------------------------------------
-- 5. NOMBRES GENÉRICOS (ya no todo viene de Notion)
-- ------------------------------------------------------------

select pg_temp.quitar_unica('solicitudes', array['notion_page_id']);
alter table solicitudes rename column notion_page_id to externo_id;
alter table solicitudes rename column estatus_notion to estatus_externo;
alter table solicitudes rename column notion_leido_en to externo_leido_en;
alter table solicitudes add unique (organizacion_id, externo_id);

-- ------------------------------------------------------------
-- 6. LLAVES COMPUESTAS: NADA APUNTA A OTRA ORGANIZACIÓN
-- ------------------------------------------------------------

alter table marcas              add unique (organizacion_id, id);
alter table cuentas_receptoras  add unique (organizacion_id, id);
alter table servicios           add unique (organizacion_id, id);
alter table niveles             add unique (organizacion_id, id);
alter table solicitudes         add unique (organizacion_id, id);
alter table cierres             add unique (organizacion_id, id);
alter table comisiones          add unique (organizacion_id, id);
alter table origenes_pago       add unique (organizacion_id, id);
alter table pendientes_comision add unique (organizacion_id, id);
alter table pagos_comision      add unique (organizacion_id, id);

-- Comisionistas: el perfil es por organización. La misma persona puede
-- serlo en dos, con niveles y saldos separados.
select pg_temp.quitar_fk('solicitudes', 'comisionista_id');
select pg_temp.quitar_fk('comisiones', 'comisionista_id');
select pg_temp.quitar_fk('niveles_mensuales', 'comisionista_id');
select pg_temp.quitar_fk('pendientes_comision', 'comisionista_id');
select pg_temp.quitar_fk('pagos_comision', 'comisionista_id');
select pg_temp.quitar_fk('comisionistas', 'referido_por');
alter table comisionistas drop constraint comisionistas_pkey;
alter table comisionistas add primary key (organizacion_id, persona_id);

alter table niveles_mensuales drop constraint niveles_mensuales_pkey;
alter table niveles_mensuales add primary key (organizacion_id, comisionista_id, mes);

select pg_temp.quitar_fk('marcas', 'cuenta_sugerida_id');
select pg_temp.quitar_fk('cuentas_receptoras', 'marca_id');
select pg_temp.quitar_fk('solicitudes', 'servicio_id');
select pg_temp.quitar_fk('solicitudes', 'marca_id');
select pg_temp.quitar_fk('solicitudes', 'cuenta_receptora_id');
select pg_temp.quitar_fk('cotizaciones', 'solicitud_id');
select pg_temp.quitar_fk('cotizaciones', 'cuenta_receptora_id');
select pg_temp.quitar_fk('historial_estatus', 'solicitud_id');
select pg_temp.quitar_fk('niveles_mensuales', 'nivel_id');
select pg_temp.quitar_fk('niveles_mensuales', 'cierre_id');
select pg_temp.quitar_fk('comisiones', 'solicitud_id');
select pg_temp.quitar_fk('comisiones', 'cierre_id');
select pg_temp.quitar_fk('comisiones', 'cuenta_receptora_id');
select pg_temp.quitar_fk('comisiones', 'servicio_id');
select pg_temp.quitar_fk('comisiones', 'anula_id');
select pg_temp.quitar_fk('pagos', 'solicitud_id');
select pg_temp.quitar_fk('alertas', 'solicitud_id');
select pg_temp.quitar_fk('pendientes_comision', 'cierre_id');
select pg_temp.quitar_fk('pagos_comision', 'origen_id');
select pg_temp.quitar_fk('aplicaciones_pago_comision', 'pago_id');
select pg_temp.quitar_fk('aplicaciones_pago_comision', 'pendiente_id');

alter table marcas add constraint marcas_cuenta_sugerida_fk
  foreign key (organizacion_id, cuenta_sugerida_id) references cuentas_receptoras (organizacion_id, id)
  on delete set null (cuenta_sugerida_id);
alter table cuentas_receptoras add foreign key (organizacion_id, marca_id) references marcas (organizacion_id, id);
alter table comisionistas add foreign key (organizacion_id, referido_por)
  references comisionistas (organizacion_id, persona_id) on delete set null (referido_por);

alter table solicitudes
  add foreign key (organizacion_id, comisionista_id) references comisionistas (organizacion_id, persona_id),
  add foreign key (organizacion_id, servicio_id) references servicios (organizacion_id, id),
  add foreign key (organizacion_id, marca_id) references marcas (organizacion_id, id),
  add foreign key (organizacion_id, cuenta_receptora_id) references cuentas_receptoras (organizacion_id, id);

alter table cotizaciones
  add foreign key (organizacion_id, solicitud_id) references solicitudes (organizacion_id, id) on delete cascade,
  add foreign key (organizacion_id, cuenta_receptora_id) references cuentas_receptoras (organizacion_id, id);

alter table historial_estatus
  add foreign key (organizacion_id, solicitud_id) references solicitudes (organizacion_id, id) on delete cascade;

alter table niveles_mensuales
  add foreign key (organizacion_id, comisionista_id) references comisionistas (organizacion_id, persona_id) on delete cascade,
  add foreign key (organizacion_id, nivel_id) references niveles (organizacion_id, id),
  add foreign key (organizacion_id, cierre_id) references cierres (organizacion_id, id);

alter table comisiones
  add foreign key (organizacion_id, comisionista_id) references comisionistas (organizacion_id, persona_id),
  add foreign key (organizacion_id, solicitud_id) references solicitudes (organizacion_id, id),
  add foreign key (organizacion_id, cierre_id) references cierres (organizacion_id, id),
  add foreign key (organizacion_id, cuenta_receptora_id) references cuentas_receptoras (organizacion_id, id),
  add foreign key (organizacion_id, servicio_id) references servicios (organizacion_id, id),
  add foreign key (organizacion_id, anula_id) references comisiones (organizacion_id, id);

alter table pagos
  add foreign key (organizacion_id, solicitud_id) references solicitudes (organizacion_id, id);

alter table alertas
  add foreign key (organizacion_id, solicitud_id) references solicitudes (organizacion_id, id) on delete cascade;

alter table pendientes_comision
  add foreign key (organizacion_id, comisionista_id) references comisionistas (organizacion_id, persona_id),
  add foreign key (organizacion_id, cierre_id) references cierres (organizacion_id, id);

alter table pagos_comision
  add foreign key (organizacion_id, comisionista_id) references comisionistas (organizacion_id, persona_id),
  add foreign key (organizacion_id, origen_id) references origenes_pago (organizacion_id, id);

alter table aplicaciones_pago_comision
  add foreign key (organizacion_id, pago_id) references pagos_comision (organizacion_id, id),
  add foreign key (organizacion_id, pendiente_id) references pendientes_comision (organizacion_id, id);

-- Las marcas de cada admin_marca.
create table membresia_marcas (
  organizacion_id  uuid not null references organizaciones(id) on delete restrict,
  membresia_id     uuid not null,
  marca_id         uuid not null,
  primary key (membresia_id, marca_id),
  foreign key (organizacion_id, membresia_id) references membresias (organizacion_id, id) on delete cascade,
  foreign key (organizacion_id, marca_id) references marcas (organizacion_id, id)
);

-- ------------------------------------------------------------
-- 7. AJUSTES POR ORGANIZACIÓN
-- ------------------------------------------------------------

alter table ajustes drop constraint ajustes_pkey;
alter table ajustes drop column id;
alter table ajustes add primary key (organizacion_id);
alter table ajustes
  add column terminos text check (char_length(terminos) <= 20000),
  add column aviso_privacidad text check (char_length(aviso_privacidad) <= 20000);

-- ------------------------------------------------------------
-- 8. CONECTORES
-- ------------------------------------------------------------
-- Cómo se entera Tasa de lo que pasa con un trámite fuera de Tasa.
--   · manual: no hay sistema externo. El estatus se mueve a mano y el
--     folio lo genera Tasa con el prefijo de la organización.
--   · notion / sheets / webhook: crean el registro externo al aceptar
--     y leen estatus, folio, fecha de visita y cancelación.
-- Una organización tiene un conector activo.

create table conectores (
  id                     uuid primary key default gen_random_uuid(),
  organizacion_id        uuid not null references organizaciones(id) on delete restrict,
  tipo                   text not null check (tipo in ('manual', 'notion', 'sheets', 'webhook')),
  activo                 boolean not null default true,
  -- notion: {"base_de_datos": "…", "valor_cancelado": "Cancelado"}
  configuracion          jsonb not null default '{}',
  -- Qué propiedad externa es cada dato: {"titulo": "Name", "etapa": "Etapa", …}
  mapeo_campos           jsonb not null default '{}',
  estado                 text not null default 'activo' check (estado in ('activo', 'error', 'pausado')),
  ultimo_sync            timestamptz,
  ultimo_error           text,
  -- La credencial vive cifrada en Supabase Vault; aquí solo su id.
  credencial_id          uuid,
  credencial_guardada_en timestamptz,
  creado_en              timestamptz not null default now(),
  unique (organizacion_id, id)
);

create unique index conectores_uno_activo on conectores (organizacion_id) where activo;

-- XG arranca en manual. El conector de Notion queda preparado y
-- apagado, con el mapeo de etapas que ya existía.
insert into conectores (id, organizacion_id, tipo, activo) values
  ('a0000000-0000-4000-8000-0000000000c1', 'a0000000-0000-4000-8000-000000000001', 'manual', true),
  ('a0000000-0000-4000-8000-0000000000c2', 'a0000000-0000-4000-8000-000000000001', 'notion', false);
update conectores
   set configuracion = '{"valor_cancelado": "Cancelado"}',
       mapeo_campos = '{"titulo": "Name", "etapa": "Etapa", "fecha_visita": "Fecha de visita"}'
 where id = 'a0000000-0000-4000-8000-0000000000c2';

-- El mapeo de estatus es de cada conector.
alter table mapeo_estatus rename column etapa_notion to valor_externo;
alter table mapeo_estatus add column conector_id uuid;
update mapeo_estatus set conector_id = 'a0000000-0000-4000-8000-0000000000c2';
alter table mapeo_estatus
  alter column conector_id set not null,
  drop constraint mapeo_estatus_pkey,
  add primary key (conector_id, valor_externo),
  add foreign key (organizacion_id, conector_id) references conectores (organizacion_id, id) on delete cascade;

-- Alertas: además de "cancelado afuera", las fallas del conector.
alter table alertas drop constraint alertas_tipo_check;
update alertas set tipo = 'cancelado_externo' where tipo = 'cancelado_en_notion';
alter table alertas
  alter column solicitud_id drop not null,
  add column conector_id uuid,
  -- Para tipo 'conector': propiedad_no_encontrada, credencial_invalida,
  -- inaccesible, limite, otro.
  add column codigo text,
  add constraint alertas_tipo_check check (tipo in ('cancelado_externo', 'conector')),
  add constraint alertas_tipo_completo check (
    (tipo = 'cancelado_externo' and solicitud_id is not null)
    or (tipo = 'conector' and conector_id is not null and codigo is not null)),
  add foreign key (organizacion_id, conector_id) references conectores (organizacion_id, id) on delete cascade;
create unique index alertas_conector_una_abierta
  on alertas (conector_id, codigo) where resuelta_en is null and tipo = 'conector';

-- Folio generado por Tasa (conector manual): un contador por
-- organización y año.
create table folios_contador (
  organizacion_id  uuid not null references organizaciones(id) on delete restrict,
  anio             smallint not null,
  ultimo           integer not null default 0,
  primary key (organizacion_id, anio)
);

-- ------------------------------------------------------------
-- 9. EL ROL YA NO VIVE EN LA PERSONA
-- ------------------------------------------------------------
-- Las funciones que lo leían se reescriben en 0016, en la misma
-- transacción de `db push`.

alter table personas drop column rol;

create trigger bitacora after insert or update or delete on organizaciones
  for each row execute function registrar_bitacora();
create trigger bitacora after insert or update or delete on membresias
  for each row execute function registrar_bitacora();
create trigger bitacora after insert or update or delete on membresia_marcas
  for each row execute function registrar_bitacora();
create trigger bitacora after insert or update or delete on conectores
  for each row execute function registrar_bitacora();
