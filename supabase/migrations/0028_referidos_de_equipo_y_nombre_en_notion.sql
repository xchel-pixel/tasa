-- ============================================================
-- 0028 — REFERIDOS DEL EQUIPO Y NOMBRE DEL SERVICIO EN NOTION
--
-- Ya en producción: sin semilla ni datos de prueba. Lo único que llena
-- es configuración (códigos del equipo existente y el nombre en Notion
-- de los servicios de XG).
--
-- 1. Equipo, finanzas y admin_marca también tienen código de referido
--    (en su membresía) y su liga /alta/<org>?ref=<código>. Es solo para
--    seguimiento: se guarda aparte (`referidor_miembro_id` en la
--    solicitud, `referido_por_miembro` en el comisionista), así el
--    cálculo del bono de referidos, que lee `referido_por`, nunca lo toma.
-- 2. Interruptores "Bono de referido para equipo": por organización
--    (`ajustes.bono_referido_equipo`) y por persona
--    (`membresias.bono_referido`), apagados. Si algún día se encienden,
--    el bono cuenta dentro del tope de 30% (regla 7 de referidos).
-- 3. Quien refirió no decide su solicitud; solo admin_org decide y, si
--    él la refirió, queda marcado (`decidida_por_referidor`, bitácora).
-- 4. Reporte de referidos por persona.
-- 5. Servicios: "Nombre en Notion" para el "Tipo de Trámite". Sin él,
--    Tasa no manda el tipo (nunca crea opciones nuevas en Notion).
-- ============================================================

-- ------------------------------------------------------------
-- 1. CÓDIGO DEL EQUIPO
-- ------------------------------------------------------------

alter table membresias
  add column codigo_referido text unique check (codigo_referido ~ '^[A-HJ-KM-NP-Z2-9]{6}$'),
  add column bono_referido boolean not null default false;

alter table ajustes add column bono_referido_equipo boolean not null default false;

-- Único entre comisionistas y equipo: una liga lleva a una sola persona.
create or replace function generar_codigo_referido()
returns text language plpgsql volatile as $$
declare
  v_letras constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  v_codigo text;
begin
  loop
    v_codigo := '';
    for i in 1..6 loop
      v_codigo := v_codigo || substr(v_letras, 1 + floor(random() * char_length(v_letras))::integer, 1);
    end loop;
    exit when not exists (select 1 from comisionistas where codigo_referido = v_codigo)
          and not exists (select 1 from membresias where codigo_referido = v_codigo);
  end loop;
  return v_codigo;
end;
$$;

create or replace function codigo_de_miembro()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.rol in ('equipo', 'finanzas', 'admin_marca') and new.codigo_referido is null then
    new.codigo_referido := generar_codigo_referido();
  end if;
  return new;
end;
$$;

create trigger al_guardar_membresia_codigo
  before insert or update of rol on membresias
  for each row execute function codigo_de_miembro();

update membresias set codigo_referido = generar_codigo_referido()
 where rol in ('equipo', 'finanzas', 'admin_marca') and codigo_referido is null;

-- ------------------------------------------------------------
-- 2. DÓNDE SE GUARDA (aparte del referido de comisionista)
-- ------------------------------------------------------------

alter table solicitudes_alta
  add column referidor_miembro_id uuid references personas(id) on delete restrict,
  add column decidida_por_referidor boolean not null default false;

alter table comisionistas
  add column referido_por_miembro uuid references personas(id) on delete restrict,
  add column referido_por_miembro_desde date;

create or replace function referidor_miembro_por_codigo(p_org uuid, p_codigo text)
returns uuid language sql stable security definer set search_path = public as $$
  select m.persona_id from membresias m
   where m.organizacion_id = p_org and m.activa and m.rol in ('equipo', 'finanzas', 'admin_marca')
     and m.codigo_referido = upper(trim(p_codigo));
$$;

-- "Te invitó: <nombre>": de un comisionista o del equipo.
create or replace function invitado_por(p_org_slug text, p_codigo text)
returns text language sql stable security definer set search_path = public as $$
  select p.nombre
    from organizaciones o
    join personas p on p.id = coalesce(referidor_por_codigo(o.id, p_codigo), referidor_miembro_por_codigo(o.id, p_codigo))
   where o.slug = p_org_slug and o.activa;
$$;

create or replace function atribuir_referido(p_org uuid, p_id uuid, p_codigo text)
returns void language plpgsql security definer set search_path = public as $$
declare
  s        solicitudes_alta;
  v_ref    uuid;
  v_equipo uuid;
begin
  select * into s from solicitudes_alta where organizacion_id = p_org and id = p_id;
  v_ref := referidor_por_codigo(p_org, p_codigo);
  if v_ref is not null and es_el_referidor(p_org, v_ref, s.correo, s.rfc, s.curp) then
    v_ref := null;
  end if;
  if v_ref is null then
    v_equipo := referidor_miembro_por_codigo(p_org, p_codigo);
    if v_equipo is not null and exists (select 1 from personas where id = v_equipo and lower(correo) = s.correo) then
      v_equipo := null;
    end if;
  end if;
  update solicitudes_alta set referidor_id = v_ref, referidor_miembro_id = v_equipo
   where organizacion_id = p_org and id = p_id;
end;
$$;

-- ¿Cobraría bono este miembro? Hoy siempre no: los dos interruptores
-- nacen apagados. El cálculo del bono (otra fase) lo consulta.
create or replace function miembro_cobra_bono(p_org uuid, p_persona uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select a.bono_referido_equipo from ajustes a where a.organizacion_id = p_org), false)
     and coalesce((select m.bono_referido from membresias m where m.organizacion_id = p_org and m.persona_id = p_persona), false);
$$;

create or replace function poner_bono_referido_miembro(p_membresia uuid, p_activo boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not soy_admin_org() then
    raise exception 'Solo admin_org cambia el bono de referido del equipo';
  end if;
  update membresias set bono_referido = coalesce(p_activo, false)
   where id = p_membresia and organizacion_id = mi_org() and rol <> 'comisionista';
  if not found then
    raise exception 'No existe esa persona del equipo';
  end if;
end;
$$;

-- ------------------------------------------------------------
-- 3. APROBAR Y RECHAZAR: el referido de equipo pasa al comisionista;
--    si quien decide es quien refirió, queda marcado.
-- ------------------------------------------------------------

create or replace function aprobar_alta(
  p_id uuid, p_slug text, p_emite_factura boolean, p_bienvenida boolean,
  p_meses_bienvenida integer, p_rfc_revisado boolean
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  s          solicitudes_alta;
  v_revisado boolean;
  v_id       uuid;
begin
  if not soy_admin_org() then
    raise exception 'Solo admin_org aprueba solicitudes de alta';
  end if;
  select * into s from solicitudes_alta where organizacion_id = mi_org() and id = p_id for update;
  if not found then
    raise exception 'No existe esa solicitud';
  end if;
  if s.estado <> 'pendiente' then
    raise exception 'Esa solicitud ya no está pendiente';
  end if;
  v_revisado := s.rfc is not null and not rfc_valido(s.rfc);
  if v_revisado and not coalesce(p_rfc_revisado, false) then
    raise exception 'El dígito verificador del RFC no cuadra: marca "RFC revisado a mano" si ya lo comprobaste con la CSF';
  end if;
  if v_revisado and s.csf_ruta is null then
    raise exception 'Con "RFC revisado a mano" hace falta la CSF: pídesela o rechaza la solicitud';
  end if;

  v_id := ejecutar_alta_comisionista(s.organizacion_id, s.nombre, s.correo, s.telefono, s.rfc, s.curp, p_slug, s.referidor_id,
                                     p_emite_factura, p_bienvenida, p_meses_bienvenida, s.csf_ruta, v_revisado);
  if s.referidor_miembro_id is not null then
    update comisionistas set referido_por_miembro = s.referidor_miembro_id, referido_por_miembro_desde = hoy_mx()
     where organizacion_id = s.organizacion_id and persona_id = v_id;
  end if;
  update solicitudes_alta
     set estado = 'aprobada', decidida_por = mi_persona_id(), decidida_en = now(), persona_id = v_id,
         rfc_revisado_a_mano = v_revisado,
         decidida_por_referidor = coalesce(mi_persona_id() = s.referidor_id, false) or coalesce(mi_persona_id() = s.referidor_miembro_id, false)
   where organizacion_id = s.organizacion_id and id = p_id;
  return v_id;
end;
$$;

create or replace function rechazar_alta(p_id uuid, p_motivo text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not soy_admin_org() then
    raise exception 'Solo admin_org rechaza solicitudes de alta';
  end if;
  update solicitudes_alta
     set estado = 'rechazada', decidida_por = mi_persona_id(), decidida_en = now(), motivo = nullif(trim(p_motivo), ''),
         decidida_por_referidor = coalesce(mi_persona_id() = referidor_id, false) or coalesce(mi_persona_id() = referidor_miembro_id, false)
   where organizacion_id = mi_org() and id = p_id and estado = 'pendiente';
  if not found then
    raise exception 'Esa solicitud ya no está pendiente';
  end if;
end;
$$;

-- ------------------------------------------------------------
-- 4. REPORTE: referidos por persona (comisionistas y equipo)
-- ------------------------------------------------------------

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
  select v.referidor, p.nombre, v.tipo, count(*),
         count(*) filter (where exists (select 1 from solicitudes s
                                         where s.organizacion_id = mi_org() and s.comisionista_id = v.referido
                                           and s.pagado_en is not null and s.estado <> 'cancelada'))
    from vinculos v join personas p on p.id = v.referidor
   where mi_rol() in ('admin_org', 'finanzas')
   group by v.referidor, p.nombre, v.tipo
   order by count(*) desc, p.nombre;
$$;

-- ------------------------------------------------------------
-- 5. NOMBRE EN NOTION
-- ------------------------------------------------------------

alter table servicios add column nombre_notion text check (char_length(nombre_notion) <= 120);

-- XG: los nombres que ya existen en "Tipo de Trámite". Infonavit y
-- Fovissste no tienen equivalente: se quedan vacíos (no se manda tipo).
update servicios set nombre_notion = v.notion
  from (values ('Opinión de valor (con o sin visita)', 'Opinión de Valor'),
               ('Avalúo comercial', 'Avalúo Comercial'),
               ('Avalúo hacendario', 'Avalúo Hacendario'),
               ('Dictamen pericial', 'Peritaje para el Poder Judicial')) as v(nombre, notion)
 where servicios.organizacion_id = 'a0000000-0000-4000-8000-000000000001' and servicios.nombre = v.nombre;

create or replace function reclamar_por_crear(p_conector uuid, p_limite integer default 20)
returns table (
  solicitud_id uuid, cliente_nombre text, cliente_telefono text, cliente_correo text, servicio text,
  inmueble_direccion text, inmueble_municipio text, inmueble_clave_catastral text, inmueble_descripcion text,
  requiere_factura boolean, monto_honorarios numeric, monto_terceros numeric, aceptada_en timestamptz,
  comisionista text, marca text
) language plpgsql security definer set search_path = public as $$
declare
  k conectores%rowtype;
begin
  if not puede_operar_conector(p_conector) then
    raise exception 'Solo admin_org sincroniza el conector';
  end if;
  select * into k from conectores where id = p_conector;

  return query
  with elegidos as (
    select s.id from solicitudes s
     where s.organizacion_id = k.organizacion_id
       and s.estado = 'tramite' and s.externo_id is null
       and s.aceptada_en >= coalesce(k.activado_en, now())
       and (s.externo_reclamado_en is null or s.externo_reclamado_en < now() - interval '10 minutes')
     order by s.aceptada_en
     limit p_limite
     for update skip locked
  ), marcados as (
    update solicitudes s set externo_reclamado_en = now()
      from elegidos e where s.id = e.id
    returning s.*
  )
  -- El "Tipo de Trámite" es el nombre en Notion del servicio; sin él, nulo.
  select m.id, m.cliente_nombre, m.cliente_telefono, m.cliente_correo, nullif(trim(sv.nombre_notion), ''),
         m.inmueble_direccion, m.inmueble_municipio, m.inmueble_clave_catastral, m.inmueble_descripcion,
         m.requiere_factura, m.monto_honorarios, m.monto_terceros, m.aceptada_en,
         p.nombre, mc.nombre
    from marcados m
    join servicios sv on sv.id = m.servicio_id
    join personas p on p.id = m.comisionista_id
    left join marcas mc on mc.id = m.marca_id;
end;
$$;

-- ------------------------------------------------------------
-- PERMISOS
-- ------------------------------------------------------------

revoke all on function
  generar_codigo_referido(), codigo_de_miembro(), referidor_miembro_por_codigo(uuid, text), invitado_por(text, text),
  atribuir_referido(uuid, uuid, text), miembro_cobra_bono(uuid, uuid), poner_bono_referido_miembro(uuid, boolean),
  aprobar_alta(uuid, text, boolean, boolean, integer, boolean), rechazar_alta(uuid, text), reporte_referidos(),
  reclamar_por_crear(uuid, integer)
  from public, anon;

grant execute on function invitado_por(text, text) to anon, authenticated;
grant execute on function
  miembro_cobra_bono(uuid, uuid), poner_bono_referido_miembro(uuid, boolean),
  aprobar_alta(uuid, text, boolean, boolean, integer, boolean), rechazar_alta(uuid, text), reporte_referidos()
  to authenticated;
-- Como en 0020: solo el cron (llave del servidor).
revoke all on function reclamar_por_crear(uuid, integer) from authenticated;
grant execute on function reclamar_por_crear(uuid, integer) to service_role;
