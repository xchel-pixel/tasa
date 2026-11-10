-- ============================================================
-- 0074 — BITÁCORA SIN CAMBIOS VACÍOS
--
-- bitacora_org (0073) mostraba renglones de UPDATE en los que solo cambió
-- la fecha de actualización (nada que leer). Ahora se omiten. Sin otro
-- cambio.
-- ============================================================

create or replace function bitacora_org(p_desde date, p_hasta date, p_persona uuid default null, p_tabla text default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_org uuid := mi_org();
  v_ini timestamptz := (p_desde::timestamp) at time zone 'America/Mexico_City';
  v_fin timestamptz := ((p_hasta + 1)::timestamp) at time zone 'America/Mexico_City';
begin
  if not soy_admin_org() then
    raise exception 'Solo admin_org';
  end if;
  if p_desde is null or p_hasta is null or p_hasta < p_desde then
    raise exception 'Periodo inválido';
  end if;
  return jsonb_build_object(
    'filas', coalesce((select jsonb_agg(f order by f->>'creado_en' desc) from (
      select jsonb_build_object(
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
        from bitacora b
       where b.creado_en >= v_ini and b.creado_en < v_fin
         and (p_tabla is null or b.tabla = p_tabla)
         and (coalesce(b.despues ->> 'organizacion_id', b.antes ->> 'organizacion_id') = v_org::text
              or (b.tabla in ('personas', 'auth.sessions')
                  and exists (select 1 from membresias m where m.organizacion_id = v_org and m.persona_id::text = b.registro_id)))
         and (p_persona is null or b.persona_id = p_persona or b.registro_id = p_persona::text
              or b.despues ->> 'persona_id' = p_persona::text or b.antes ->> 'persona_id' = p_persona::text)
         -- Un cambio que solo movió la fecha de actualización no es un cambio que leer.
         and (b.accion <> 'UPDATE' or exists (
               select 1 from jsonb_each(coalesce(b.despues, '{}')) x
                where b.antes -> x.key is distinct from x.value and x.key not in ('actualizado_en', 'creado_en', 'id', 'organizacion_id')))
       order by b.creado_en desc
       limit 300) t), '[]'),
    'tablas', coalesce((select jsonb_agg(distinct b.tabla order by b.tabla) from bitacora b
                        where b.creado_en >= now() - interval '400 days'
                          and coalesce(b.despues ->> 'organizacion_id', b.antes ->> 'organizacion_id') = v_org::text), '[]'));
end;
$$;
