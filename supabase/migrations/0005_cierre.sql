-- ============================================================
-- 0005 — CIERRE MENSUAL
--
-- Corte: último día del mes a las 23:59, hora de la Ciudad de México.
-- Finanzas prepara (y puede volver a preparar); super_admin aprueba.
-- Al aprobar, en una sola transacción:
--   1. las comisiones del mes quedan amarradas al cierre y congeladas;
--   2. se calcula el nivel de cada comisionista para el mes siguiente;
--   3. las comisiones ya devengadas del mes siguiente se reajustan a
--      ese nivel (las hay si algo se pagó antes de aprobar).
-- El estado de cuenta se publica solo: es la lectura de un mes aprobado.
--
-- Cada operación tiene dos capas: la pública revisa el rol y la
-- interna (`ejecutar_…`) hace el trabajo. La interna no la puede
-- llamar nadie desde el navegador; existe para que la semilla y las
-- pruebas corran el mismo código sin simular una sesión.
-- ============================================================

-- Resumen por comisionista y por cuenta receptora. Es lo que finanzas
-- revisa antes de mandarlo a aprobar.
create or replace function resumen_del_mes(p_mes date)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(fila order by fila->>'comisionista'), '[]'::jsonb)
    from (
      select jsonb_build_object(
               'comisionista_id', c.comisionista_id,
               'comisionista',    p.nombre,
               'total',           sum(c.monto),
               'por_cuenta',      (
                 select jsonb_object_agg(cuenta, total)
                   from (
                     select coalesce(cr.titular, 'Sin cuenta') as cuenta, sum(c2.monto) as total
                       from comisiones c2
                       left join solicitudes s2 on s2.id = c2.solicitud_id
                       left join cuentas_receptoras cr on cr.id = s2.cuenta_receptora_id
                      where c2.mes = mes_de(p_mes) and c2.comisionista_id = c.comisionista_id
                      group by 1
                   ) t
               )
             ) as fila
        from comisiones c
        join personas p on p.id = c.comisionista_id
       where c.mes = mes_de(p_mes)
       group by c.comisionista_id, p.nombre
    ) x;
$$;

-- ------------------------------------------------------------
-- 1. PREPARAR
-- ------------------------------------------------------------

create or replace function ejecutar_preparacion_cierre(p_mes date, p_persona uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_mes date := mes_de(p_mes);
  v_id  uuid;
begin
  if hoy_mx() <= (v_mes + interval '1 month' - interval '1 day')::date then
    raise exception 'El mes % no ha terminado: el corte es el último día a las 23:59',
      to_char(v_mes, 'YYYY-MM');
  end if;
  if mes_aprobado(v_mes) then
    raise exception 'El cierre de % ya está aprobado', to_char(v_mes, 'YYYY-MM');
  end if;

  -- El nivel de este mes ya debería existir si el anterior se aprobó.
  perform recalcular_comisiones_del_mes(v_mes);

  insert into cierres (mes, estado, resumen, preparado_por, preparado_en)
  values (v_mes, 'preparado', resumen_del_mes(v_mes), p_persona, now())
  on conflict (mes) do update
     set resumen = excluded.resumen,
         preparado_por = excluded.preparado_por,
         preparado_en = excluded.preparado_en
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function preparar_cierre(p_mes date)
returns uuid language plpgsql security definer set search_path = public as $$
begin
  if not soy_staff() then
    raise exception 'Solo finanzas o super_admin preparan el cierre';
  end if;
  return ejecutar_preparacion_cierre(p_mes, mi_persona_id());
end;
$$;

-- ------------------------------------------------------------
-- 2. APROBAR
-- ------------------------------------------------------------

create or replace function ejecutar_aprobacion_cierre(p_mes date, p_persona uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_mes       date := mes_de(p_mes);
  v_siguiente date := (mes_de(p_mes) + interval '1 month')::date;
  v_cierre    cierres%rowtype;
  v_previo    date;
  k           record;
  n           record;
begin
  select * into v_cierre from cierres where mes = v_mes for update;
  if not found then
    raise exception 'Primero hay que preparar el cierre de %', to_char(v_mes, 'YYYY-MM');
  end if;
  if v_cierre.estado = 'aprobado' then
    raise exception 'El cierre de % ya estaba aprobado', to_char(v_mes, 'YYYY-MM');
  end if;

  -- En orden: no se aprueba un mes si uno anterior con movimientos
  -- sigue abierto. Si no, el nivel de este mes estaría mal calculado.
  select min(mes) into v_previo
    from comisiones
   where mes < v_mes and not mes_aprobado(mes);
  if v_previo is not null then
    raise exception 'Antes hay que aprobar %', to_char(v_previo, 'YYYY-MM');
  end if;

  -- Por si algo se devengó entre preparar y aprobar.
  perform recalcular_comisiones_del_mes(v_mes);

  -- Al aprobar, el porcentaje usado es el definitivo. Solo queda
  -- provisional algo en el primer mes con movimientos, que no tiene
  -- cierre anterior del cual sacar nivel: ahí manda el nivel más bajo.
  update comisiones set provisional = false where mes = v_mes and provisional;

  update comisiones set cierre_id = v_cierre.id where mes = v_mes;

  update cierres
     set estado = 'aprobado',
         resumen = resumen_del_mes(v_mes),
         aprobado_por = p_persona,
         aprobado_en = now()
   where id = v_cierre.id;

  -- Niveles del mes siguiente, para todo comisionista activo dado de
  -- alta a más tardar ese mes.
  for k in
    select c.persona_id
      from comisionistas c join personas p on p.id = c.persona_id
     where p.activo and mes_de(c.fecha_alta) <= v_siguiente
  loop
    select * into n from calcular_nivel(k.persona_id, v_siguiente);
    insert into niveles_mensuales
      (comisionista_id, mes, nivel_id, porcentaje, promedio, meses_considerados, cierre_id)
    values
      (k.persona_id, v_siguiente, n.nivel_id, n.porcentaje, n.promedio, n.meses_considerados, v_cierre.id)
    on conflict (comisionista_id, mes) do update
       set nivel_id = excluded.nivel_id,
           porcentaje = excluded.porcentaje,
           promedio = excluded.promedio,
           meses_considerados = excluded.meses_considerados,
           cierre_id = excluded.cierre_id;
  end loop;

  -- Lo que ya se devengó en el mes siguiente toma su nivel real.
  if not mes_aprobado(v_siguiente) then
    perform recalcular_comisiones_del_mes(v_siguiente);
  end if;

  return v_cierre.id;
end;
$$;

create or replace function aprobar_cierre(p_mes date)
returns uuid language plpgsql security definer set search_path = public as $$
begin
  if not soy_super_admin() then
    raise exception 'Solo super_admin aprueba el cierre';
  end if;
  return ejecutar_aprobacion_cierre(p_mes, mi_persona_id());
end;
$$;

revoke all on function resumen_del_mes(date),
  ejecutar_preparacion_cierre(date, uuid), ejecutar_aprobacion_cierre(date, uuid),
  preparar_cierre(date), aprobar_cierre(date)
  from public, anon, authenticated;
grant execute on function preparar_cierre(date), aprobar_cierre(date) to authenticated;
