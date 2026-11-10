-- ============================================================
-- 0081 — AVANCE DE NIVEL: UNA SOLA FUENTE PARA FICHA, PORTADA Y PANEL
--
-- Separa lo que hoy se mezclaba en una frase:
-- · Este mes: el % que cobra y su nivel (con bienvenida, arranque o
--   Élite y su fecha de fin).
-- · El próximo mes: lo que daría su promedio si el mes cerrara hoy
--   (calcular_nivel del mes siguiente, igual que el cierre).
-- · Lo que falta ESTE mes: para mantener el nivel actual si la
--   proyección es menor; si ya lo asegura, para subir al siguiente.
-- La ven el comisionista (lo suyo) y admin_org/finanzas (cualquiera).
-- ============================================================

create or replace function avance_nivel(p_persona uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_org     uuid := mi_org();
  v_mes     date := mes_de(hoy_mx());
  c         comisionistas;
  p         record;
  v_act     niveles;
  v_proy    niveles;
  v_obj     niveles;
  v_tipo    text;
  v_pct     numeric;
  v_falta   numeric;
  v_especial jsonb;
  v_motivo  text;
begin
  if p_persona is distinct from mi_persona_id() and mi_rol() not in ('admin_org', 'finanzas') then
    raise exception 'Solo el comisionista o administración';
  end if;
  select * into c from comisionistas where organizacion_id = v_org and persona_id = p_persona;
  if c.persona_id is null then
    return null;
  end if;
  v_pct := porcentaje_vigente(v_org, p_persona, v_mes);
  select * into v_act from niveles where id = nivel_del_mes(v_org, p_persona, v_mes);
  select * into p from calcular_nivel(v_org, p_persona, (v_mes + interval '1 month')::date);
  select * into v_proy from niveles where id = p.nivel_id;
  v_motivo := (select motivo from niveles_mensuales where organizacion_id = v_org and comisionista_id = p_persona and mes = v_mes);

  v_especial := case
    when c.porcentaje_forzado is not null and (c.elite_vence is null or c.elite_vence >= hoy_mx())
      then jsonb_build_object('tipo', 'elite', 'hasta', c.elite_vence)
    when c.trato_hasta is not null and hoy_mx() <= c.trato_hasta and c.trato_inicial is not null
      then jsonb_build_object('tipo', c.trato_inicial, 'hasta', c.trato_hasta)
    when v_motivo = 'escalon' then jsonb_build_object('tipo', 'escalon') end;

  -- Lo que falta este mes: mantener el actual si la proyección es menor; si no, subir al siguiente (sin Élite, que no se gana por promedio).
  if v_act.id is not null and not v_act.es_forzado and v_proy.id is not null and v_proy.orden < v_act.orden then
    v_tipo := 'mantener';
    v_obj := v_act;
  elsif v_proy.id is not null and not v_proy.es_forzado then
    select * into v_obj from niveles
     where organizacion_id = v_org and not es_forzado and orden > v_proy.orden and umbral_minimo > coalesce(p.promedio, 0)
     order by orden limit 1;
    v_tipo := case when v_obj.id is not null then 'subir' end;
  end if;
  if v_tipo is not null then
    v_falta := greatest(0, ceil((v_obj.umbral_minimo - coalesce(p.promedio, 0)) * greatest(coalesce(p.meses_considerados, 1), 1)));
  end if;

  return jsonb_build_object(
    'actual', jsonb_build_object('nombre', coalesce(v_act.nombre, '—'), 'porcentaje', v_pct, 'forzado', coalesce(v_act.es_forzado, false),
                                 'provisional', porcentaje_es_provisional(v_org, p_persona, v_mes)),
    'especial', v_especial,
    'proyectado', jsonb_build_object('nombre', coalesce(v_proy.nombre, '—'), 'porcentaje', coalesce(p.porcentaje, v_proy.porcentaje),
                                     'promedio', coalesce(p.promedio, 0), 'meses', coalesce(p.meses_considerados, 0)),
    'objetivo', case when v_tipo is not null then jsonb_build_object('tipo', v_tipo, 'nombre', v_obj.nombre, 'porcentaje', v_obj.porcentaje,
                                     'umbral', v_obj.umbral_minimo, 'falta', v_falta) end,
    'comision_mes', (select coalesce(sum(monto), 0) from comisiones
                      where organizacion_id = v_org and comisionista_id = p_persona and mes = v_mes and not cobrada_directo),
    'comision_provisional', exists (select 1 from comisiones where organizacion_id = v_org and comisionista_id = p_persona
                                     and mes = v_mes and provisional));
end;
$$;

revoke all on function avance_nivel(uuid) from public, anon;
grant execute on function avance_nivel(uuid) to authenticated;

-- 0077 + el nivel de las herramientas con el mismo mes que mi_nivel_actual() (hoy_mx), no el del reloj.
create or replace function mis_herramientas()
returns table (clave text, nombre text, en_menu boolean, orden integer)
language sql stable security definer set search_path = public as $$
  select h.clave, h.nombre, h.en_menu, h.orden
    from herramientas h
   where h.organizacion_id = mi_org() and h.activa and mi_rol() = any (h.roles)
     and (mi_rol() <> 'comisionista' or h.niveles is null or mi_nivel_actual() = any (h.niveles)
          or nivel_herramientas(mi_org(), mi_persona_id(), mes_de(hoy_mx())) = any (h.niveles) or herramientas_sin_limite(mi_org(), mi_persona_id()))
     and not (mi_rol() = 'comisionista' and herramienta_de_activos(h.clave) and esta_inactiva(mi_org(), mi_persona_id()))
   order by h.orden;
$$;
