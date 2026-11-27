-- ============================================================
-- 0096 — Tope total de mosaicos por persona al día; el reporte de consumo sin cuentas de prueba
-- ============================================================
-- 1. Además de 600 por hora por capa (0095), un tope de 2,000 mosaicos por persona al día (hora de la Ciudad de México),
--    sumando todas las capas. Consumo real del 25 y 26-nov-2026: el día más pesado de una persona fueron 664 (XG con
--    todas las capas prendidas y capturas); el resto, 30 o menos. 2,000 es tres veces ese día. Al pasarlo:
--    'tope_dia' (la ruta responde 429 y la pantalla avisa que se reinicia mañana). Queda registrada la denegación.
-- 2. catastro_mosaicos_por_dia() (reporte de consumo) no cuenta las cuentas de prueba (membresias.es_demo).
-- ============================================================

create or replace function catastro_permiso_mosaico(p_capa text default 'predios')
returns text language plpgsql security definer set search_path = public as $$
declare
  v_hora     timestamptz := date_trunc('hour', now());
  v_dia      timestamptz := (date_trunc('day', now() at time zone 'America/Mexico_City')) at time zone 'America/Mexico_City';
  v_cantidad integer;
  v_dia_total integer;
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

  -- El tope del día va primero: pasado el tope, ya no se cuenta ni se sirve nada.
  select coalesce(sum(m.cantidad), 0) into v_dia_total
    from catastro_mosaicos m
   where m.organizacion_id = mi_org() and m.persona_id = mi_persona_id() and m.hora >= v_dia;
  if v_dia_total >= 2000 then
    if not exists (
         select 1 from eventos_uso e where e.persona_id = mi_persona_id() and e.herramienta = 'mapa_catastral_mosaicos'
            and e.codigo = 'tope_dia_mosaicos' and e.creado_en >= v_dia) then
      perform registrar_denegacion('mapa_catastral_mosaicos', 'tope_dia_mosaicos', 429::smallint);
    end if;
    return 'tope_dia';
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

create or replace function catastro_mosaicos_por_dia(p_desde date)
returns table (dia date, capa text, personas bigint, mosaicos bigint)
language sql stable security definer set search_path = public as $$
  select (m.hora at time zone 'America/Mexico_City')::date, m.capa, count(distinct m.persona_id), sum(m.cantidad)
    from catastro_mosaicos m
   where (m.hora at time zone 'America/Mexico_City')::date >= p_desde
     and not exists (select 1 from membresias x where x.persona_id = m.persona_id and x.organizacion_id = m.organizacion_id and x.es_demo)
   group by 1, 2
   order by 1, 2;
$$;
revoke all on function catastro_mosaicos_por_dia(date) from public, anon, authenticated;
