-- ============================================================
-- 0033 — NOMBRE PARA MOSTRAR Y CANDADO DE FOLIOS
--
-- 1. Cada persona del equipo puede tener un "Nombre para mostrar"
--    (editable en Equipo). Es el que ve cualquiera que no sea ella: la
--    liga pública ("Te invitó: XG"), el comisionista y las listas del
--    panel. El nombre real queda solo en Equipo, para identificarla.
--    `nombre_visible(personas)` es una columna calculada: las consultas
--    piden `personas(nombre:nombre_visible)`.
-- 2. Folios con el conector manual: si para el año en curso nunca se
--    capturó el último folio real y no hay ninguno de ese año, no se
--    acepta un trabajo (la base no inventa un 0001 que choque con el
--    consecutivo real). admin_org lo captura en Ajustes → Folios (puede
--    ser 0 si de verdad el año arranca).
-- ============================================================

-- ------------------------------------------------------------
-- 1. NOMBRE PARA MOSTRAR
-- ------------------------------------------------------------

alter table personas add column nombre_para_mostrar text check (char_length(trim(nombre_para_mostrar)) between 1 and 60);

create or replace function nombre_visible(p personas)
returns text language sql stable as $$
  select coalesce(nullif(trim(p.nombre_para_mostrar), ''), p.nombre);
$$;

revoke all on function nombre_visible(personas) from public, anon;
grant execute on function nombre_visible(personas) to authenticated;

-- XG: Xchel se muestra como "XG".
update personas set nombre_para_mostrar = 'XG' where lower(correo) = 'xchel@arqosuv.com';

create or replace function poner_nombre_para_mostrar(p_persona uuid, p_nombre text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not soy_admin_org() then
    raise exception 'Solo admin_org cambia el nombre para mostrar';
  end if;
  if not exists (select 1 from membresias where persona_id = p_persona and organizacion_id = mi_org() and rol <> 'comisionista') then
    raise exception 'Esa persona no es del equipo de esta organización';
  end if;
  update personas set nombre_para_mostrar = nullif(trim(p_nombre), '') where id = p_persona;
end;
$$;

-- La sesión saluda con el nombre para mostrar.
create or replace function mi_sesion()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'persona_id',       p.id,
    'nombre',           nombre_visible(p),
    'correo',           p.correo,
    'super_plataforma', p.super_plataforma,
    'rol',              mi_rol(),
    'organizacion',     (select jsonb_build_object('id', o.id, 'nombre', o.nombre, 'slug', o.slug)
                           from organizaciones o where o.id = mi_org()),
    'visitante',        p.super_plataforma and mi_org() is not null and not exists (
                          select 1 from membresias m
                           where m.persona_id = p.id and m.organizacion_id = mi_org() and m.activa),
    'organizaciones',   (select count(*) from mis_organizaciones()),
    'debe_aceptar_terminos', debo_aceptar_terminos()
  )
    from personas p
   where p.user_id = auth.uid() and p.activo;
$$;

-- "Te invitó: <nombre para mostrar>".
create or replace function invitado_por(p_org_slug text, p_codigo text)
returns text language sql stable security definer set search_path = public as $$
  select nombre_visible(p)
    from organizaciones o
    join personas p on p.id = coalesce(referidor_por_codigo(o.id, p_codigo), referidor_miembro_por_codigo(o.id, p_codigo))
   where o.slug = p_org_slug and o.activa;
$$;

create or replace function reporte_referidos()
returns table (persona_id uuid, nombre text, tipo text, referidos bigint, con_trabajo_pagado bigint)
language sql stable security definer set search_path = public as $$
  with vinculos as (
    select c.referido_por as referidor, 'comisionista'::text as tipo, c.persona_id as referido
      from comisionistas c where c.organizacion_id = mi_org() and c.referido_por is not null
    union all
    select c.referido_por_miembro, 'equipo', c.persona_id
      from comisionistas c where c.organizacion_id = mi_org() and c.referido_por_miembro is not null
  )
  select v.referidor, nombre_visible(p), v.tipo, count(*),
         count(*) filter (where exists (select 1 from solicitudes s
                                         where s.organizacion_id = mi_org() and s.comisionista_id = v.referido
                                           and s.pagado_en is not null and s.estado <> 'cancelada'))
    from vinculos v join personas p on p.id = v.referidor
   where mi_rol() in ('admin_org', 'finanzas')
   group by v.referidor, nombre_visible(p), v.tipo
   order by count(*) desc, nombre_visible(p);
$$;

-- ------------------------------------------------------------
-- 2. CANDADO DE FOLIOS (conector manual)
-- ------------------------------------------------------------

create or replace function asignar_folio()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_tipo    text;
  v_prefijo text;
  v_anio    smallint := extract(year from hoy_mx());
  v_numero  integer;
begin
  if new.estado <> 'tramite' or new.folio is not null
     or (tg_op = 'UPDATE' and old.estado = 'tramite') then
    return new;
  end if;
  select tipo into v_tipo from conectores where organizacion_id = new.organizacion_id and activo;
  if coalesce(v_tipo, 'manual') <> 'manual' then
    return new;
  end if;

  select prefijo_folio into v_prefijo from organizaciones where id = new.organizacion_id;
  -- Nunca se capturó el último folio real de este año y no hay ninguno: no se inventa un 0001.
  if not exists (select 1 from folios_contador where organizacion_id = new.organizacion_id and anio = v_anio)
     and not exists (select 1 from solicitudes where organizacion_id = new.organizacion_id
                                                 and folio like v_prefijo || '-' || v_anio || '-%') then
    raise exception 'Antes de aceptar trabajos con el conector manual, captura en Ajustes → Folios el último folio real de % (%-%-NNNN)',
      v_anio, v_prefijo, v_anio;
  end if;

  insert into folios_contador (organizacion_id, anio, ultimo)
  values (new.organizacion_id, v_anio,
          coalesce((select max(substring(folio from '[0-9]{4}$')::integer) from solicitudes
                     where organizacion_id = new.organizacion_id
                       and folio like v_prefijo || '-' || v_anio || '-%'), 0) + 1)
  on conflict (organizacion_id, anio) do update set ultimo = folios_contador.ultimo + 1
  returning ultimo into v_numero;

  new.folio := v_prefijo || '-' || v_anio || '-' || lpad(v_numero::text, 4, '0');
  return new;
end;
$$;

-- admin_org captura el último folio real del año (el siguiente será +1).
create or replace function fijar_ultimo_folio(p_anio smallint, p_ultimo integer)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not soy_admin_org() then
    raise exception 'Solo admin_org captura el último folio';
  end if;
  if p_ultimo is null or p_ultimo < 0 or p_ultimo > 9999 then
    raise exception 'El último folio va de 0 a 9999';
  end if;
  if exists (select 1 from solicitudes s join organizaciones o on o.id = s.organizacion_id
              where s.organizacion_id = mi_org() and s.folio like o.prefijo_folio || '-' || p_anio || '-%'
                and substring(s.folio from '[0-9]{4}$')::integer > p_ultimo) then
    raise exception 'Ya hay folios de % mayores que ese número', p_anio;
  end if;
  insert into folios_contador (organizacion_id, anio, ultimo) values (mi_org(), p_anio, p_ultimo)
  on conflict (organizacion_id, anio) do update set ultimo = excluded.ultimo;
end;
$$;

create or replace function ultimo_folio(p_anio smallint)
returns integer language sql stable security definer set search_path = public as $$
  select ultimo from folios_contador where organizacion_id = mi_org() and anio = p_anio and soy_staff();
$$;

revoke all on function poner_nombre_para_mostrar(uuid, text), mi_sesion(), invitado_por(text, text), reporte_referidos(),
  asignar_folio(), fijar_ultimo_folio(smallint, integer), ultimo_folio(smallint) from public, anon;
grant execute on function invitado_por(text, text) to anon, authenticated;
grant execute on function poner_nombre_para_mostrar(uuid, text), mi_sesion(), reporte_referidos(),
  fijar_ultimo_folio(smallint, integer), ultimo_folio(smallint) to authenticated;
