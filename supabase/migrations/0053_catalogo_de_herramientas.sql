-- ============================================================
-- 0053 — CATÁLOGO MÍNIMO DE HERRAMIENTAS Y MENÚ FIJO
--
-- Por organización y herramienta: si está activa, qué roles la ven,
-- (para comisionistas) qué niveles, y su lugar en el menú fijo. Lo edita
-- admin_org en Catálogos. Cupos, membresías y cobros por adicional
-- siguen para la fase 8 (docs/referidos-y-herramientas.md).
--
-- Herramientas de hoy:
--   mi_tarjeta                     activa · solo comisionistas · en el menú
--   calculadora_traslado           inactiva hasta construirla · todos · en el menú
--   calculadora_traslado_completa  inactiva · equipo/admin y comisionistas Socio,
--                                  Socio Plus y Élite · no va en el menú (es un
--                                  modo de la calculadora)
-- ============================================================

create table herramientas (
  id              uuid primary key default gen_random_uuid(),
  organizacion_id uuid not null default mi_org() references organizaciones(id) on delete restrict,
  clave           text not null check (clave in ('mi_tarjeta', 'calculadora_traslado', 'calculadora_traslado_completa')),
  nombre          text not null check (char_length(trim(nombre)) between 2 and 40),
  activa          boolean not null default false,
  -- Quién la ve. Para comisionistas, además, `niveles`: nulo = todos; una lista = solo esos (vacía = ninguno).
  roles           text[] not null default '{}'
                  check (roles <@ array['admin_org', 'finanzas', 'admin_marca', 'equipo', 'comisionista']),
  niveles         uuid[],
  en_menu         boolean not null default false,
  orden           integer not null default 99,
  actualizada_en  timestamptz not null default now(),
  unique (organizacion_id, clave)
);

alter table herramientas enable row level security;
revoke all on herramientas from anon;
create policy leer_herramientas on herramientas for select
  using (organizacion_id = (select mi_org()));
create policy admin_herramientas on herramientas for update
  using (organizacion_id = (select mi_org()) and (select soy_admin_org()))
  with check (organizacion_id = (select mi_org()) and (select soy_admin_org()));
grant select, update on herramientas to authenticated;
create trigger bitacora after insert or update or delete on herramientas
  for each row execute function registrar_bitacora();

create or replace function sembrar_herramientas(p_org uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into herramientas (organizacion_id, clave, nombre, activa, roles, niveles, en_menu, orden)
  values
    (p_org, 'mi_tarjeta', 'Mi tarjeta', true, array['comisionista'], null, true, 30),
    (p_org, 'calculadora_traslado', 'Calculadora de traslado', false,
     array['admin_org', 'finanzas', 'admin_marca', 'equipo', 'comisionista'], null, true, 40),
    (p_org, 'calculadora_traslado_completa', 'Calculadora completa', false,
     array['admin_org', 'finanzas', 'admin_marca', 'equipo', 'comisionista'],
     -- Una organización recién creada aún no tiene niveles: lista vacía (ningún comisionista) hasta que admin_org la ajuste.
     coalesce((select array_agg(id order by orden) from niveles
                where organizacion_id = p_org and (es_forzado or nombre in ('Socio', 'Socio Plus'))), '{}'), false, 41)
  on conflict (organizacion_id, clave) do nothing;
end;
$$;

create or replace function sembrar_herramientas_nueva()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform sembrar_herramientas(new.id);
  return new;
end;
$$;
-- Después de los niveles de la organización nueva (sus triggers corren antes por nombre).
create trigger sembrar_herramientas after insert on organizaciones
  for each row execute function sembrar_herramientas_nueva();

select sembrar_herramientas(id) from organizaciones;

-- El nivel con el que hoy cuenta el comisionista (guardado al cerrar el mes anterior o calculado).
create or replace function mi_nivel_actual()
returns uuid language sql stable security definer set search_path = public as $$
  select coalesce(
    (select nm.nivel_id from niveles_mensuales nm
      where nm.organizacion_id = mi_org() and nm.comisionista_id = mi_persona_id() and nm.mes = mes_de(hoy_mx())),
    (select n.nivel_id from calcular_nivel(mi_org(), mi_persona_id(), mes_de(hoy_mx())) n));
$$;

-- Las herramientas que ve quien pregunta, en orden. El menú y las pantallas se fían de esto.
create or replace function mis_herramientas()
returns table (clave text, nombre text, en_menu boolean, orden integer)
language sql stable security definer set search_path = public as $$
  select h.clave, h.nombre, h.en_menu, h.orden
    from herramientas h
   where h.organizacion_id = mi_org() and h.activa and mi_rol() = any (h.roles)
     and (mi_rol() <> 'comisionista' or h.niveles is null or mi_nivel_actual() = any (h.niveles))
   order by h.orden;
$$;

revoke all on function sembrar_herramientas(uuid), sembrar_herramientas_nueva(), mi_nivel_actual(), mis_herramientas()
  from public, anon, authenticated;
grant execute on function mis_herramientas() to authenticated;
