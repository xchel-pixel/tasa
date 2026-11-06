-- ============================================================
-- 0059 — MAPA CATASTRAL (IDECATQ)
--
-- Herramienta del catálogo: un mapa satelital donde se pica un terreno
-- y sale su clave, su polígono y su ficha catastral. Tasa guarda su
-- propio kardex: primero busca aquí y solo va a IDECATQ si el predio no
-- existe o tiene más de 90 días (o si alguien pide "Actualizar").
--
-- · catastro_predios: datos NO personales del predio, COMPARTIDOS entre
--   organizaciones (son datos del estado). Columnas para lo estable y
--   `extra` (jsonb) para lo que cambia por municipio o por tipo
--   (condominios, Registro Público, capa del mapa).
-- · catastro_versiones: el kardex. Al actualizar, si algo cambió, se
--   guarda la versión anterior con su fecha. Compartido.
-- · catastro_propietarios: nombre y porcentaje del propietario y la
--   operación (valor, tipo de adquisición, escritura, notario, contrato).
--   POR ORGANIZACIÓN. Solo admin_org, finanzas y equipo, y solo por
--   función: `authenticated` no tiene ningún permiso sobre la tabla, así
--   que un comisionista no la lee ni por la API directa.
-- · catastro_campos_visibles: qué campo ve cada rol (pantalla y PDF).
--   Nadie lee los predios directo: todo pasa por catastro_ficha(), que
--   regresa solo los campos permitidos para el rol.
-- · catastro_fallas: fallas de IDECATQ; 3 o más en una hora → una alerta.
--
-- Lista blanca en la base: ningún jsonb catastral acepta una llave que
-- no esté en el catálogo de campos, y ninguna llave puede parecer un dato
-- personal (CURP, RFC, teléfono, domicilio, sexo, defunción, persona).
-- Lo personal que llega de IDECATQ se descarta en el servidor antes de
-- guardar; esto es la segunda capa.
--
-- Cupos (consultas a IDECATQ al mes): Enlace 20, Aliado 40, Socio 80,
-- Socio Plus y Élite sin límite. Tope de seguridad para todos: 200 al día
-- por persona. Una consulta que falla no cuenta.
-- ============================================================

-- ------------------------------------------------------------
-- Lista negra y catálogo de campos
-- ------------------------------------------------------------

create or replace function catastro_llave_prohibida(p_llave text)
returns boolean language sql immutable set search_path = public as $$
  select lower(translate(p_llave, 'áéíóúÁÉÍÓÚ', 'aeiouAEIOU'))
         ~ '(curp|rfc|telefono|domicilio|direccion|sexo|defuncion|persona|paterno|materno|correo|email|propietario)';
$$;

-- Verdadero si ninguna llave (a cualquier profundidad) es prohibida.
create or replace function catastro_jsonb_limpio(p jsonb)
returns boolean language plpgsql immutable set search_path = public as $$
declare
  v_llave text;
  v_valor jsonb;
begin
  if p is null then
    return true;
  end if;
  if jsonb_typeof(p) = 'object' then
    for v_llave, v_valor in select * from jsonb_each(p) loop
      if catastro_llave_prohibida(v_llave) or not catastro_jsonb_limpio(v_valor) then
        return false;
      end if;
    end loop;
  elsif jsonb_typeof(p) = 'array' then
    for v_valor in select * from jsonb_array_elements(p) loop
      if not catastro_jsonb_limpio(v_valor) then
        return false;
      end if;
    end loop;
  end if;
  return true;
end;
$$;

-- Los campos configurables de la ficha (los mismos que lib/catastro/limpiar.ts; una prueba lo vigila).
-- Siempre visibles, fuera de esta lista: clave, municipio, polígono, latitud/longitud, fecha y estado del expediente.
create or replace function catastro_campos()
returns text[] language sql immutable set search_path = public as $$
  select array[
    -- columnas
    'colonia', 'codigo_postal', 'ubicacion', 'sup_terreno', 'sup_construccion',
    -- ubicación desglosada y datos generales
    'calle', 'num_ext', 'num_int', 'localidad', 'manzana', 'tipo_predio', 'estatus', 'clasificacion', 'uso',
    'clave_anterior', 'clave_estandar', 'clave_original', 'folio_real', 'fecha_alta', 'fecha_mantenimiento',
    'movimientos', 'superficie', 'tipos_construccion', 'series_valor',
    -- valores catastrales
    'codigo_valor', 'fecha_validez', 'valor_terreno', 'valor_construccion', 'valor_terreno_anterior', 'valor_construccion_anterior',
    -- condominio
    'regimen', 'tipo_condominio', 'nombre_condominio', 'indiviso',
    'sup_terreno_privativa', 'sup_terreno_comun', 'sup_construccion_privativa', 'sup_construccion_comun',
    'valor_terreno_privativo', 'valor_terreno_comun', 'valor_construccion_privativa', 'valor_construccion_comun',
    'cacoct', 'vacopt', 'vatrct', 'vatrpt',
    -- Registro Público (sin propietarios)
    'rppc_folio_real', 'rppc_tipo', 'rppc_estatus', 'rppc_area_terreno', 'rppc_ubicacion', 'rppc_lote',
    'rppc_nom_col_bar_otro', 'rppc_medidas', 'rppc_medid_colind',
    -- capa del mapa (GetFeatureInfo)
    'capa_folio', 'capa_no_oficial', 'capa_localidad', 'capa_curt', 'capa_area', 'capa_perimetro', 'capa_coor_x', 'capa_coor_y'
  ]::text[];
$$;

-- Lo que el comisionista (y admin_marca) ve por omisión.
create or replace function catastro_campos_basicos()
returns text[] language sql immutable set search_path = public as $$
  select array['colonia', 'ubicacion', 'sup_terreno', 'sup_construccion', 'capa_area',
               'sup_terreno_privativa', 'sup_terreno_comun', 'sup_construccion_privativa', 'sup_construccion_comun', 'indiviso']::text[];
$$;

-- Solo llaves del catálogo y ninguna prohibida.
create or replace function catastro_extra_valido(p jsonb)
returns boolean language sql immutable set search_path = public as $$
  select jsonb_typeof(p) = 'object'
     and catastro_jsonb_limpio(p)
     and not exists (select 1 from jsonb_object_keys(p) k where k <> all (catastro_campos()));
$$;

-- Lista de propietarios: solo nombre, porcentaje, origen y tipo de adquisición.
create or replace function catastro_propietarios_validos(p jsonb)
returns boolean language sql immutable set search_path = public as $$
  select jsonb_typeof(p) = 'array' and catastro_jsonb_limpio(p)
     and not exists (select 1 from jsonb_array_elements(p) e
                      where jsonb_typeof(e) <> 'object'
                         or exists (select 1 from jsonb_object_keys(e) k where k not in ('nombre', 'porcentaje', 'origen', 'tipo_adquisicion')));
$$;

-- ------------------------------------------------------------
-- Tablas
-- ------------------------------------------------------------

create table catastro_predios (
  clave            text primary key check (clave ~ '^(0[1-9]|1[0-8])[0-9]{13}$'),
  municipio        text not null check (municipio = left(clave, 2)),
  geometria        jsonb check (geometria is null or (geometria->>'type' in ('Polygon', 'MultiPolygon') and catastro_jsonb_limpio(geometria))),
  latitud          numeric(9, 6),
  longitud         numeric(9, 6),
  -- Caja del polígono: para hallar un predio guardado por punto sin ir a IDECATQ.
  lat_min          numeric(9, 6),
  lat_max          numeric(9, 6),
  lon_min          numeric(9, 6),
  lon_max          numeric(9, 6),
  colonia          text,
  codigo_postal    text,
  ubicacion        text,
  sup_terreno      numeric,
  sup_construccion numeric,
  extra            jsonb not null default '{}' check (catastro_extra_valido(extra)),
  -- pendiente: el mapa respondió pero el expediente (BuscaDatos) no.
  expediente       text not null default 'completo' check (expediente in ('completo', 'pendiente')),
  consultado_en    timestamptz not null default now(),
  -- Quién lo trajo por última vez (rastro; no limita quién lo ve).
  consultado_por   uuid references personas(id) on delete set null,
  consultado_org   uuid references organizaciones(id) on delete set null,
  -- Predios inventados para la organización DEMO: solo los ven las organizaciones demo.
  demo             boolean not null default false
);
create index on catastro_predios (lat_min, lat_max, lon_min, lon_max);

create table catastro_versiones (
  id            bigint generated always as identity primary key,
  clave         text not null references catastro_predios(clave) on delete cascade,
  -- La fecha de consulta de la versión guardada y cuándo la reemplazó otra.
  consultado_en timestamptz not null,
  reemplazada_en timestamptz not null default now(),
  cambios       text[] not null,
  antes         jsonb not null check (catastro_jsonb_limpio(antes))
);
create index on catastro_versiones (clave, reemplazada_en desc);

create table catastro_propietarios (
  organizacion_id uuid not null default mi_org() references organizaciones(id) on delete restrict,
  clave           text not null references catastro_predios(clave) on delete cascade,
  -- [{nombre, porcentaje, origen: catastro|rppc, tipo_adquisicion}]: nada más.
  propietarios    jsonb not null default '[]' check (catastro_propietarios_validos(propietarios)),
  valor_operacion numeric,
  escritura       text,
  notario         text,
  numero_contrato text,
  actualizado_en  timestamptz not null default now(),
  primary key (organizacion_id, clave)
);

create table catastro_campos_visibles (
  id              uuid primary key default gen_random_uuid(),
  organizacion_id uuid not null default mi_org() references organizaciones(id) on delete restrict,
  rol             text not null check (rol in ('admin_org', 'finanzas', 'admin_marca', 'equipo', 'comisionista')),
  campo           text not null check (campo = any (catastro_campos())),
  en_pantalla     boolean not null default false,
  en_pdf          boolean not null default false,
  unique (organizacion_id, rol, campo)
);

create table catastro_fallas (
  id              bigint generated always as identity primary key,
  organizacion_id uuid not null references organizaciones(id) on delete cascade,
  persona_id      uuid references personas(id) on delete set null,
  servicio        text not null check (servicio in ('mapa', 'expediente')),
  ocurrida_en     timestamptz not null default now()
);
create index on catastro_fallas (organizacion_id, ocurrida_en);

-- Permisos: nada para anon ni para authenticated en las tablas de datos. Todo por función.
alter table catastro_predios enable row level security;
alter table catastro_versiones enable row level security;
alter table catastro_propietarios enable row level security;
alter table catastro_campos_visibles enable row level security;
alter table catastro_fallas enable row level security;
revoke all on catastro_predios, catastro_versiones, catastro_propietarios, catastro_campos_visibles, catastro_fallas from anon;
revoke all on catastro_predios, catastro_versiones, catastro_propietarios, catastro_fallas from authenticated;

-- Sin GRANT, estas políticas no abren nada; quedan como segunda cerradura si algún día se otorga un permiso.
create policy catastro_propietarios_staff on catastro_propietarios for select
  using (organizacion_id = (select mi_org()) and (select mi_rol()) in ('admin_org', 'finanzas', 'equipo'));
create policy catastro_fallas_staff on catastro_fallas for select
  using (organizacion_id = (select mi_org()) and (select soy_staff()));
-- catastro_predios y catastro_versiones: RLS encendido y ninguna política = nadie con sesión las lee directo.

-- La configuración de campos: la leen admin_org y finanzas; la cambia admin_org (pantalla en la fase 2).
create policy leer_campos_visibles on catastro_campos_visibles for select
  using (organizacion_id = (select mi_org()) and (select soy_staff()));
create policy admin_campos_visibles on catastro_campos_visibles for all
  using (organizacion_id = (select mi_org()) and (select soy_admin_org()))
  with check (organizacion_id = (select mi_org()) and (select soy_admin_org()));
grant select, insert, update, delete on catastro_campos_visibles to authenticated;
create trigger bitacora after insert or update or delete on catastro_campos_visibles
  for each row execute function registrar_bitacora();

-- ------------------------------------------------------------
-- Catálogo de herramientas, cupos, visibilidad y alerta
-- ------------------------------------------------------------

alter table herramientas drop constraint herramientas_clave_check;
alter table herramientas add constraint herramientas_clave_check check (clave in (
  'mi_tarjeta', 'calculadora_traslado', 'calculadora_traslado_completa', 'para_tus_clientes', 'invitar', 'mapa_catastral'));

create or replace function sembrar_herramientas(p_org uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into herramientas (organizacion_id, clave, nombre, activa, roles, niveles, en_menu, orden)
  values
    (p_org, 'mi_tarjeta', 'Mi tarjeta', true, array['comisionista'], null, true, 30),
    (p_org, 'para_tus_clientes', 'Para tus clientes', true,
     array['admin_org', 'finanzas', 'admin_marca', 'equipo', 'comisionista'], null, false, 32),
    (p_org, 'invitar', 'Invita a un comisionista', true,
     array['admin_org', 'finanzas', 'admin_marca', 'equipo', 'comisionista'], null, false, 34),
    (p_org, 'calculadora_traslado', 'Calculadora de traslado', false,
     array['admin_org', 'finanzas', 'admin_marca', 'equipo', 'comisionista'], null, true, 40),
    (p_org, 'calculadora_traslado_completa', 'Calculadora completa', false,
     array['admin_org', 'finanzas', 'admin_marca', 'equipo', 'comisionista'],
     coalesce((select array_agg(id order by orden) from niveles
                where organizacion_id = p_org and (es_forzado or nombre in ('Socio', 'Socio Plus'))), '{}'), false, 41),
    -- Apagado al nacer: admin_org lo enciende en Catálogos.
    (p_org, 'mapa_catastral', 'Mapa catastral', false,
     array['admin_org', 'finanzas', 'admin_marca', 'equipo', 'comisionista'], null, true, 45)
  on conflict (organizacion_id, clave) do nothing;
end;
$$;
select sembrar_herramientas(id) from organizaciones;

-- Cupos: los de la calculadora (0057) más el mapa: 20/40/80/sin límite; Élite sin límite.
create or replace function sembrar_cupos(p_org uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into cupos_herramienta (organizacion_id, herramienta, nivel_id, cantidad)
  select p_org, c.herramienta, n.id, c.cantidad
    from niveles n
    join (values ('calculadora_traslado', 'Enlace', 15), ('calculadora_traslado', 'Aliado', 30), ('calculadora_traslado', 'Socio', 60),
                 ('calculadora_traslado', 'Socio Plus', null), ('calculadora_traslado_completa', 'Enlace', 2),
                 ('calculadora_traslado_completa', 'Aliado', 5), ('calculadora_traslado_completa', 'Socio', 15),
                 ('calculadora_traslado_completa', 'Socio Plus', null),
                 ('mapa_catastral', 'Enlace', 20), ('mapa_catastral', 'Aliado', 40), ('mapa_catastral', 'Socio', 80),
                 ('mapa_catastral', 'Socio Plus', null)) as c(herramienta, nivel, cantidad)
      on c.nivel = n.nombre
   where n.organizacion_id = p_org
  union all
  select p_org, h, n.id, null from niveles n, unnest(array['calculadora_traslado', 'calculadora_traslado_completa', 'mapa_catastral']) h
   where n.organizacion_id = p_org and n.es_forzado
  on conflict (organizacion_id, herramienta, nivel_id) do nothing;
end;
$$;
select sembrar_cupos(id) from organizaciones;

-- Visibilidad por omisión: admin_org, finanzas y equipo, todo; comisionista y admin_marca, lo básico.
create or replace function sembrar_campos_catastro(p_org uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into catastro_campos_visibles (organizacion_id, rol, campo, en_pantalla, en_pdf)
  select p_org, r, c, v_ver, v_ver
    from unnest(array['admin_org', 'finanzas', 'admin_marca', 'equipo', 'comisionista']) r,
         unnest(catastro_campos()) c,
         lateral (select r in ('admin_org', 'finanzas', 'equipo') or c = any (catastro_campos_basicos()) as v_ver) x
  on conflict (organizacion_id, rol, campo) do nothing;
end;
$$;

create or replace function sembrar_campos_catastro_nueva()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform sembrar_campos_catastro(new.id);
  return new;
end;
$$;
create trigger sembrar_campos_catastro after insert on organizaciones
  for each row execute function sembrar_campos_catastro_nueva();
select sembrar_campos_catastro(id) from organizaciones;

alter table alertas drop constraint alertas_tipo_check;
alter table alertas drop constraint alertas_tipo_completo;
alter table alertas
  add constraint alertas_tipo_check check (tipo in ('cancelado_externo', 'externo_borrado', 'liga_inactiva', 'conector',
                                                    'estimado_sin_final', 'liga_limite', 'pago_por_entregar', 'externo_solicitado',
                                                    'perfil_por_aprobar', 'externo_comision', 'notion_sin_pagina', 'notion_pago',
                                                    'parametros_fiscales', 'cupo_agotado', 'catastro')),
  add constraint alertas_tipo_completo check (
    (tipo in ('cancelado_externo', 'externo_borrado', 'liga_inactiva', 'estimado_sin_final', 'pago_por_entregar',
              'externo_solicitado', 'externo_comision')
     and solicitud_id is not null)
    or (tipo = 'conector' and conector_id is not null and codigo is not null)
    or (tipo in ('liga_limite', 'perfil_por_aprobar', 'notion_sin_pagina', 'notion_pago', 'parametros_fiscales', 'cupo_agotado', 'catastro')
        and codigo is not null));
drop index if exists alertas_codigo_una_abierta;
create unique index alertas_codigo_una_abierta
  on alertas (organizacion_id, tipo, codigo) where resuelta_en is null
  and tipo in ('notion_sin_pagina', 'notion_pago', 'parametros_fiscales', 'cupo_agotado', 'catastro');

-- ------------------------------------------------------------
-- Lectura: la ficha filtrada por rol
-- ------------------------------------------------------------

-- Quién ve propietarios y operación.
create or replace function catastro_veo_privados()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(mi_rol() in ('admin_org', 'finanzas', 'equipo'), false);
$$;

-- El predio, si existe y la organización puede verlo (los de ejemplo, solo en organizaciones demo).
create or replace function catastro_predio_visible(p_clave text)
returns catastro_predios language sql stable security definer set search_path = public as $$
  select p.* from catastro_predios p
   where p.clave = p_clave
     and p.demo = coalesce((select o.demo from organizaciones o where o.id = mi_org()), false);
$$;

-- La ficha que ve quien pregunta: siempre clave, municipio, polígono y punto; lo demás según su rol.
-- Propietarios y operación solo para admin_org, finanzas y equipo. Nulo si no está guardado.
create or replace function catastro_ficha(p_clave text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  p          catastro_predios;
  v_todo     jsonb;
  v_campos   jsonb;
  v_ficha    jsonb;
  v_privados jsonb;
begin
  if not exists (select 1 from mis_herramientas() where clave = 'mapa_catastral') then
    raise exception 'El mapa catastral no está disponible para ti';
  end if;
  p := catastro_predio_visible(p_clave);
  if p.clave is null then
    return null;
  end if;
  v_todo := jsonb_build_object('colonia', p.colonia, 'codigo_postal', p.codigo_postal, 'ubicacion', p.ubicacion,
                               'sup_terreno', p.sup_terreno, 'sup_construccion', p.sup_construccion) || p.extra;
  select coalesce(jsonb_object_agg(t.key, t.value), '{}') into v_campos
    from jsonb_each(v_todo) t
   where t.value <> 'null'::jsonb
     and t.key in (select cv.campo from catastro_campos_visibles cv
                    where cv.organizacion_id = mi_org() and cv.rol = mi_rol() and cv.en_pantalla);
  v_ficha := jsonb_build_object('clave', p.clave, 'municipio', p.municipio, 'geometria', p.geometria,
                                'latitud', p.latitud, 'longitud', p.longitud, 'consultado_en', p.consultado_en,
                                'expediente', p.expediente, 'campos', v_campos);
  if catastro_veo_privados() then
    select jsonb_build_object('propietarios', cp.propietarios, 'valor_operacion', cp.valor_operacion, 'escritura', cp.escritura,
                              'notario', cp.notario, 'numero_contrato', cp.numero_contrato, 'actualizado_en', cp.actualizado_en)
      into v_privados
      from catastro_propietarios cp where cp.organizacion_id = mi_org() and cp.clave = p.clave;
    v_ficha := v_ficha || jsonb_build_object('privados', v_privados,
      'historial', (select coalesce(jsonb_agg(jsonb_build_object('consultado_en', v.consultado_en, 'reemplazada_en', v.reemplazada_en,
                                                                  'cambios', v.cambios) order by v.reemplazada_en desc), '[]')
                      from catastro_versiones v where v.clave = p.clave));
  end if;
  return v_ficha;
end;
$$;

-- Predios guardados cuya caja contiene el punto (el servidor decide cuál contiene de verdad el punto).
create or replace function catastro_candidatos(p_lat numeric, p_lon numeric)
returns table (clave text, geometria jsonb, consultado_en timestamptz, expediente text)
language sql stable security definer set search_path = public as $$
  select p.clave, p.geometria, p.consultado_en, p.expediente
    from catastro_predios p
   where exists (select 1 from mis_herramientas() h where h.clave = 'mapa_catastral')
     and p.demo = coalesce((select o.demo from organizaciones o where o.id = mi_org()), false)
     and p.geometria is not null
     and p_lat between p.lat_min and p.lat_max and p_lon between p.lon_min and p.lon_max
   order by (p.lat_max - p.lat_min) * (p.lon_max - p.lon_min)
   limit 10;
$$;

-- ------------------------------------------------------------
-- Consultar IDECATQ: permiso, guardado y fallas
--
-- Las tablas compartidas solo las escribe el servidor de Tasa: catastro_guardar y
-- catastro_registrar_falla solo las ejecuta service_role. El servidor verifica antes la
-- sesión (persona y organización) y le pasa sus ids; aquí se vuelve a revisar todo con esos ids.
-- ------------------------------------------------------------

-- El rol de una persona en una organización (como mi_rol(), pero para otra persona).
create or replace function catastro_rol_de(p_org uuid, p_persona uuid)
returns text language sql stable security definer set search_path = public as $$
  select coalesce(
    (select m.rol from membresias m where m.persona_id = p_persona and m.organizacion_id = p_org and m.activa),
    case when (select pe.super_plataforma from personas pe where pe.id = p_persona) then 'admin_org' end);
$$;

-- ¿Tiene esa persona el mapa en su catálogo? (como mis_herramientas()).
create or replace function catastro_tiene_herramienta(p_org uuid, p_persona uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from herramientas h, lateral (select catastro_rol_de(p_org, p_persona) as v_rol) r
     where h.organizacion_id = p_org and h.clave = 'mapa_catastral' and h.activa and r.v_rol = any (h.roles)
       and (r.v_rol <> 'comisionista' or h.niveles is null or nivel_del_mes(p_org, p_persona, mes_mx(now())) = any (h.niveles)));
$$;

-- ¿Puede esa persona ir a IDECATQ ahora? Nulo = sí; si no, el porqué.
create or replace function catastro_impedimento_de(p_org uuid, p_persona uuid)
returns text language plpgsql stable security definer set search_path = public as $$
declare
  c record;
begin
  if p_org is null or p_persona is null or not catastro_tiene_herramienta(p_org, p_persona) then
    return 'El mapa catastral no está disponible para ti.';
  end if;
  if coalesce((select o.demo from organizaciones o where o.id = p_org), false) then
    return 'En DEMO solo se consultan los predios de ejemplo.';
  end if;
  if (select count(*) from usos_herramienta u where u.organizacion_id = p_org and u.persona_id = p_persona
        and u.herramienta = 'mapa_catastral' and (u.creado_en at time zone 'America/Mexico_City')::date = hoy_mx()) >= 200 then
    return 'Llegaste al tope de seguridad de 200 consultas al día. Mañana se reinicia.';
  end if;
  select * into c from cupo_de(p_org, p_persona, 'mapa_catastral');
  if c.disponibles is not null and c.disponibles <= 0 then
    return 'Llegaste a tu límite de consultas del mes. Sube de nivel o pide más.';
  end if;
  return null;
end;
$$;

-- La de quien tiene la sesión (la pantalla la consulta antes de ir a IDECATQ).
create or replace function catastro_impedimento()
returns text language sql stable security definer set search_path = public as $$
  select catastro_impedimento_de(mi_org(), mi_persona_id());
$$;

-- Guarda lo que trajo IDECATQ (ya limpio), a nombre de la persona que el servidor verificó.
-- expediente 'completo' consume una consulta del cupo; 'pendiente' (falló el expediente) guarda solo
-- lo de la capa y no consume.
create or replace function catastro_guardar(
  p_org uuid, p_persona uuid,
  p_clave text, p_geometria jsonb, p_latitud numeric, p_longitud numeric, p_caja numeric[],
  p_datos jsonb, p_expediente text, p_privados jsonb, p_modo text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_imp      text := catastro_impedimento_de(p_org, p_persona);
  v_ant      catastro_predios;
  v_cols     text[] := array['colonia', 'codigo_postal', 'ubicacion', 'sup_terreno', 'sup_construccion'];
  v_datos    jsonb := coalesce(p_datos, '{}');
  v_extra    jsonb;
  v_antes    jsonb;
  v_despues  jsonb;
  v_cambios  text[];
begin
  if v_imp is not null then
    raise exception '%', v_imp;
  end if;
  if p_expediente not in ('completo', 'pendiente') or p_modo not in ('consulta', 'actualizar') then
    raise exception 'Consulta catastral inválida';
  end if;
  if p_clave !~ '^(0[1-9]|1[0-8])[0-9]{13}$' then
    raise exception 'Clave catastral inválida';
  end if;
  if not catastro_extra_valido(v_datos) then
    raise exception 'Datos catastrales fuera de la lista blanca';
  end if;
  if p_caja is not null and array_length(p_caja, 1) <> 4 then
    raise exception 'Caja inválida';
  end if;

  select * into v_ant from catastro_predios where clave = p_clave for update;
  if v_ant.demo then
    raise exception 'Ese predio es de ejemplo';
  end if;
  -- Sin expediente, lo anterior se conserva y solo se actualiza la capa del mapa.
  if p_expediente = 'pendiente' and v_ant.clave is not null then
    v_datos := (to_jsonb(v_ant) - array['clave', 'municipio', 'geometria', 'latitud', 'longitud', 'lat_min', 'lat_max', 'lon_min', 'lon_max',
                                        'extra', 'expediente', 'consultado_en', 'consultado_por', 'consultado_org', 'demo'])
                || v_ant.extra || v_datos;
    v_datos := (select coalesce(jsonb_object_agg(key, value), '{}') from jsonb_each(v_datos) where value <> 'null'::jsonb);
  end if;
  v_extra := v_datos - v_cols;

  if v_ant.clave is not null then
    v_antes := jsonb_build_object('geometria', v_ant.geometria) || (to_jsonb(v_ant) - array['clave', 'municipio', 'geometria', 'latitud', 'longitud',
               'lat_min', 'lat_max', 'lon_min', 'lon_max', 'extra', 'expediente', 'consultado_en', 'consultado_por', 'consultado_org', 'demo'])
               || v_ant.extra;
    v_antes := (select coalesce(jsonb_object_agg(key, value), '{}') from jsonb_each(v_antes) where value <> 'null'::jsonb);
    v_despues := jsonb_build_object('geometria', coalesce(p_geometria, v_ant.geometria)) || v_datos;
    v_despues := (select coalesce(jsonb_object_agg(key, value), '{}') from jsonb_each(v_despues) where value <> 'null'::jsonb);
    select coalesce(array_agg(k order by k), '{}') into v_cambios
      from (select key k from jsonb_each(v_antes) union select key from jsonb_each(v_despues)) x
     where v_antes -> k is distinct from v_despues -> k;
    if cardinality(v_cambios) > 0 then
      insert into catastro_versiones (clave, consultado_en, cambios, antes)
      values (p_clave, v_ant.consultado_en, v_cambios, v_antes);
    end if;
  end if;

  insert into catastro_predios as cp (clave, municipio, geometria, latitud, longitud, lat_min, lat_max, lon_min, lon_max,
                                      colonia, codigo_postal, ubicacion, sup_terreno, sup_construccion, extra, expediente,
                                      consultado_en, consultado_por, consultado_org)
  values (p_clave, left(p_clave, 2), p_geometria, p_latitud, p_longitud, p_caja[1], p_caja[2], p_caja[3], p_caja[4],
          v_datos->>'colonia', v_datos->>'codigo_postal', v_datos->>'ubicacion',
          (v_datos->>'sup_terreno')::numeric, (v_datos->>'sup_construccion')::numeric, v_extra, p_expediente,
          now(), p_persona, p_org)
  on conflict (clave) do update set
    geometria = coalesce(excluded.geometria, cp.geometria),
    latitud = coalesce(excluded.latitud, cp.latitud), longitud = coalesce(excluded.longitud, cp.longitud),
    lat_min = coalesce(excluded.lat_min, cp.lat_min), lat_max = coalesce(excluded.lat_max, cp.lat_max),
    lon_min = coalesce(excluded.lon_min, cp.lon_min), lon_max = coalesce(excluded.lon_max, cp.lon_max),
    colonia = excluded.colonia, codigo_postal = excluded.codigo_postal, ubicacion = excluded.ubicacion,
    sup_terreno = excluded.sup_terreno, sup_construccion = excluded.sup_construccion, extra = excluded.extra,
    -- Un expediente que falla no borra uno completo ni le cambia la fecha.
    expediente = case when p_expediente = 'completo' then 'completo' else cp.expediente end,
    consultado_en = case when p_expediente = 'completo' then now() else cp.consultado_en end,
    consultado_por = excluded.consultado_por, consultado_org = excluded.consultado_org;

  if p_expediente = 'completo' then
    if p_privados is not null then
      insert into catastro_propietarios as pr (organizacion_id, clave, propietarios, valor_operacion, escritura, notario, numero_contrato, actualizado_en)
      values (p_org, p_clave, coalesce(p_privados->'propietarios', '[]'), (p_privados->>'valor_operacion')::numeric,
              p_privados->>'escritura', p_privados->>'notario', p_privados->>'numero_contrato', now())
      on conflict (organizacion_id, clave) do update set
        propietarios = excluded.propietarios, valor_operacion = excluded.valor_operacion, escritura = excluded.escritura,
        notario = excluded.notario, numero_contrato = excluded.numero_contrato, actualizado_en = now();
    end if;
    -- El cupo ya se revisó arriba (catastro_impedimento_de): aquí solo se cuenta.
    insert into usos_herramienta (organizacion_id, persona_id, herramienta, modo) values (p_org, p_persona, 'mapa_catastral', p_modo);
  end if;
end;
$$;

-- Una falla de IDECATQ. Con 3 o más en la última hora, una alerta para admin_org (una abierta a la vez).
create or replace function catastro_registrar_falla(p_org uuid, p_persona uuid, p_servicio text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_org is null or not catastro_tiene_herramienta(p_org, p_persona) then
    return;
  end if;
  delete from catastro_fallas where ocurrida_en < now() - interval '7 days';
  insert into catastro_fallas (organizacion_id, persona_id, servicio) values (p_org, p_persona, p_servicio);
  if (select count(*) from catastro_fallas f where f.organizacion_id = p_org and f.ocurrida_en > now() - interval '1 hour') >= 3 then
    insert into alertas (organizacion_id, tipo, codigo, mensaje)
    values (p_org, 'catastro', 'idecatq',
            'IDECATQ falló 3 veces o más en la última hora. El Mapa catastral muestra lo guardado con su fecha; '
            || 'si sigue así, revisa que el visor oficial funcione. Ciérrala cuando vuelva a responder.')
    on conflict do nothing;
  end if;
end;
$$;

revoke all on function catastro_llave_prohibida(text), catastro_jsonb_limpio(jsonb), catastro_campos(), catastro_campos_basicos(),
  catastro_extra_valido(jsonb), catastro_propietarios_validos(jsonb), sembrar_campos_catastro(uuid), sembrar_campos_catastro_nueva(),
  catastro_veo_privados(), catastro_predio_visible(text), catastro_ficha(text), catastro_candidatos(numeric, numeric),
  catastro_rol_de(uuid, uuid), catastro_tiene_herramienta(uuid, uuid), catastro_impedimento_de(uuid, uuid), catastro_impedimento(),
  catastro_guardar(uuid, uuid, text, jsonb, numeric, numeric, numeric[], jsonb, text, jsonb, text), catastro_registrar_falla(uuid, uuid, text),
  sembrar_herramientas(uuid), sembrar_cupos(uuid)
  from public, anon, authenticated;
-- Con la sesión del usuario: leer la ficha, buscar por punto y saber si puede consultar.
grant execute on function catastro_ficha(text), catastro_candidatos(numeric, numeric), catastro_impedimento(),
  -- La revisa el CHECK de catastro_campos_visibles cuando admin_org edita la configuración.
  catastro_campos(), catastro_campos_basicos()
  to authenticated;
-- Escribir: solo el servidor de Tasa (llave de servicio).
grant execute on function catastro_guardar(uuid, uuid, text, jsonb, numeric, numeric, numeric[], jsonb, text, jsonb, text),
  catastro_registrar_falla(uuid, uuid, text)
  to service_role;
