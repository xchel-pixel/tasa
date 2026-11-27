-- ============================================================
-- 0095 — Capas del mapa por capa, y la cuenta comisionista de prueba sin trabajos ni reportes
-- ============================================================
-- 1. Mosaicos por capa (nov-2026). Además de las líneas de predios, el equipo puede prender construcciones, uso de
--    suelo, colonias, ejidos y manzanas (lista fija en lib/catastro/capas.ts). catastro_permiso_mosaico(p_capa):
--    · el mismo permiso de siempre (admin_org, finanzas y equipo con el mapa; 403 a los demás), en cada petición;
--    · el límite de 600 por hora es POR CAPA (con cinco capas prendidas, una persona pide hasta seis veces más);
--    · el conteo guarda la capa y se conserva 45 días (antes 2) para el reporte de consumo por capa y día.
-- 2. Cuenta de prueba: se usa la "cuenta de demostración" (membresias.es_demo, 0085), que ya la saca de estadísticas,
--    inactividad, niveles y Notion y no la deja enviar solicitudes. Faltaban:
--    · recibir un trabajo ya existente (asignar_comisionista hace UPDATE, y el candado de 0085 era solo de INSERT);
--    · el resumen de comisionistas (lista con comisión del mes y saldo por pagar).
-- ============================================================

-- 1) Conteo de mosaicos por capa
alter table catastro_mosaicos add column capa text not null default 'predios';
alter table catastro_mosaicos drop constraint catastro_mosaicos_pkey;
alter table catastro_mosaicos add primary key (organizacion_id, persona_id, hora, capa);
revoke all on catastro_mosaicos from anon, authenticated;

drop function if exists catastro_permiso_mosaico();

create or replace function catastro_permiso_mosaico(p_capa text default 'predios')
returns text language plpgsql security definer set search_path = public as $$
declare
  v_hora     timestamptz := date_trunc('hour', now());
  v_cantidad integer;
  v_motivo   text;
begin
  if p_capa is null or p_capa not in ('predios', 'construcciones', 'uso_suelo', 'colonias', 'ejidos', 'manzanas') then
    return 'capa';
  end if;
  if mi_persona_id() is null or coalesce(mi_rol(), '') not in ('admin_org', 'finanzas', 'equipo') then
    v_motivo := 'rol';
  elsif not exists (select 1 from mis_herramientas() where clave = 'mapa_catastral') then
    v_motivo := 'sin_herramienta';
  end if;
  if v_motivo is not null then
    if mi_org() is not null and not exists (
         select 1 from eventos_uso e where e.persona_id = mi_persona_id() and e.herramienta = 'mapa_catastral_mosaicos'
            and e.codigo = v_motivo and e.creado_en > now() - interval '1 hour') then
      perform registrar_denegacion('mapa_catastral_mosaicos', v_motivo, 403::smallint);
    end if;
    return v_motivo;
  end if;
  insert into catastro_mosaicos as m (organizacion_id, persona_id, hora, capa, cantidad)
  values (mi_org(), mi_persona_id(), v_hora, p_capa, 1)
  on conflict (organizacion_id, persona_id, hora, capa) do update set cantidad = m.cantidad + 1
  returning cantidad into v_cantidad;
  if v_cantidad = 1 then
    delete from catastro_mosaicos where hora < now() - interval '45 days';
  end if;
  if v_cantidad = 601 then
    perform registrar_denegacion('mapa_catastral_mosaicos', 'limite_mosaicos', 429::smallint);
  end if;
  return case when v_cantidad > 600 then 'limite' else 'ok' end;
end;
$$;
revoke all on function catastro_permiso_mosaico(text) from public, anon, authenticated;
grant execute on function catastro_permiso_mosaico(text) to authenticated;

-- Para el reporte de consumo (solo la plataforma, con la llave de servicio o desde el editor): mosaicos por día y capa.
create or replace function catastro_mosaicos_por_dia(p_desde date)
returns table (dia date, capa text, personas bigint, mosaicos bigint)
language sql stable security definer set search_path = public as $$
  select (m.hora at time zone 'America/Mexico_City')::date, m.capa, count(distinct m.persona_id), sum(m.cantidad)
    from catastro_mosaicos m
   where (m.hora at time zone 'America/Mexico_City')::date >= p_desde
   group by 1, 2
   order by 1, 2;
$$;
revoke all on function catastro_mosaicos_por_dia(date) from public, anon, authenticated;

-- 2a) Una cuenta de prueba (es_demo) no recibe trabajos: tampoco al reasignar uno existente.
create or replace function demo_no_recibe_trabajos()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.comisionista_id is not null and new.comisionista_id is distinct from old.comisionista_id
     and exists (select 1 from membresias m where m.persona_id = new.comisionista_id and m.es_demo
                   and m.organizacion_id = new.organizacion_id) then
    raise exception 'Cuenta de prueba: no recibe trabajos';
  end if;
  return new;
end;
$$;
revoke all on function demo_no_recibe_trabajos() from public, anon, authenticated;
create trigger demo_no_recibe_trabajos before update of comisionista_id on solicitudes
  for each row execute function demo_no_recibe_trabajos();

-- 2b) El resumen de comisionistas (lista con comisión del mes y saldo por pagar) no la incluye.
create or replace function resumen_comisionistas()
returns table (
  persona_id uuid, nombre text, correo text, activo boolean, nivel text, porcentaje numeric,
  provisional boolean, trabajos_activos bigint, comision_mes numeric, saldo_por_pagar numeric,
  ultimo_acceso timestamptz
) language sql stable security definer set search_path = public as $$
  select p.id, p.nombre, p.correo, m.activa and p.activo,
         nivel_vigente(c.organizacion_id, p.id, hoy_mx()),
         porcentaje_vigente(c.organizacion_id, p.id, hoy_mx()),
         porcentaje_es_provisional(c.organizacion_id, p.id, hoy_mx()),
         (select count(*) from solicitudes s
           where s.organizacion_id = c.organizacion_id and s.comisionista_id = p.id
             and s.estado in ('solicitada', 'cotizada', 'tramite') and s.pagado_en is null
             and (soy_staff() or s.marca_id = any (mis_marcas()))),
         (select coalesce(sum(k.monto), 0) from comisiones k
           where k.organizacion_id = c.organizacion_id and k.comisionista_id = p.id
             and k.mes = mes_abierto_desde(c.organizacion_id, hoy_mx())
             and (soy_staff() or k.cuenta_receptora_id in (
                   select id from cuentas_receptoras where marca_id = any (mis_marcas())))),
         case when soy_staff() then
           (select coalesce(sum(monto - pagado), 0) from pendientes_comision
             where organizacion_id = c.organizacion_id and comisionista_id = p.id)
         end,
         u.last_sign_in_at
    from comisionistas c
    join personas p on p.id = c.persona_id
    join membresias m on m.persona_id = p.id and m.organizacion_id = c.organizacion_id and m.rol = 'comisionista'
    left join auth.users u on u.id = p.user_id
   where c.organizacion_id = mi_org()
     and not m.es_demo
     and (soy_staff() or mi_rol() = 'admin_marca')
   order by p.nombre;
$$;
