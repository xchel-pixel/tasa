-- ============================================================
-- 0064 — AVISO DE PRIVACIDAD: SIMPLIFICADO, "ACTUALIZAMOS…" Y LIMPIEZA DE IP
--
-- 1. ajustes.aviso_simplificado: el texto corto que va junto a cada casilla
--    de aceptación (alta y liga de clientes). Nulo = no se muestra. Sale en
--    aviso_privacidad_publico(), sin sesión.
-- 2. avisos_vistos: qué versión del aviso integral vio cada persona en cada
--    organización y cuándo (botón "Entendido"). Cuando se publica una
--    versión nueva (ajustes.aviso_version sube), quien no la ha visto ve
--    "Actualizamos nuestro aviso de privacidad" dentro de Tasa (sin correo).
--    Las personas de hoy quedan como que ya vieron la versión vigente: el
--    aviso aparece hasta que se publique la siguiente.
-- 3. ip_resumen (el resumen de la IP para el límite de 5 envíos al día) se
--    borra a los 30 días en solicitudes de alta y solicitudes de la liga de
--    clientes. Lo hace el cron con limpiar_datos_tecnicos().
-- ============================================================

alter table ajustes add column aviso_simplificado text check (aviso_simplificado is null or char_length(aviso_simplificado) <= 600);

update ajustes set aviso_simplificado =
  'Conjuntos Habitacionales y Comerciales ROMI, S.A. de C.V. usa tus datos para atender tu solicitud y darte el servicio. Consulta el aviso integral en tasa.xgplataform.com/privacidad.'
 where organizacion_id = (select id from organizaciones where slug = 'xg');

create or replace function aviso_privacidad_publico(p_slug text default null)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('organizacion', o.nombre, 'slug', o.slug, 'texto', a.aviso_privacidad,
                            'version', a.aviso_version, 'actualizado_en', a.aviso_actualizado_en,
                            'simplificado', a.aviso_simplificado)
    from organizaciones o join ajustes a on a.organizacion_id = o.id
   where o.activa and nullif(trim(a.aviso_privacidad), '') is not null
     and (p_slug is null or o.slug = p_slug)
   order by o.creado_en
   limit 1;
$$;

create table avisos_vistos (
  organizacion_id uuid not null default mi_org() references organizaciones(id) on delete cascade,
  persona_id      uuid not null references personas(id) on delete cascade,
  aviso_version   integer not null check (aviso_version >= 0),
  visto_en        timestamptz not null default now(),
  -- 'entendido': tocó el botón; 'inicial': ya era usuario cuando nació este registro.
  origen          text not null default 'entendido' check (origen in ('entendido', 'inicial')),
  primary key (organizacion_id, persona_id, aviso_version)
);
alter table avisos_vistos enable row level security;
revoke all on avisos_vistos from anon;
create policy leer_avisos_vistos on avisos_vistos for select
  using (organizacion_id = (select mi_org()) and ((select soy_staff()) or persona_id = (select mi_persona_id())));
grant select on avisos_vistos to authenticated;

-- Los de hoy: ya vieron la versión vigente.
insert into avisos_vistos (organizacion_id, persona_id, aviso_version, origen)
select m.organizacion_id, m.persona_id, a.aviso_version, 'inicial'
  from membresias m join ajustes a on a.organizacion_id = m.organizacion_id
 where m.activa and a.aviso_version > 0
on conflict do nothing;

-- La versión que le falta ver a quien tiene la sesión, o nulo. Cuenta también la que aceptó al aceptar los términos.
create or replace function aviso_por_ver()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('version', a.aviso_version, 'actualizado_en', a.aviso_actualizado_en)
    from ajustes a
   where a.organizacion_id = mi_org() and mi_persona_id() is not null
     and a.aviso_version > 0 and nullif(trim(a.aviso_privacidad), '') is not null
     and a.aviso_version > greatest(
           coalesce((select max(v.aviso_version) from avisos_vistos v where v.organizacion_id = mi_org() and v.persona_id = mi_persona_id()), 0),
           coalesce((select max(t.aviso_version) from aceptaciones_terminos t where t.organizacion_id = mi_org() and t.persona_id = mi_persona_id()), 0));
$$;

-- "Entendido": guarda versión y fecha. Solo la versión vigente de su organización.
create or replace function marcar_aviso_visto(p_version integer)
returns void language plpgsql security definer set search_path = public as $$
begin
  if mi_persona_id() is null or mi_org() is null then
    raise exception 'Sin sesión';
  end if;
  if p_version is distinct from (select aviso_version from ajustes where organizacion_id = mi_org()) then
    raise exception 'Esa no es la versión vigente del aviso';
  end if;
  insert into avisos_vistos (organizacion_id, persona_id, aviso_version)
  values (mi_org(), mi_persona_id(), p_version)
  on conflict do nothing;
end;
$$;

-- Lo que el cron borra por antigüedad: el resumen de IP a los 30 días.
create or replace function limpiar_datos_tecnicos()
returns void language plpgsql security definer set search_path = public as $$
begin
  perform set_config('tasa.motivo', 'Limpieza automática: resumen de IP a los 30 días', true);
  update solicitudes_alta set ip_resumen = null where ip_resumen is not null and creada_en < now() - interval '30 days';
  update solicitudes set ip_resumen = null where ip_resumen is not null and creado_en < now() - interval '30 days';
  perform set_config('tasa.motivo', '', true);
end;
$$;
select limpiar_datos_tecnicos();

revoke all on function aviso_por_ver(), marcar_aviso_visto(integer), limpiar_datos_tecnicos() from public, anon, authenticated;
grant execute on function aviso_por_ver(), marcar_aviso_visto(integer) to authenticated;
grant execute on function limpiar_datos_tecnicos() to service_role;
