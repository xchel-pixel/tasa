-- ============================================================
-- 0050 — LA TARJETA DIGITAL COMO TARJETA DE PRESENTACIÓN
--
-- Además del servicio del despacho, la tarjeta presenta al comisionista:
--
-- 1. "Mis servicios": propios del comisionista (título, descripción de
--    hasta 160, ícono de una lista fija, enlace opcional), en el orden que
--    él elija. Debajo, fijo: "Servicios ofrecidos directamente por
--    {nombre}." (los responde él, no el despacho).
-- 2. El bloque del despacho aliado (botón de solicitar + nota de
--    independencia) siempre se ve; el comisionista solo elige si va arriba
--    o abajo de sus servicios.
-- 3. Redes: Facebook, Instagram, TikTok, LinkedIn y sitio web; solo ligas
--    de esa red.
-- 4. Portafolio (Socio en adelante): inmuebles con foto 4:3, título,
--    venta o renta, precio opcional, zona (nunca la dirección) y enlace.
-- 5. Por nivel: Enlace 3 servicios; Aliado 6; Socio 6 + portafolio de 6;
--    Socio Plus y Élite sin límite (tope técnico de 30 de cada uno). Si
--    baja de nivel, lo que excede se oculta (no se borra).
-- 6. Clics por servicio propio y por inmueble (contador por día, sin
--    datos de quien visita).
-- 7. admin_org oculta un servicio o un inmueble con motivo.
--
-- Todo texto libre pasa por palabra_prohibida (sin perito, valuador ni
-- marcas). El comisionista escribe por funciones; la tabla solo se lee.
-- ============================================================

-- ------------------------------------------------------------
-- 1. LÍMITES Y VALIDACIONES
-- ------------------------------------------------------------

-- Cuántos servicios propios o inmuebles muestra cada nivel (1 Enlace … 4 Socio Plus/Élite).
create or replace function limite_tarjeta(p_nivel integer, p_que text)
returns integer language sql immutable as $$
  select case p_que
           when 'servicio' then case when p_nivel <= 1 then 3 when p_nivel <= 3 then 6 else 30 end
           when 'inmueble' then case when p_nivel <= 2 then 0 when p_nivel = 3 then 6 else 30 end
           else 0 end;
$$;

-- Una liga de esa red (o, para el sitio web, cualquier https/http con dominio).
create or replace function red_valida(p_red text, p_url text)
returns boolean language sql immutable as $$
  select p_url is null or (char_length(p_url) <= 300 and p_url !~ '\s' and case p_red
    when 'facebook'  then p_url ~* '^https?://([a-z0-9-]+\.)?(facebook\.com|fb\.com)/.+'
    when 'instagram' then p_url ~* '^https?://(www\.)?instagram\.com/.+'
    when 'tiktok'    then p_url ~* '^https?://(www\.|m\.)?tiktok\.com/.+'
    when 'linkedin'  then p_url ~* '^https?://([a-z]{2,3}\.)?linkedin\.com/(in|company)/.+'
    when 'sitio'     then p_url ~* '^https?://[a-z0-9-]+(\.[a-z0-9-]+)+(/.*)?$'
    else false end);
$$;

create or replace function enlace_valido(p_url text)
returns boolean language sql immutable as $$
  select p_url is null or (char_length(p_url) <= 300 and p_url ~* '^https?://[a-z0-9-]+(\.[a-z0-9-]+)+(/\S*)?$');
$$;

-- ------------------------------------------------------------
-- 2. REDES Y POSICIÓN DEL BLOQUE DEL DESPACHO
-- ------------------------------------------------------------

alter table tarjetas
  add column facebook        text check (red_valida('facebook', facebook)),
  add column instagram       text check (red_valida('instagram', instagram)),
  add column tiktok          text check (red_valida('tiktok', tiktok)),
  add column linkedin        text check (red_valida('linkedin', linkedin)),
  add column sitio_web       text check (red_valida('sitio', sitio_web)),
  add column despacho_arriba boolean not null default true;

-- ------------------------------------------------------------
-- 3. MIS SERVICIOS Y PORTAFOLIO
-- ------------------------------------------------------------

create table tarjeta_servicios (
  id               uuid primary key default gen_random_uuid(),
  organizacion_id  uuid not null default mi_org() references organizaciones(id) on delete restrict,
  comisionista_id  uuid not null,
  titulo           text not null check (char_length(trim(titulo)) between 2 and 60),
  descripcion      text check (char_length(descripcion) <= 160),
  icono            text not null default 'casa' check (icono in ('casa', 'edificio', 'llave', 'documento', 'calculadora',
                     'maletin', 'trato', 'grafica', 'escudo', 'herramienta', 'camara', 'mapa')),
  enlace           text check (enlace_valido(enlace)),
  orden            integer not null default 0,
  oculto_motivo    text check (char_length(oculto_motivo) <= 300),
  oculto_por       uuid references personas(id) on delete set null,
  oculto_en        timestamptz,
  creado_en        timestamptz not null default now(),
  foreign key (organizacion_id, comisionista_id) references tarjetas(organizacion_id, comisionista_id) on delete cascade,
  check ((oculto_en is null) = (oculto_motivo is null))
);
create index on tarjeta_servicios (organizacion_id, comisionista_id, orden);

create table tarjeta_inmuebles (
  id               uuid primary key default gen_random_uuid(),
  organizacion_id  uuid not null default mi_org() references organizaciones(id) on delete restrict,
  comisionista_id  uuid not null,
  titulo           text not null check (char_length(trim(titulo)) between 2 and 80),
  operacion        text not null check (operacion in ('venta', 'renta')),
  precio           numeric(14,2) check (precio > 0),
  zona             text not null check (char_length(trim(zona)) between 2 and 80),
  foto_ruta        text not null,
  enlace           text check (enlace_valido(enlace)),
  orden            integer not null default 0,
  oculto_motivo    text check (char_length(oculto_motivo) <= 300),
  oculto_por       uuid references personas(id) on delete set null,
  oculto_en        timestamptz,
  creado_en        timestamptz not null default now(),
  foreign key (organizacion_id, comisionista_id) references tarjetas(organizacion_id, comisionista_id) on delete cascade,
  check ((oculto_en is null) = (oculto_motivo is null))
);
create index on tarjeta_inmuebles (organizacion_id, comisionista_id, orden);

-- Clics por día en un servicio propio (su enlace) o un inmueble ("Me interesa" o su enlace).
create table tarjeta_clics (
  organizacion_id  uuid not null references organizaciones(id) on delete restrict,
  comisionista_id  uuid not null,
  tipo             text not null check (tipo in ('servicio', 'inmueble')),
  ref_id           uuid not null,
  dia              date not null,
  clics            integer not null default 0,
  primary key (organizacion_id, ref_id, dia),
  foreign key (organizacion_id, comisionista_id) references comisionistas(organizacion_id, persona_id) on delete cascade
);

alter table tarjeta_servicios enable row level security;
alter table tarjeta_inmuebles enable row level security;
alter table tarjeta_clics enable row level security;
revoke all on tarjeta_servicios, tarjeta_inmuebles, tarjeta_clics from anon;
grant select on tarjeta_servicios, tarjeta_inmuebles, tarjeta_clics to authenticated;
create policy leer_servicios_tarjeta on tarjeta_servicios for select
  using (organizacion_id = (select mi_org()) and ((select soy_staff()) or comisionista_id = (select mi_persona_id())));
create policy leer_inmuebles_tarjeta on tarjeta_inmuebles for select
  using (organizacion_id = (select mi_org()) and ((select soy_staff()) or comisionista_id = (select mi_persona_id())));
create policy leer_clics_tarjeta on tarjeta_clics for select
  using (organizacion_id = (select mi_org()) and ((select soy_staff()) or comisionista_id = (select mi_persona_id())));
create trigger bitacora after insert or update or delete on tarjeta_servicios for each row execute function registrar_bitacora();
create trigger bitacora after insert or update or delete on tarjeta_inmuebles for each row execute function registrar_bitacora();

-- El texto libre no dice perito, valuador ni las marcas.
create or replace function revisar_texto_elemento()
returns trigger language plpgsql set search_path = public as $$
declare
  v text;
begin
  -- Por jsonb: las dos tablas no tienen las mismas columnas (descripción en una, zona en la otra).
  v := palabra_prohibida(concat_ws(' ', to_jsonb(new)->>'titulo', to_jsonb(new)->>'descripcion', to_jsonb(new)->>'zona'));
  if v is not null then
    raise exception 'La tarjeta no puede decir "%": eres asesor afiliado (sin perito, valuador ni marcas)', v;
  end if;
  return new;
end;
$$;
create trigger al_guardar_servicio before insert or update on tarjeta_servicios for each row execute function revisar_texto_elemento();
create trigger al_guardar_inmueble before insert or update on tarjeta_inmuebles for each row execute function revisar_texto_elemento();

-- ------------------------------------------------------------
-- 4. LO QUE HACE EL COMISIONISTA
-- ------------------------------------------------------------

create or replace function exigir_comisionista()
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if mi_rol() is distinct from 'comisionista' then
    raise exception 'La tarjeta es del comisionista';
  end if;
end;
$$;

create or replace function guardar_mis_redes(p_facebook text, p_instagram text, p_tiktok text, p_linkedin text,
                                             p_sitio text, p_despacho_arriba boolean)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_red text;
begin
  perform exigir_comisionista();
  foreach v_red in array array['facebook', 'instagram', 'tiktok', 'linkedin', 'sitio'] loop
    if not red_valida(v_red, nullif(trim(case v_red when 'facebook' then p_facebook when 'instagram' then p_instagram
                                                   when 'tiktok' then p_tiktok when 'linkedin' then p_linkedin else p_sitio end), '')) then
      raise exception '%', case v_red when 'sitio' then 'El sitio web debe ser una liga completa (https://…)'
                                else 'La liga de ' || initcap(v_red) || ' debe ser de ' || initcap(v_red) || ' (https://…)' end;
    end if;
  end loop;
  insert into tarjetas (organizacion_id, comisionista_id) values (mi_org(), mi_persona_id()) on conflict do nothing;
  update tarjetas
     set facebook = nullif(trim(p_facebook), ''), instagram = nullif(trim(p_instagram), ''), tiktok = nullif(trim(p_tiktok), ''),
         linkedin = nullif(trim(p_linkedin), ''), sitio_web = nullif(trim(p_sitio), ''),
         despacho_arriba = coalesce(p_despacho_arriba, true)
   where organizacion_id = mi_org() and comisionista_id = mi_persona_id();
end;
$$;

-- Nuevo (p_id nulo) o cambio de un servicio propio. Lo nuevo respeta el límite de su nivel.
create or replace function guardar_mi_servicio(p_id uuid, p_titulo text, p_descripcion text, p_icono text, p_enlace text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id     uuid := p_id;
  v_limite integer := limite_tarjeta(nivel_tarjeta(mi_org(), mi_persona_id()), 'servicio');
begin
  perform exigir_comisionista();
  if not enlace_valido(nullif(trim(p_enlace), '')) then
    raise exception 'El enlace debe ser una liga completa (https://…)';
  end if;
  insert into tarjetas (organizacion_id, comisionista_id) values (mi_org(), mi_persona_id()) on conflict do nothing;
  if v_id is null then
    if (select count(*) from tarjeta_servicios where organizacion_id = mi_org() and comisionista_id = mi_persona_id()) >= v_limite then
      raise exception 'Con tu nivel puedes tener hasta % servicios propios', v_limite;
    end if;
    insert into tarjeta_servicios (organizacion_id, comisionista_id, titulo, descripcion, icono, enlace, orden)
    values (mi_org(), mi_persona_id(), trim(p_titulo), nullif(trim(p_descripcion), ''), coalesce(p_icono, 'casa'),
            nullif(trim(p_enlace), ''),
            coalesce((select max(orden) + 1 from tarjeta_servicios where organizacion_id = mi_org() and comisionista_id = mi_persona_id()), 0))
    returning id into v_id;
  else
    update tarjeta_servicios
       set titulo = trim(p_titulo), descripcion = nullif(trim(p_descripcion), ''), icono = coalesce(p_icono, 'casa'),
           enlace = nullif(trim(p_enlace), '')
     where id = v_id and organizacion_id = mi_org() and comisionista_id = mi_persona_id();
    if not found then
      raise exception 'Ese servicio no es tuyo';
    end if;
  end if;
  return v_id;
end;
$$;

-- Nuevo o cambio de un inmueble del portafolio. Regresa la foto anterior (para borrarla del bucket) si cambió.
create or replace function guardar_mi_inmueble(p_id uuid, p_titulo text, p_operacion text, p_precio numeric, p_zona text,
                                               p_foto text, p_enlace text)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_limite   integer := limite_tarjeta(nivel_tarjeta(mi_org(), mi_persona_id()), 'inmueble');
  v_anterior text;
begin
  perform exigir_comisionista();
  if p_foto is null or p_foto !~ ('^' || mi_org() || '/' || mi_persona_id() || '/[0-9a-f-]{36}\.(jpg|png|webp)$') then
    raise exception 'Sube la foto del inmueble';
  end if;
  if not enlace_valido(nullif(trim(p_enlace), '')) then
    raise exception 'El enlace debe ser una liga completa (https://…)';
  end if;
  insert into tarjetas (organizacion_id, comisionista_id) values (mi_org(), mi_persona_id()) on conflict do nothing;
  if p_id is null then
    if v_limite = 0 then
      raise exception 'El portafolio está disponible desde Socio';
    end if;
    if (select count(*) from tarjeta_inmuebles where organizacion_id = mi_org() and comisionista_id = mi_persona_id()) >= v_limite then
      raise exception 'Con tu nivel puedes tener hasta % inmuebles', v_limite;
    end if;
    insert into tarjeta_inmuebles (organizacion_id, comisionista_id, titulo, operacion, precio, zona, foto_ruta, enlace, orden)
    values (mi_org(), mi_persona_id(), trim(p_titulo), p_operacion, p_precio, trim(p_zona), p_foto, nullif(trim(p_enlace), ''),
            coalesce((select max(orden) + 1 from tarjeta_inmuebles where organizacion_id = mi_org() and comisionista_id = mi_persona_id()), 0));
  else
    select foto_ruta into v_anterior from tarjeta_inmuebles
     where id = p_id and organizacion_id = mi_org() and comisionista_id = mi_persona_id() for update;
    if not found then
      raise exception 'Ese inmueble no es tuyo';
    end if;
    update tarjeta_inmuebles
       set titulo = trim(p_titulo), operacion = p_operacion, precio = p_precio, zona = trim(p_zona), foto_ruta = p_foto,
           enlace = nullif(trim(p_enlace), '')
     where id = p_id;
  end if;
  return case when v_anterior is distinct from p_foto then v_anterior end;
end;
$$;

-- Borra un servicio o inmueble suyo. Del inmueble regresa la foto, para borrarla del bucket.
create or replace function borrar_de_mi_tarjeta(p_tipo text, p_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_foto text;
begin
  perform exigir_comisionista();
  if p_tipo = 'servicio' then
    delete from tarjeta_servicios where id = p_id and organizacion_id = mi_org() and comisionista_id = mi_persona_id();
  elsif p_tipo = 'inmueble' then
    delete from tarjeta_inmuebles where id = p_id and organizacion_id = mi_org() and comisionista_id = mi_persona_id()
    returning foto_ruta into v_foto;
  else
    raise exception 'Tipo no válido';
  end if;
  return v_foto;
end;
$$;

-- El orden que eligió (arrastrando o con flechas): la lista completa de ids, de arriba a abajo.
create or replace function ordenar_mi_tarjeta(p_tipo text, p_ids uuid[])
returns void language plpgsql security definer set search_path = public as $$
begin
  perform exigir_comisionista();
  if p_tipo = 'servicio' then
    update tarjeta_servicios t set orden = x.n - 1
      from unnest(p_ids) with ordinality x(id, n)
     where t.id = x.id and t.organizacion_id = mi_org() and t.comisionista_id = mi_persona_id();
  elsif p_tipo = 'inmueble' then
    update tarjeta_inmuebles t set orden = x.n - 1
      from unnest(p_ids) with ordinality x(id, n)
     where t.id = x.id and t.organizacion_id = mi_org() and t.comisionista_id = mi_persona_id();
  else
    raise exception 'Tipo no válido';
  end if;
end;
$$;

-- ------------------------------------------------------------
-- 5. MODERACIÓN (admin_org)
-- ------------------------------------------------------------

create or replace function moderar_elemento_tarjeta(p_tipo text, p_id uuid, p_ocultar boolean, p_motivo text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not soy_admin_org() then
    raise exception 'Solo admin_org modera las tarjetas';
  end if;
  if p_ocultar and nullif(trim(coalesce(p_motivo, '')), '') is null then
    raise exception 'Hace falta el motivo';
  end if;
  perform set_config('tasa.motivo', coalesce(nullif(trim(p_motivo), ''), 'Se vuelve a mostrar'), true);
  if p_tipo = 'servicio' then
    update tarjeta_servicios
       set oculto_en = case when p_ocultar then now() end, oculto_motivo = case when p_ocultar then trim(p_motivo) end,
           oculto_por = case when p_ocultar then mi_persona_id() end
     where id = p_id and organizacion_id = mi_org();
  elsif p_tipo = 'inmueble' then
    update tarjeta_inmuebles
       set oculto_en = case when p_ocultar then now() end, oculto_motivo = case when p_ocultar then trim(p_motivo) end,
           oculto_por = case when p_ocultar then mi_persona_id() end
     where id = p_id and organizacion_id = mi_org();
  else
    raise exception 'Tipo no válido';
  end if;
  if not found then
    raise exception 'No existe';
  end if;
  perform set_config('tasa.motivo', '', true);
end;
$$;

-- ------------------------------------------------------------
-- 6. LA PÁGINA PÚBLICA Y LOS CLICS
-- ------------------------------------------------------------

create or replace function datos_tarjeta(p_org text, p_clave text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  o       organizaciones%rowtype;
  c       comisionistas%rowtype;
  t       tarjetas%rowtype;
  p       personas%rowtype;
  v_nivel integer;
begin
  select * into o from organizaciones where slug = lower(trim(p_org)) and activa;
  if not found then
    return null;
  end if;
  select * into c from comisionistas
   where organizacion_id = o.id and (slug = lower(trim(p_clave)) or codigo_referido = upper(trim(p_clave)));
  if not found then
    return null;
  end if;
  select * into t from tarjetas where organizacion_id = o.id and comisionista_id = c.persona_id;
  select * into p from personas where id = c.persona_id;
  if t.comisionista_id is null or t.estado <> 'publicada' or not p.activo
     or not exists (select 1 from membresias m where m.organizacion_id = o.id and m.persona_id = c.persona_id and m.activa) then
    return jsonb_build_object('disponible', false, 'organizacion', o.nombre);
  end if;
  v_nivel := nivel_tarjeta(o.id, c.persona_id);
  return jsonb_build_object(
    'disponible', true,
    'organizacion', o.nombre,
    'org', o.slug,
    'codigo', c.codigo_referido,
    'slug', c.slug,
    'nivel', v_nivel,
    'nombre', nombre_visible(p),
    'frase', t.frase,
    'telefono', t.telefono,
    'correo', case when t.mostrar_correo then t.correo end,
    'zona', t.zona,
    'foto', t.foto_ruta,
    'logo', case when v_nivel >= 2 then t.logo_ruta end,
    'color', case when v_nivel >= 2 then t.color end,
    'nota', (select con_nombre(a.nota_tarjeta, nombre_visible(p)) from ajustes a where a.organizacion_id = o.id),
    'despacho_arriba', t.despacho_arriba,
    'redes', jsonb_strip_nulls(jsonb_build_object('facebook', t.facebook, 'instagram', t.instagram, 'tiktok', t.tiktok,
                                                  'linkedin', t.linkedin, 'sitio', t.sitio_web)),
    'mis_servicios',
       (select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'titulo', x.titulo, 'descripcion', x.descripcion,
                                                     'icono', x.icono, 'enlace', x.enlace) order by x.orden, x.creado_en), '[]')
          from (select * from tarjeta_servicios s where s.organizacion_id = o.id and s.comisionista_id = c.persona_id
                   and s.oculto_en is null order by s.orden, s.creado_en limit limite_tarjeta(v_nivel, 'servicio')) x),
    'inmuebles',
       (select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'titulo', x.titulo, 'operacion', x.operacion, 'precio', x.precio,
                                                     'zona', x.zona, 'foto', x.foto_ruta, 'enlace', x.enlace) order by x.orden, x.creado_en), '[]')
          from (select * from tarjeta_inmuebles i where i.organizacion_id = o.id and i.comisionista_id = c.persona_id
                   and i.oculto_en is null order by i.orden, i.creado_en limit limite_tarjeta(v_nivel, 'inmueble')) x),
    'servicios', case when v_nivel >= 4 then
       (select coalesce(jsonb_agg(s.nombre order by s.orden, s.nombre), '[]') from servicios s
         where s.organizacion_id = o.id and s.activo and s.id = any (t.servicios)) else '[]'::jsonb end,
    'testimonios', case when v_nivel >= 4 then
       (select coalesce(jsonb_agg(jsonb_build_object('cliente', x.cliente, 'texto', x.texto) order by x.decidido_en desc), '[]')
          from (select * from testimonios where organizacion_id = o.id and comisionista_id = c.persona_id and estado = 'aprobado'
                 order by decidido_en desc limit 6) x) else '[]'::jsonb end);
end;
$$;

-- Un clic en un servicio propio o un inmueble de una tarjeta publicada. Lo del propio comisionista no cuenta.
create or replace function registrar_clic_tarjeta(p_org text, p_clave text, p_ref uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  o      organizaciones%rowtype;
  c      comisionistas%rowtype;
  v_tipo text;
begin
  select * into o from organizaciones where slug = lower(trim(p_org)) and activa;
  if not found then
    return;
  end if;
  select * into c from comisionistas
   where organizacion_id = o.id and (slug = lower(trim(p_clave)) or codigo_referido = upper(trim(p_clave)));
  if not found or not exists (select 1 from tarjetas t where t.organizacion_id = o.id and t.comisionista_id = c.persona_id and t.estado = 'publicada') then
    return;
  end if;
  if auth.uid() is not null and mi_persona_id() = c.persona_id then
    return;
  end if;
  v_tipo := case
    when exists (select 1 from tarjeta_servicios s where s.id = p_ref and s.organizacion_id = o.id and s.comisionista_id = c.persona_id and s.oculto_en is null) then 'servicio'
    when exists (select 1 from tarjeta_inmuebles i where i.id = p_ref and i.organizacion_id = o.id and i.comisionista_id = c.persona_id and i.oculto_en is null) then 'inmueble'
  end;
  if v_tipo is null then
    return;
  end if;
  insert into tarjeta_clics (organizacion_id, comisionista_id, tipo, ref_id, dia, clics)
  values (o.id, c.persona_id, v_tipo, p_ref, hoy_mx(), 1)
  on conflict (organizacion_id, ref_id, dia) do update set clics = tarjeta_clics.clics + 1;
end;
$$;

-- Clics por servicio propio e inmueble (Socio o más): este mes y los últimos 6.
create or replace function mis_clics_tarjeta()
returns table (tipo text, id uuid, titulo text, este_mes bigint, seis_meses bigint)
language sql stable security definer set search_path = public as $$
  select e.tipo, e.id, e.titulo,
         coalesce((select sum(k.clics) from tarjeta_clics k where k.organizacion_id = mi_org() and k.ref_id = e.id
                    and mes_de(k.dia) = mes_de(hoy_mx())), 0),
         coalesce((select sum(k.clics) from tarjeta_clics k where k.organizacion_id = mi_org() and k.ref_id = e.id
                    and k.dia >= (mes_de(hoy_mx()) - interval '5 months')::date), 0)
    from (select 'servicio' as tipo, s.id, s.titulo, s.orden from tarjeta_servicios s
           where s.organizacion_id = mi_org() and s.comisionista_id = mi_persona_id()
          union all
          select 'inmueble', i.id, i.titulo, i.orden from tarjeta_inmuebles i
           where i.organizacion_id = mi_org() and i.comisionista_id = mi_persona_id()) e
   where nivel_tarjeta(mi_org(), mi_persona_id()) >= 3
   order by e.tipo desc, e.orden;
$$;

-- ------------------------------------------------------------
-- 7. PERMISOS
-- ------------------------------------------------------------

revoke all on function limite_tarjeta(integer, text), red_valida(text, text), enlace_valido(text), revisar_texto_elemento(),
  exigir_comisionista(), guardar_mis_redes(text, text, text, text, text, boolean),
  guardar_mi_servicio(uuid, text, text, text, text), guardar_mi_inmueble(uuid, text, text, numeric, text, text, text),
  borrar_de_mi_tarjeta(text, uuid), ordenar_mi_tarjeta(text, uuid[]), moderar_elemento_tarjeta(text, uuid, boolean, text),
  registrar_clic_tarjeta(text, text, uuid), mis_clics_tarjeta()
  from public, anon, authenticated;
grant execute on function limite_tarjeta(integer, text), red_valida(text, text), enlace_valido(text), guardar_mis_redes(text, text, text, text, text, boolean),
  guardar_mi_servicio(uuid, text, text, text, text), guardar_mi_inmueble(uuid, text, text, numeric, text, text, text),
  borrar_de_mi_tarjeta(text, uuid), ordenar_mi_tarjeta(text, uuid[]), moderar_elemento_tarjeta(text, uuid, boolean, text),
  mis_clics_tarjeta()
  to authenticated;
-- La página pública: sin sesión.
grant execute on function registrar_clic_tarjeta(text, text, uuid) to anon, authenticated;
-- datos_tarjeta conserva sus permisos.
