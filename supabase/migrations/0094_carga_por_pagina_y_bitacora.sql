-- ============================================================
-- 0094 — Menos carga por página y bitácora con índice y páginas
-- ============================================================
-- Diagnóstico (humo, 19-nov-2026): con carga sostenida la base (tamaño Micro) se satura y todas las páginas tardan
-- 3-4 veces más. Lo que más tiempo suma es mis_herramientas(), que corre en cada página (el menú): evaluaba rol, nivel e
-- inactividad POR CADA herramienta. Y la bitácora recorría todos sus renglones (abriendo el JSON de cada uno) para la
-- lista de tablas: 1.3 s sin carga, más de 8 s (límite) con carga.

-- 1) mis_herramientas: lo de la sesión se calcula UNA vez; lo del comisionista solo si hace falta. Mismo resultado.
create or replace function mis_herramientas()
returns table (clave text, nombre text, en_menu boolean, orden integer)
language sql stable security definer set search_path = public as $$
  with yo as materialized (
    select mi_org() as org, mi_rol() as rol, mi_persona_id() as persona
  ), hs as materialized (
    select h.clave, h.nombre, h.en_menu, h.orden, h.niveles
      from herramientas h, yo
     where h.organizacion_id = yo.org and h.activa and yo.rol = any (h.roles)
  ), com as materialized (
    select
      (yo.rol = 'comisionista' and exists (select 1 from hs where hs.niveles is not null)) as con_niveles,
      (yo.rol = 'comisionista' and exists (select 1 from hs where herramienta_de_activos(hs.clave))) as con_activos
      from yo
  ), calc as materialized (
    select
      case when com.con_niveles then mi_nivel_actual() end as nivel,
      case when com.con_niveles then nivel_herramientas(yo.org, yo.persona, mes_de(hoy_mx())) end as nivel_h,
      case when com.con_niveles then herramientas_sin_limite(yo.org, yo.persona) else false end as sin_limite,
      case when com.con_activos then esta_inactiva(yo.org, yo.persona) else false end as inactiva
      from yo, com
  )
  select hs.clave, hs.nombre, hs.en_menu, hs.orden
    from hs, yo, calc
   where (yo.rol <> 'comisionista' or hs.niveles is null or calc.nivel = any (hs.niveles)
          or calc.nivel_h = any (hs.niveles) or coalesce(calc.sin_limite, false))
     and not (yo.rol = 'comisionista' and herramienta_de_activos(hs.clave) and coalesce(calc.inactiva, false))
   order by hs.orden;
$$;
revoke all on function mis_herramientas() from public, anon;
grant execute on function mis_herramientas() to authenticated;

-- 2) Bitácora: la organización de cada renglón como columna calculada (la misma regla que ya usaba la función, sin
--    abrir el JSON en cada consulta) e índices por organización y fecha, y por organización y tabla.
alter table bitacora add column org_json text
  generated always as (coalesce(despues ->> 'organizacion_id', antes ->> 'organizacion_id')) stored;
create index bitacora_org_json_fecha on bitacora (org_json, id desc);
create index bitacora_org_json_tabla on bitacora (org_json, tabla);
create index bitacora_personas_registro on bitacora (registro_id, id desc) where tabla in ('personas', 'auth.sessions');

-- 3) Páginas de 100: p_antes = el id del último renglón de la página anterior ("Ver más antiguos").
drop function bitacora_org(date, date, uuid, text);
create function bitacora_org(p_desde date, p_hasta date, p_persona uuid default null, p_tabla text default null, p_antes bigint default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_org uuid := mi_org();
  v_ini timestamptz := (p_desde::timestamp) at time zone 'America/Mexico_City';
  v_fin timestamptz := ((p_hasta + 1)::timestamp) at time zone 'America/Mexico_City';
  v_filas jsonb;
  v_n integer;
begin
  if not soy_admin_org() then
    raise exception 'Solo admin_org';
  end if;
  if p_desde is null or p_hasta is null or p_hasta < p_desde then
    raise exception 'Periodo inválido';
  end if;
  with candidatos as (
    -- Lo de la organización (por índice) y los cambios de personas y sesiones de sus integrantes.
    select b.* from bitacora b
     where b.org_json = v_org::text and b.creado_en >= v_ini and b.creado_en < v_fin and (p_antes is null or b.id < p_antes)
    union
    select b.* from bitacora b
     where b.tabla in ('personas', 'auth.sessions') and b.creado_en >= v_ini and b.creado_en < v_fin and (p_antes is null or b.id < p_antes)
       and exists (select 1 from membresias m where m.organizacion_id = v_org and m.persona_id::text = b.registro_id)
  ), pagina as (
    select b.* from candidatos b
     where (p_tabla is null or b.tabla = p_tabla)
       and (p_persona is null or b.persona_id = p_persona or b.registro_id = p_persona::text
            or b.despues ->> 'persona_id' = p_persona::text or b.antes ->> 'persona_id' = p_persona::text)
       -- Un cambio que solo movió la fecha de actualización no es un cambio que leer.
       and (b.accion <> 'UPDATE' or exists (
             select 1 from jsonb_each(coalesce(b.despues, '{}')) x
              where b.antes -> x.key is distinct from x.value and x.key not in ('actualizado_en', 'creado_en', 'id', 'organizacion_id')))
     order by b.id desc
     limit 101
  )
  -- Se piden 101: si llega el 101, hay más páginas; se muestran 100.
  select coalesce(jsonb_agg(f order by id desc) filter (where rn <= 100), '[]'), count(*) into v_filas, v_n from (
    select b.id, row_number() over (order by b.id desc) as rn, jsonb_build_object(
      'id', b.id, 'creado_en', b.creado_en, 'tabla', b.tabla, 'accion', b.accion, 'motivo', nullif(b.motivo, ''),
      'quien', (select q.nombre from personas q where q.id = b.persona_id),
      'afectado', (select q.nombre from personas q
                    where q.id::text = coalesce(b.despues ->> 'persona_id', b.antes ->> 'persona_id',
                                                case when b.tabla in ('personas', 'auth.sessions') then b.registro_id end)),
      'cambios', (select coalesce(jsonb_agg(jsonb_build_object('campo', k, 'antes', left(b.antes ->> k, 80), 'despues', left(b.despues ->> k, 80))
                                            order by k), '[]')
                    from (select key k from jsonb_each(coalesce(b.despues, '{}')) union select key from jsonb_each(coalesce(b.antes, '{}'))) x
                   where b.antes -> k is distinct from b.despues -> k
                     and k not in ('actualizado_en', 'creado_en', 'id', 'organizacion_id'))) as f
      from pagina b
  ) t;
  return jsonb_build_object(
    'filas', v_filas,
    'hay_mas', v_n > 100,
    'tablas', coalesce((select jsonb_agg(t.tabla order by t.tabla) from (select distinct b.tabla from bitacora b where b.org_json = v_org::text) t), '[]'));
end;
$$;
revoke all on function bitacora_org(date, date, uuid, text, bigint) from public, anon, authenticated;
grant execute on function bitacora_org(date, date, uuid, text, bigint) to authenticated;
