-- ============================================================
-- 0023 — TASA DE BIENVENIDA, ARRANQUE Y ÉLITE CON VENCIMIENTO
--
-- El nivel de cada mes sigue saliendo del promedio de honorarios de
-- los 3 meses anteriores. Encima de eso, el trato inicial que se da en
-- el alta:
--
--   · Tasa de bienvenida (comisionistas que ya trabajaban con la
--     organización): un nivel fijo (Socio Plus, 15%) durante N meses
--     (3 por omisión). Al terminar, si su promedio lo pone más abajo,
--     baja UN nivel por cierre (15 → 12.5 → 10 → su nivel real). Subir
--     siempre es inmediato. La bajada escalonada termina en cuanto su
--     nivel real lo alcanza.
--   · Arranque (comisionistas nuevos, sin bienvenida): Aliado 10% sus
--     primeros 2 meses; después, la escalera normal.
--
-- Los dos son PISOS, no techos: si el promedio da un nivel más alto, se
-- le paga el más alto en ese momento.
--
-- Los meses cuentan desde el mes del alta, inclusive: alta el 10 de
-- noviembre con 3 meses → noviembre, diciembre y enero (hasta el 31 de
-- enero).
--
-- Élite (porcentaje fijo para casos especiales) gana una fecha de
-- vencimiento opcional: aplica hasta el mes de esa fecha, inclusive.
-- Después, el nivel vuelve a calcularse con el promedio, sin escalones.
--
-- Lo que no cambia: el tope de 30% (los niveles y el Élite no pasan de
-- 30) y lo provisional solo sube (recalcular_comisiones_del_mes).
--
-- El trato se guarda en el comisionista al darlo de alta: quien ya
-- existía antes de esta migración no cambia (sus meses ya pasaron).
-- ============================================================

-- ------------------------------------------------------------
-- 1. DATOS
-- ------------------------------------------------------------

alter table comisionistas
  add column trato_inicial text check (trato_inicial in ('bienvenida', 'arranque')),
  add column trato_nivel_id uuid,
  add column trato_desde date check (trato_desde = mes_de(trato_desde)),
  -- Último día del último mes del trato (lo que se le muestra: "hasta el 31 de enero").
  add column trato_hasta date,
  add column elite_vence date,
  add constraint trato_completo check (
    (trato_inicial is null and trato_nivel_id is null and trato_desde is null and trato_hasta is null)
    or (trato_inicial is not null and trato_nivel_id is not null and trato_desde is not null
        and trato_hasta >= trato_desde)),
  add foreign key (organizacion_id, trato_nivel_id) references niveles (organizacion_id, id);

-- Por qué quedó cada mes en su nivel: lo ve el comisionista y lo usa la
-- bajada escalonada para saber si sigue en transición.
alter table niveles_mensuales
  add column motivo text not null default 'promedio'
    check (motivo in ('promedio', 'bienvenida', 'arranque', 'escalon', 'elite'));

update niveles_mensuales nm set motivo = 'elite'
  from niveles n
 where n.organizacion_id = nm.organizacion_id and n.id = nm.nivel_id and n.es_forzado;

-- Los valores por omisión de la organización (admin_org los cambia en Niveles).
alter table ajustes
  add column bienvenida_nivel_id uuid,
  add column bienvenida_meses smallint not null default 3 check (bienvenida_meses between 1 and 12),
  add column arranque_nivel_id uuid,
  add column arranque_meses smallint not null default 2 check (arranque_meses between 0 and 12),
  add foreign key (organizacion_id, bienvenida_nivel_id) references niveles (organizacion_id, id)
    on delete set null (bienvenida_nivel_id),
  add foreign key (organizacion_id, arranque_nivel_id) references niveles (organizacion_id, id)
    on delete set null (arranque_nivel_id);

update ajustes a set
  bienvenida_nivel_id = (select id from niveles n where n.organizacion_id = a.organizacion_id and n.nombre = 'Socio Plus'),
  arranque_nivel_id   = (select id from niveles n where n.organizacion_id = a.organizacion_id and n.nombre = 'Aliado');

-- ------------------------------------------------------------
-- 2. CÁLCULO
-- ------------------------------------------------------------

-- El nivel que se usa si la organización no eligió uno: bienvenida, el
-- más alto; arranque, el segundo desde abajo.
create or replace function nivel_del_trato(p_org uuid, p_trato text)
returns uuid language sql stable security definer set search_path = public as $$
  select coalesce(
    (select case p_trato when 'bienvenida' then bienvenida_nivel_id else arranque_nivel_id end
       from ajustes where organizacion_id = p_org),
    (select id from niveles where organizacion_id = p_org and not es_forzado
      order by case when p_trato = 'bienvenida' then -porcentaje else porcentaje end
      offset case when p_trato = 'bienvenida' then 0 else 1 end limit 1));
$$;

-- El porcentaje Élite si está vigente ese mes; nulo si no tiene o ya venció.
create or replace function elite_vigente(p_org uuid, p_comisionista uuid, p_mes date)
returns numeric language sql stable security definer set search_path = public as $$
  select porcentaje_forzado from comisionistas
   where organizacion_id = p_org and persona_id = p_comisionista
     and porcentaje_forzado is not null
     and (elite_vence is null or mes_de(p_mes) <= mes_de(elite_vence));
$$;

-- El piso del trato inicial (bienvenida o arranque) si ese mes cae dentro.
create or replace function piso_del_trato(p_org uuid, p_comisionista uuid, p_mes date)
returns table (nivel_id uuid, porcentaje numeric, trato text)
language sql stable security definer set search_path = public as $$
  select n.id, n.porcentaje, c.trato_inicial
    from comisionistas c
    join niveles n on n.organizacion_id = c.organizacion_id and n.id = c.trato_nivel_id
   where c.organizacion_id = p_org and c.persona_id = p_comisionista
     and mes_de(p_mes) between c.trato_desde and mes_de(c.trato_hasta);
$$;

drop function calcular_nivel(uuid, uuid, date);

create function calcular_nivel(p_org uuid, p_comisionista uuid, p_mes date)
returns table (nivel_id uuid, porcentaje numeric, promedio numeric, meses_considerados smallint, motivo text)
language plpgsql stable security definer set search_path = public as $$
declare
  v_mes      date := mes_de(p_mes);
  v_anterior date := (mes_de(p_mes) - interval '1 month')::date;
  v_c        comisionistas%rowtype;
  v_desde    date;
  v_meses    integer;
  v_suma     numeric;
  v_elite    numeric;
  v_real_id  uuid;
  v_real_pct numeric;
  v_piso     record;
  v_prev     record;
  v_tope     numeric;
  v_escalon  record;
begin
  select * into v_c from comisionistas c where c.organizacion_id = p_org and c.persona_id = p_comisionista;

  -- Promedio de los 3 meses anteriores (desde el alta), como siempre.
  v_desde := greatest((v_mes - interval '3 months')::date, mes_de(v_c.fecha_alta));
  v_meses := case when v_desde > v_anterior then 0
                  else (extract(year from age(v_anterior, v_desde)) * 12
                        + extract(month from age(v_anterior, v_desde)))::integer + 1 end;
  select coalesce(sum(monto_honorarios), 0) into v_suma
    from solicitudes s
   where s.organizacion_id = p_org and s.comisionista_id = p_comisionista
     and s.mes_cierre between v_desde and v_anterior;
  promedio := case when v_meses = 0 then 0 else round(v_suma / v_meses, 2) end;
  meses_considerados := v_meses;

  -- 1. Élite vigente: manda sobre todo.
  v_elite := elite_vigente(p_org, p_comisionista, v_mes);
  if v_elite is not null then
    select n.id into nivel_id from niveles n where n.organizacion_id = p_org and n.es_forzado order by n.orden limit 1;
    porcentaje := v_elite;
    motivo := 'elite';
    return next;
    return;
  end if;

  -- El nivel real, por promedio.
  select n.id, n.porcentaje into v_real_id, v_real_pct
    from niveles n
   where n.organizacion_id = p_org and not n.es_forzado and n.umbral_minimo <= promedio
   order by n.umbral_minimo desc limit 1;
  nivel_id := v_real_id;
  porcentaje := v_real_pct;
  motivo := 'promedio';

  -- 2. Dentro del trato inicial: el piso, salvo que el promedio dé más.
  select * into v_piso from piso_del_trato(p_org, p_comisionista, v_mes);
  if found then
    if v_real_pct is null or v_piso.porcentaje >= v_real_pct then
      nivel_id := v_piso.nivel_id;
      porcentaje := v_piso.porcentaje;
      motivo := v_piso.trato;
    end if;
    return next;
    return;
  end if;

  -- 3. Después de la bienvenida: baja de a un nivel por cierre.
  -- Sigue en transición si el mes anterior fue de bienvenida o de escalón.
  if v_c.trato_inicial = 'bienvenida' and v_mes > mes_de(v_c.trato_hasta) then
    select nm.porcentaje, nm.motivo into v_prev
      from niveles_mensuales nm
     where nm.organizacion_id = p_org and nm.comisionista_id = p_comisionista and nm.mes = v_anterior;

    if v_anterior <= mes_de(v_c.trato_hasta) or v_prev.motivo = 'escalon' then
      -- De dónde baja: lo que tuvo el mes anterior; si no hay registro, el piso de la bienvenida.
      v_tope := coalesce(v_prev.porcentaje,
                         (select n.porcentaje from niveles n where n.organizacion_id = p_org and n.id = v_c.trato_nivel_id));
      if v_real_pct is null or v_real_pct < v_tope then
        select n.id, n.porcentaje into v_escalon
          from niveles n
         where n.organizacion_id = p_org and not n.es_forzado and n.porcentaje < v_tope
         order by n.porcentaje desc limit 1;
        if found and (v_real_pct is null or v_escalon.porcentaje > v_real_pct) then
          nivel_id := v_escalon.id;
          porcentaje := v_escalon.porcentaje;
          motivo := 'escalon';
        end if;
      end if;
    end if;
  end if;

  return next;
end;
$$;

-- El porcentaje con que nace una comisión. Sin nivel del mes todavía
-- (el cierre anterior sigue abierto): el último conocido, sin bajar del
-- piso del trato; es provisional y al aprobar solo puede subir.
create or replace function porcentaje_vigente(p_org uuid, p_comisionista uuid, p_mes date)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(
    elite_vigente(p_org, p_comisionista, p_mes),
    (select porcentaje from niveles_mensuales
      where organizacion_id = p_org and comisionista_id = p_comisionista and mes = mes_de(p_mes)),
    greatest(
      (select porcentaje from piso_del_trato(p_org, p_comisionista, p_mes)),
      (select porcentaje from niveles_mensuales
        where organizacion_id = p_org and comisionista_id = p_comisionista and mes < mes_de(p_mes)
        order by mes desc limit 1)),
    (select porcentaje from niveles where organizacion_id = p_org and not es_forzado order by orden limit 1)
  );
$$;

create or replace function porcentaje_es_provisional(p_org uuid, p_comisionista uuid, p_mes date)
returns boolean language sql stable security definer set search_path = public as $$
  select elite_vigente(p_org, p_comisionista, p_mes) is null
     and not exists (
           select 1 from niveles_mensuales
            where organizacion_id = p_org and comisionista_id = p_comisionista and mes = mes_de(p_mes));
$$;

create or replace function nivel_vigente(p_org uuid, p_comisionista uuid, p_mes date)
returns text language sql stable security definer set search_path = public as $$
  select coalesce(
    (select n.nombre from niveles n
      where elite_vigente(p_org, p_comisionista, p_mes) is not null
        and n.organizacion_id = p_org and n.es_forzado
      order by n.orden limit 1),
    (select n.nombre from niveles_mensuales nm join niveles n on n.organizacion_id = nm.organizacion_id and n.id = nm.nivel_id
      where nm.organizacion_id = p_org and nm.comisionista_id = p_comisionista and nm.mes = mes_de(p_mes)),
    (select n.nombre from piso_del_trato(p_org, p_comisionista, p_mes) t
       join niveles n on n.organizacion_id = p_org and n.id = t.nivel_id),
    (select n.nombre from niveles_mensuales nm join niveles n on n.organizacion_id = nm.organizacion_id and n.id = nm.nivel_id
      where nm.organizacion_id = p_org and nm.comisionista_id = p_comisionista and nm.mes < mes_de(p_mes)
      order by nm.mes desc limit 1),
    (select nombre from niveles where organizacion_id = p_org and not es_forzado order by orden limit 1)
  );
$$;

-- El cierre guarda también el motivo. Igual a 0016 salvo el insert de niveles.
create or replace function ejecutar_aprobacion_cierre(p_org uuid, p_mes date, p_persona uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_mes       date := mes_de(p_mes);
  v_siguiente date := (mes_de(p_mes) + interval '1 month')::date;
  v_destino   date;
  v_cierre    cierres%rowtype;
  v_previo    date;
  k           record;
  n           record;
begin
  select * into v_cierre from cierres where organizacion_id = p_org and mes = v_mes for update;
  if not found then
    raise exception 'Primero hay que preparar el cierre de %', to_char(v_mes, 'YYYY-MM');
  end if;
  if v_cierre.estado = 'aprobado' then
    raise exception 'El cierre de % ya estaba aprobado', to_char(v_mes, 'YYYY-MM');
  end if;

  select min(mes) into v_previo
    from comisiones
   where organizacion_id = p_org and mes < v_mes and not mes_aprobado(p_org, mes);
  if v_previo is not null then
    raise exception 'Antes hay que aprobar %', to_char(v_previo, 'YYYY-MM');
  end if;

  perform recalcular_comisiones_del_mes(p_org, v_mes);
  update comisiones set provisional = false
   where organizacion_id = p_org and mes = v_mes and provisional;

  v_destino := mes_abierto_desde(p_org, v_siguiente);
  for k in
    select comisionista_id, sum(monto) as total
      from comisiones where organizacion_id = p_org and mes = v_mes
     group by comisionista_id having sum(monto) < 0
  loop
    insert into comisiones (organizacion_id, comisionista_id, tipo, monto, mes, nota, creada_por)
    values (p_org, k.comisionista_id, 'arrastre', -k.total, v_mes,
            'Saldo negativo que pasa a ' || to_char(v_destino, 'YYYY-MM'), p_persona);
    insert into comisiones (organizacion_id, comisionista_id, tipo, monto, mes, nota, creada_por)
    values (p_org, k.comisionista_id, 'arrastre', k.total, v_destino,
            'Saldo negativo de ' || to_char(v_mes, 'YYYY-MM'), p_persona);
  end loop;

  update comisiones set cierre_id = v_cierre.id where organizacion_id = p_org and mes = v_mes;

  update cierres
     set estado = 'aprobado',
         resumen = resumen_del_mes(p_org, v_mes),
         aprobado_por = p_persona,
         aprobado_en = now()
   where id = v_cierre.id;

  insert into pendientes_comision (organizacion_id, comisionista_id, cierre_id, mes, monto)
  select p_org, comisionista_id, v_cierre.id, v_mes, sum(monto)
    from comisiones where organizacion_id = p_org and mes = v_mes
   group by comisionista_id having sum(monto) > 0;

  for k in
    select c.persona_id
      from comisionistas c
      join membresias m on m.persona_id = c.persona_id and m.organizacion_id = p_org and m.rol = 'comisionista'
      join personas p on p.id = c.persona_id
     where c.organizacion_id = p_org and m.activa and p.activo and mes_de(c.fecha_alta) <= v_siguiente
  loop
    select * into n from calcular_nivel(p_org, k.persona_id, v_siguiente);
    insert into niveles_mensuales
      (organizacion_id, comisionista_id, mes, nivel_id, porcentaje, promedio, meses_considerados, cierre_id, motivo)
    values
      (p_org, k.persona_id, v_siguiente, n.nivel_id, n.porcentaje, n.promedio, n.meses_considerados, v_cierre.id, n.motivo)
    on conflict (organizacion_id, comisionista_id, mes) do update
       set nivel_id = excluded.nivel_id,
           porcentaje = excluded.porcentaje,
           promedio = excluded.promedio,
           meses_considerados = excluded.meses_considerados,
           cierre_id = excluded.cierre_id,
           motivo = excluded.motivo;
  end loop;

  if not mes_aprobado(p_org, v_siguiente) then
    perform recalcular_comisiones_del_mes(p_org, v_siguiente);
  end if;

  return v_cierre.id;
end;
$$;

-- ------------------------------------------------------------
-- 3. ALTA CON TRATO INICIAL Y ÉLITE CON VENCIMIENTO
-- ------------------------------------------------------------

-- Pone el trato a partir de un mes. Lo usan el alta y la ficha (dar la
-- bienvenida a quien ya estaba dado de alta). Solo admin_org cambia la
-- cantidad de meses; finanzas usa la de la organización.
create or replace function poner_trato_inicial(p_persona uuid, p_trato text, p_meses integer, p_desde date)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_org   uuid := mi_org();
  v_nivel uuid;
  v_meses integer;
  v_desde date := mes_de(coalesce(p_desde, hoy_mx()));
begin
  if not soy_staff() then
    raise exception 'Solo finanzas o admin_org ponen el trato inicial';
  end if;
  if p_trato is null then
    update comisionistas set trato_inicial = null, trato_nivel_id = null, trato_desde = null, trato_hasta = null
     where organizacion_id = v_org and persona_id = p_persona;
    return;
  end if;
  if p_trato not in ('bienvenida', 'arranque') then
    raise exception 'Trato no válido';
  end if;

  select case when soy_admin_org() and p_meses is not null then p_meses
              when p_trato = 'bienvenida' then a.bienvenida_meses else a.arranque_meses end
    into v_meses
    from ajustes a where a.organizacion_id = v_org;
  if v_meses is null or v_meses < 1 or v_meses > 12 then
    -- Arranque en 0 meses: la organización no lo usa.
    if p_trato = 'arranque' and v_meses = 0 then return; end if;
    raise exception 'Los meses van de 1 a 12';
  end if;

  v_nivel := nivel_del_trato(v_org, p_trato);
  if v_nivel is null then
    raise exception 'La organización no tiene niveles para el trato inicial';
  end if;

  update comisionistas
     set trato_inicial = p_trato,
         trato_nivel_id = v_nivel,
         trato_desde = v_desde,
         trato_hasta = ((v_desde + make_interval(months => v_meses)) - interval '1 day')::date
   where organizacion_id = v_org and persona_id = p_persona;
  if not found then
    raise exception 'No existe ese comisionista';
  end if;
end;
$$;

drop function alta_comisionista(text, text, text, text, text, uuid, boolean);

create function alta_comisionista(
  p_nombre text, p_correo text, p_telefono text, p_rfc text, p_slug text,
  p_referido_por uuid, p_emite_factura boolean,
  p_bienvenida boolean default false, p_meses_bienvenida integer default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id    uuid;
  v_org   uuid := mi_org();
  v_corr  text := lower(trim(p_correo));
begin
  if not soy_staff() then
    raise exception 'Solo finanzas o admin_org dan de alta comisionistas';
  end if;
  if nullif(trim(p_nombre), '') is null then
    raise exception 'Falta el nombre';
  end if;
  if v_corr !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'El correo no es válido';
  end if;
  if exists (select 1 from comisionistas where organizacion_id = v_org and slug = p_slug) then
    raise exception 'Esa liga (slug) ya la usa otra persona';
  end if;

  select id into v_id from personas where lower(correo) = v_corr;
  if v_id is null then
    insert into personas (nombre, correo, telefono, organizacion_activa)
    values (trim(p_nombre), v_corr, nullif(trim(p_telefono), ''), v_org)
    returning id into v_id;
    update personas p set user_id = u.id
      from auth.users u
     where p.id = v_id and lower(u.email) = v_corr
       and not exists (select 1 from personas o where o.user_id = u.id);
  elsif exists (select 1 from membresias where persona_id = v_id and organizacion_id = v_org) then
    raise exception 'Ese correo ya está dado de alta en esta organización';
  end if;

  insert into membresias (persona_id, organizacion_id, rol) values (v_id, v_org, 'comisionista');
  insert into comisionistas (organizacion_id, persona_id, slug, rfc, referido_por, emite_factura)
  values (v_org, v_id, p_slug, nullif(upper(trim(p_rfc)), ''), p_referido_por, coalesce(p_emite_factura, false));

  -- Todo alta nace con su trato: bienvenida si se pidió; si no, arranque.
  perform poner_trato_inicial(v_id, case when coalesce(p_bienvenida, false) then 'bienvenida' else 'arranque' end,
                              case when coalesce(p_bienvenida, false) then p_meses_bienvenida end, hoy_mx());

  return v_id;
end;
$$;

drop function forzar_elite(uuid, numeric);

create function forzar_elite(p_persona uuid, p_porcentaje numeric, p_vence date default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not soy_admin_org() then
    raise exception 'Solo admin_org fuerza el nivel Élite';
  end if;
  if p_vence is not null and p_vence < hoy_mx() then
    raise exception 'El vencimiento del Élite no puede ser anterior a hoy';
  end if;
  update comisionistas
     set porcentaje_forzado = p_porcentaje,
         elite_vence = case when p_porcentaje is null then null else p_vence end
   where organizacion_id = mi_org() and persona_id = p_persona;
  if not found then
    raise exception 'No existe ese comisionista';
  end if;
end;
$$;

-- Lo que ve el comisionista de sí mismo: su trato y su Élite.
create or replace function mi_trato()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'trato',        c.trato_inicial,
    'hasta',        c.trato_hasta,
    'vigente',      c.trato_hasta is not null and hoy_mx() <= c.trato_hasta,
    'porcentaje',   (select n.porcentaje from niveles n where n.organizacion_id = c.organizacion_id and n.id = c.trato_nivel_id),
    'nivel',        (select n.nombre from niveles n where n.organizacion_id = c.organizacion_id and n.id = c.trato_nivel_id),
    'elite_vence',  case when c.porcentaje_forzado is not null then c.elite_vence end,
    'motivo_mes',   (select nm.motivo from niveles_mensuales nm
                      where nm.organizacion_id = c.organizacion_id and nm.comisionista_id = c.persona_id
                        and nm.mes = mes_de(hoy_mx()))
  )
    from comisionistas c
   where c.organizacion_id = mi_org() and c.persona_id = mi_persona_id();
$$;

-- ------------------------------------------------------------
-- 4. PERMISOS
-- ------------------------------------------------------------

revoke all on function
  nivel_del_trato(uuid, text), elite_vigente(uuid, uuid, date), piso_del_trato(uuid, uuid, date),
  calcular_nivel(uuid, uuid, date), poner_trato_inicial(uuid, text, integer, date),
  alta_comisionista(text, text, text, text, text, uuid, boolean, boolean, integer),
  forzar_elite(uuid, numeric, date), mi_trato()
  from public, anon;

grant execute on function
  calcular_nivel(uuid, uuid, date), poner_trato_inicial(uuid, text, integer, date),
  alta_comisionista(text, text, text, text, text, uuid, boolean, boolean, integer),
  forzar_elite(uuid, numeric, date), mi_trato()
  to authenticated;
