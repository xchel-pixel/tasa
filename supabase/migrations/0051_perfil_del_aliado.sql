-- ============================================================
-- 0051 — PERFIL PROFESIONAL DEL COMISIONISTA Y "ALIADO COMERCIAL"
--
-- No todos los comisionistas son asesores inmobiliarios (p. ej. un
-- topógrafo que pide avalúos para subdivisiones y fusiones).
--
-- 1. Catálogo de perfiles por organización (lo administra admin_org en
--    Catálogos). Al nacer: Asesor inmobiliario, Topógrafo, Arquitecto,
--    Ingeniero civil, Gestor, Notaría o despacho jurídico y Constructor
--    o desarrollador.
-- 2. El comisionista elige el suyo en "Mis datos" o "Mi tarjeta". Por
--    omisión: Asesor inmobiliario. "Otro" es texto libre que admin_org
--    aprueba (alerta + ficha); mientras tanto la tarjeta sigue con el
--    perfil anterior.
-- 3. La tarjeta dice "{perfil} · aliado comercial" en vez de "Asesor
--    afiliado".
-- 4. Los textos para el cliente dicen "aliado comercial" en vez de
--    "asesor afiliado" (por omisión y en cada organización, con versión
--    y bitácora). Los términos no se tocan.
-- ============================================================

-- ------------------------------------------------------------
-- 1. CATÁLOGO DE PERFILES
-- ------------------------------------------------------------

create table perfiles (
  id               uuid primary key default gen_random_uuid(),
  organizacion_id  uuid not null default mi_org() references organizaciones(id) on delete restrict,
  nombre           text not null check (char_length(trim(nombre)) between 2 and 60),
  orden            smallint not null default 99,
  activo           boolean not null default true,
  creado_en        timestamptz not null default now(),
  unique (organizacion_id, id)
);
create unique index perfiles_nombre_unico on perfiles (organizacion_id, lower(nombre));

alter table perfiles enable row level security;
revoke all on perfiles from anon;
grant select, insert, update, delete on perfiles to authenticated;
create policy leer_perfiles on perfiles for select using (organizacion_id = (select mi_org()));
create policy admin_perfiles on perfiles for all
  using (organizacion_id = (select mi_org()) and (select soy_admin_org()))
  with check (organizacion_id = (select mi_org()) and (select soy_admin_org()));
create trigger bitacora after insert or update or delete on perfiles for each row execute function registrar_bitacora();

-- Sale en la tarjeta pública: tampoco dice perito, valuador ni las marcas.
create or replace function revisar_nombre_perfil()
returns trigger language plpgsql set search_path = public as $$
declare
  v text := palabra_prohibida(new.nombre);
begin
  if v is not null then
    raise exception 'El perfil no puede decir "%" (sin perito, valuador ni marcas)', v;
  end if;
  new.nombre := trim(new.nombre);
  return new;
end;
$$;
create trigger al_guardar_perfil before insert or update on perfiles for each row execute function revisar_nombre_perfil();

create or replace function sembrar_perfiles(p_org uuid)
returns void language sql security definer set search_path = public as $$
  insert into perfiles (organizacion_id, nombre, orden)
  select p_org, x.nombre, x.orden
    from (values ('Asesor inmobiliario', 1), ('Topógrafo', 2), ('Arquitecto', 3), ('Ingeniero civil', 4), ('Gestor', 5),
                 ('Notaría o despacho jurídico', 6), ('Constructor o desarrollador', 7)) x(nombre, orden)
  on conflict do nothing;
$$;

-- Cada organización nueva nace con el catálogo.
create or replace function al_crear_organizacion_perfiles()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform sembrar_perfiles(new.id);
  return new;
end;
$$;
create trigger sembrar_perfiles after insert on organizaciones
  for each row execute function al_crear_organizacion_perfiles();

-- Las que ya existen.
select sembrar_perfiles(id) from organizaciones;

-- ------------------------------------------------------------
-- 2. EL PERFIL DE CADA COMISIONISTA
-- ------------------------------------------------------------

alter table comisionistas
  add column perfil_id             uuid,
  -- "Otro" ya aprobado: manda sobre perfil_id.
  add column perfil_otro           text check (char_length(perfil_otro) between 2 and 60),
  -- "Otro" que espera la aprobación de admin_org (la tarjeta sigue con el anterior).
  add column perfil_solicitado     text check (char_length(perfil_solicitado) between 2 and 60),
  add column perfil_solicitado_en  timestamptz,
  -- El último rechazo, con lo que pidió y el motivo (lo ve el comisionista).
  add column perfil_rechazo        text check (char_length(perfil_rechazo) <= 400),
  add foreign key (organizacion_id, perfil_id) references perfiles (organizacion_id, id) on delete restrict;

create or replace function perfil_asesor(p_org uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select id from perfiles where organizacion_id = p_org and lower(nombre) = 'asesor inmobiliario';
$$;

-- Por omisión: Asesor inmobiliario.
create or replace function perfil_por_omision()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.perfil_id is null and new.perfil_otro is null then
    new.perfil_id := perfil_asesor(new.organizacion_id);
  end if;
  return new;
end;
$$;
create trigger perfil_por_omision before insert on comisionistas for each row execute function perfil_por_omision();

update comisionistas c set perfil_id = perfil_asesor(c.organizacion_id) where c.perfil_id is null;

-- Lo que dice la tarjeta antes de "· aliado comercial".
create or replace function perfil_de(p_org uuid, p_persona uuid)
returns text language sql stable security definer set search_path = public as $$
  select coalesce(c.perfil_otro, p.nombre, 'Asesor inmobiliario')
    from comisionistas c
    left join perfiles p on p.organizacion_id = c.organizacion_id and p.id = c.perfil_id
   where c.organizacion_id = p_org and c.persona_id = p_persona;
$$;

alter table alertas drop constraint alertas_tipo_check;
alter table alertas drop constraint alertas_tipo_completo;
alter table alertas
  add constraint alertas_tipo_check check (tipo in ('cancelado_externo', 'externo_borrado', 'liga_inactiva', 'conector',
                                                    'estimado_sin_final', 'liga_limite', 'pago_por_entregar', 'externo_solicitado',
                                                    'perfil_por_aprobar')),
  add constraint alertas_tipo_completo check (
    (tipo in ('cancelado_externo', 'externo_borrado', 'liga_inactiva', 'estimado_sin_final', 'pago_por_entregar', 'externo_solicitado')
     and solicitud_id is not null)
    or (tipo = 'conector' and conector_id is not null and codigo is not null)
    or (tipo in ('liga_limite', 'perfil_por_aprobar') and codigo is not null));

-- Cierra la alerta de "Otro" de un comisionista (si había).
create or replace function cerrar_alerta_perfil(p_org uuid, p_persona uuid, p_resolucion text)
returns void language sql security definer set search_path = public as $$
  update alertas set resuelta_en = now(), resuelta_por = mi_persona_id(), resolucion = p_resolucion
   where organizacion_id = p_org and tipo = 'perfil_por_aprobar' and codigo = p_persona::text and resuelta_en is null;
$$;

-- El comisionista elige un perfil del catálogo (p_perfil) o pide "Otro" (p_otro).
create or replace function guardar_mi_perfil(p_perfil uuid, p_otro text)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_org    uuid := mi_org();
  v_yo     uuid := mi_persona_id();
  v_otro   text := nullif(regexp_replace(trim(coalesce(p_otro, '')), '\s+', ' ', 'g'), '');
  v_igual  uuid;
  v_nombre text;
  v        text;
begin
  perform exigir_comisionista();
  if p_perfil is null and v_otro is null then
    raise exception 'Elige tu perfil o escribe cuál es';
  end if;
  if p_perfil is null then
    if char_length(v_otro) not between 2 and 60 then
      raise exception 'Tu perfil va de 2 a 60 caracteres';
    end if;
    v := palabra_prohibida(v_otro);
    if v is not null then
      raise exception 'Tu perfil no puede decir "%": eres aliado comercial (sin perito, valuador ni marcas)', v;
    end if;
    -- Si ya está en el catálogo, se elige directo.
    select id into v_igual from perfiles where organizacion_id = v_org and activo and lower(nombre) = lower(v_otro);
    if v_igual is null then
      if (select lower(perfil_otro) from comisionistas where organizacion_id = v_org and persona_id = v_yo) = lower(v_otro) then
        return 'igual';
      end if;
      update comisionistas set perfil_solicitado = v_otro, perfil_solicitado_en = now(), perfil_rechazo = null
       where organizacion_id = v_org and persona_id = v_yo;
      select nombre_visible(p) into v_nombre from personas p where p.id = v_yo;
      update alertas set mensaje = v_nombre || ' pide el perfil "' || v_otro || '" para su tarjeta.', creada_en = now()
       where organizacion_id = v_org and tipo = 'perfil_por_aprobar' and codigo = v_yo::text and resuelta_en is null;
      if not found then
        insert into alertas (organizacion_id, tipo, codigo, mensaje)
        values (v_org, 'perfil_por_aprobar', v_yo::text, v_nombre || ' pide el perfil "' || v_otro || '" para su tarjeta.');
      end if;
      return 'pendiente';
    end if;
    p_perfil := v_igual;
  end if;
  -- Uno desactivado solo si ya era el suyo.
  if not exists (select 1 from perfiles f where f.id = p_perfil and f.organizacion_id = v_org
                    and (f.activo or f.id = (select perfil_id from comisionistas where organizacion_id = v_org and persona_id = v_yo))) then
    raise exception 'Ese perfil ya no está en la lista';
  end if;
  update comisionistas set perfil_id = p_perfil, perfil_otro = null, perfil_solicitado = null, perfil_solicitado_en = null,
                           perfil_rechazo = null
   where organizacion_id = v_org and persona_id = v_yo;
  perform cerrar_alerta_perfil(v_org, v_yo, 'Eligió un perfil de la lista');
  return 'listo';
end;
$$;

-- admin_org aprueba o rechaza (con motivo) el "Otro" que pidió un comisionista.
create or replace function decidir_perfil(p_persona uuid, p_aprobar boolean, p_motivo text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := mi_org();
  c     comisionistas%rowtype;
begin
  if not soy_admin_org() then
    raise exception 'Solo admin_org aprueba perfiles';
  end if;
  select * into c from comisionistas where organizacion_id = v_org and persona_id = p_persona for update;
  if not found or c.perfil_solicitado is null then
    raise exception 'No hay un perfil por aprobar';
  end if;
  if not p_aprobar and nullif(trim(coalesce(p_motivo, '')), '') is null then
    raise exception 'Hace falta el motivo';
  end if;
  perform set_config('tasa.motivo', case when p_aprobar then 'Perfil aprobado: ' || c.perfil_solicitado
                                         else 'Perfil rechazado: ' || trim(p_motivo) end, true);
  if p_aprobar then
    update comisionistas set perfil_otro = perfil_solicitado, perfil_solicitado = null, perfil_solicitado_en = null, perfil_rechazo = null
     where organizacion_id = v_org and persona_id = p_persona;
  else
    update comisionistas set perfil_rechazo = left('"' || perfil_solicitado || '": ' || trim(p_motivo), 400),
                             perfil_solicitado = null, perfil_solicitado_en = null
     where organizacion_id = v_org and persona_id = p_persona;
  end if;
  perform cerrar_alerta_perfil(v_org, p_persona, case when p_aprobar then 'Aprobado' else 'Rechazado: ' || trim(p_motivo) end);
  perform set_config('tasa.motivo', '', true);
end;
$$;

-- admin_org le pone un perfil del catálogo (quita "Otro" y lo que estuviera por aprobar).
create or replace function poner_perfil(p_persona uuid, p_perfil uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := mi_org();
begin
  if not soy_admin_org() then
    raise exception 'Solo admin_org cambia el perfil';
  end if;
  if not exists (select 1 from perfiles where id = p_perfil and organizacion_id = v_org) then
    raise exception 'Ese perfil no está en el catálogo';
  end if;
  update comisionistas set perfil_id = p_perfil, perfil_otro = null, perfil_solicitado = null, perfil_solicitado_en = null
   where organizacion_id = v_org and persona_id = p_persona;
  if not found then
    raise exception 'No existe';
  end if;
  perform cerrar_alerta_perfil(v_org, p_persona, 'Administración le puso un perfil de la lista');
end;
$$;

-- ------------------------------------------------------------
-- 3. "ALIADO COMERCIAL" EN LOS TEXTOS PARA EL CLIENTE
-- ------------------------------------------------------------

alter table ajustes
  alter column nota_tarjeta set default
    'Los servicios de valuación los presta un despacho independiente. {nombre} es aliado comercial y no realiza los avalúos.',
  alter column nota_liga set default
    'Tu solicitud se envía a un despacho de valuación independiente, que es quien cotiza, realiza el trabajo y emite los documentos. '
    || '{nombre} es un aliado comercial: promueve el servicio mediante una alianza comercial, pero no forma parte del despacho ni es '
    || 'responsable del avalúo. La cotización indicará la empresa que realizará el trabajo y la cuenta a la que se paga.',
  alter column nota_pdf set default
    'Servicio recomendado por {nombre}, aliado comercial independiente.';

-- En cada organización (XG y DEMO incluidas): versión nueva de la nota y bitácora.
do $$
begin
  perform set_config('tasa.motivo', 'Nota de independencia: "asesor afiliado" → "aliado comercial"', true);
  update ajustes
     set nota_tarjeta = replace(replace(nota_tarjeta, 'asesor afiliado', 'aliado comercial'), 'Asesor afiliado', 'Aliado comercial'),
         nota_liga    = replace(replace(nota_liga,    'asesor afiliado', 'aliado comercial'), 'Asesor afiliado', 'Aliado comercial'),
         nota_pdf     = replace(replace(nota_pdf,     'asesor afiliado', 'aliado comercial'), 'Asesor afiliado', 'Aliado comercial')
   where nota_tarjeta ilike '%asesor afiliado%' or nota_liga ilike '%asesor afiliado%' or nota_pdf ilike '%asesor afiliado%';
  perform set_config('tasa.motivo', '', true);
end;
$$;

-- Los avisos de palabra prohibida al comisionista.
create or replace function revisar_texto_tarjeta()
returns trigger language plpgsql set search_path = public as $$
declare
  v text := palabra_prohibida(coalesce(new.frase, '') || ' ' || coalesce(new.zona, ''));
begin
  if v is not null then
    raise exception 'La tarjeta no puede decir "%": eres aliado comercial (sin perito, valuador ni marcas)', v;
  end if;
  new.actualizado_en := now();
  return new;
end;
$$;

create or replace function revisar_texto_elemento()
returns trigger language plpgsql set search_path = public as $$
declare
  v text;
begin
  -- Por jsonb: las dos tablas no tienen las mismas columnas (descripción en una, zona en la otra).
  v := palabra_prohibida(concat_ws(' ', to_jsonb(new)->>'titulo', to_jsonb(new)->>'descripcion', to_jsonb(new)->>'zona'));
  if v is not null then
    raise exception 'La tarjeta no puede decir "%": eres aliado comercial (sin perito, valuador ni marcas)', v;
  end if;
  return new;
end;
$$;

-- ------------------------------------------------------------
-- 4. LA TARJETA PÚBLICA: ahora también trae el perfil
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
    'perfil', perfil_de(o.id, c.persona_id),
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

-- ------------------------------------------------------------
-- 5. PERMISOS
-- ------------------------------------------------------------

revoke all on function revisar_nombre_perfil(), sembrar_perfiles(uuid), al_crear_organizacion_perfiles(), perfil_asesor(uuid),
  perfil_por_omision(), perfil_de(uuid, uuid), cerrar_alerta_perfil(uuid, uuid, text), guardar_mi_perfil(uuid, text),
  decidir_perfil(uuid, boolean, text), poner_perfil(uuid, uuid)
  from public, anon, authenticated;
grant execute on function guardar_mi_perfil(uuid, text), decidir_perfil(uuid, boolean, text), poner_perfil(uuid, uuid)
  to authenticated;
-- datos_tarjeta conserva sus permisos.
