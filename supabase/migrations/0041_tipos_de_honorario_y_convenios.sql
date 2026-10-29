-- ============================================================
-- 0041 — TIPOS DE HONORARIO Y CONVENIOS
--
-- 1. Tipo de honorario de cada cotización (y del trabajo al aceptarse):
--    · fijo: como siempre.
--    · sin_costo: honorario $0, opcionalmente ligado a otro trabajo (p. ej.
--      el valor hacendario ligado a su avalúo). Nunca genera comisión ni
--      cuenta para nivel: la comisión la genera el trabajo ligado.
--    · estimado: `monto_honorarios` es el estimado (si hay rango, el máximo,
--      y `honorario_minimo` el mínimo). Antes de cerrarse, admin_org o
--      finanzas fijan el honorario final (`fijar_honorario_final`, con
--      motivo en bitácora). Sin él, en Tasa no se marca "Entregado" ni se
--      confirma el pago que lo liquidaría; desde Notion no se puede frenar,
--      así que queda una alerta. La comisión y el nivel van sobre el final.
--
-- 2. Convenios por organización (Catálogos → Convenios): precio por
--    servicio (y marca), "sin costo" por servicio y la regla de comisión
--    (normal, ninguna o % fijo en lugar del % del nivel). Al cotizar, la
--    regla se COPIA a la cotización y al trabajo: cambiar el convenio
--    después no cambia lo ya cotizado. El comisionista no lee los convenios
--    (RLS): solo ve el precio de su trabajo. Lo que no genera comisión
--    tampoco cuenta para su nivel.
--
-- 3. Ajustes sobre el precio del convenio: `ajuste_motivo` en la cotización
--    (o en el trabajo directo) se copia a la bitácora como su motivo.
--
-- 4. Notion: "Cotización" lleva el estimado y se actualiza al fijar el final
--    (`por_actualizar_monto_afuera` / `registrar_monto_afuera`).
-- ============================================================

-- ------------------------------------------------------------
-- 1. CONVENIOS
-- ------------------------------------------------------------

create table convenios (
  id               uuid primary key default gen_random_uuid(),
  organizacion_id  uuid not null default mi_org() references organizaciones(id) on delete restrict,
  nombre           text not null check (char_length(trim(nombre)) between 2 and 120),
  contacto         text check (char_length(contacto) <= 300),
  vigente_desde    date,
  vigente_hasta    date,
  notas            text check (char_length(notas) <= 2000),
  comision_regla   text not null default 'normal' check (comision_regla in ('normal', 'ninguna', 'fija')),
  comision_pct     numeric(5,2) check (comision_pct > 0 and comision_pct <= 100),
  activo           boolean not null default true,
  creado_en        timestamptz not null default now(),
  constraint convenios_pct_con_regla check ((comision_regla = 'fija') = (comision_pct is not null)),
  constraint convenios_vigencia check (vigente_hasta is null or vigente_desde is null or vigente_hasta >= vigente_desde),
  unique (organizacion_id, id)
);
create index on convenios (organizacion_id);

create table convenio_precios (
  id               uuid primary key default gen_random_uuid(),
  organizacion_id  uuid not null default mi_org() references organizaciones(id) on delete restrict,
  convenio_id      uuid not null references convenios(id) on delete cascade,
  servicio_id      uuid not null references servicios(id) on delete restrict,
  marca_id         uuid references marcas(id) on delete restrict,
  sin_costo        boolean not null default false,
  monto            numeric(12,2) not null check (monto >= 0),
  constraint convenio_precios_sin_costo check (sin_costo = (monto = 0)),
  unique nulls not distinct (convenio_id, servicio_id, marca_id)
);
create index on convenio_precios (organizacion_id);
create index on convenio_precios (convenio_id);

alter table convenios enable row level security;
alter table convenio_precios enable row level security;
revoke all on convenios, convenio_precios from anon;
grant select, insert, update, delete on convenios, convenio_precios to authenticated;

-- Quien cotiza los lee; solo admin_org los edita. El comisionista y el equipo, nada.
create policy leer_convenios on convenios for select
  using (organizacion_id = (select mi_org()) and (select mi_rol()) in ('admin_org', 'finanzas', 'admin_marca'));
create policy admin_convenios on convenios for all
  using (organizacion_id = (select mi_org()) and (select soy_admin_org()))
  with check (organizacion_id = (select mi_org()) and (select soy_admin_org()));
create policy leer_convenio_precios on convenio_precios for select
  using (organizacion_id = (select mi_org()) and (select mi_rol()) in ('admin_org', 'finanzas', 'admin_marca'));
create policy admin_convenio_precios on convenio_precios for all
  using (organizacion_id = (select mi_org()) and (select soy_admin_org()))
  with check (organizacion_id = (select mi_org()) and (select soy_admin_org())
              and convenio_id in (select id from convenios where organizacion_id = (select mi_org())));

create trigger bitacora after insert or update or delete on convenios
  for each row execute function registrar_bitacora();
create trigger bitacora after insert or update or delete on convenio_precios
  for each row execute function registrar_bitacora();

-- ------------------------------------------------------------
-- 2. TIPO DE HONORARIO EN COTIZACIONES Y TRABAJOS
-- ------------------------------------------------------------

alter table cotizaciones drop constraint cotizaciones_monto_honorarios_check;
alter table cotizaciones
  add constraint cotizaciones_monto_honorarios_check check (monto_honorarios >= 0),
  add column honorario_tipo   text not null default 'fijo' check (honorario_tipo in ('fijo', 'sin_costo', 'estimado')),
  add column honorario_minimo numeric(12,2) check (honorario_minimo >= 0),
  add column ligada_a         uuid references solicitudes(id) on delete set null,
  add column convenio_id      uuid references convenios(id) on delete set null,
  add column comision_regla   text not null default 'normal' check (comision_regla in ('normal', 'ninguna', 'fija')),
  add column comision_pct     numeric(5,2) check (comision_pct > 0 and comision_pct <= 100),
  add column ajuste_motivo    text check (char_length(ajuste_motivo) <= 500);
alter table cotizaciones add constraint cotizaciones_honorario_coherente check (
      (honorario_tipo = 'sin_costo') = (monto_honorarios = 0)
  and (honorario_minimo is null or (honorario_tipo = 'estimado' and honorario_minimo <= monto_honorarios))
  and (ligada_a is null or honorario_tipo = 'sin_costo')
  and ((comision_regla = 'fija') = (comision_pct is not null)));

alter table solicitudes
  add column honorario_tipo      text not null default 'fijo' check (honorario_tipo in ('fijo', 'sin_costo', 'estimado')),
  add column honorario_minimo    numeric(12,2) check (honorario_minimo >= 0),
  -- El estimado con que se aceptó (el máximo si fue rango); `monto_honorarios` pasa a ser el final.
  add column honorario_estimado  numeric(12,2) check (honorario_estimado > 0),
  add column honorario_final_en  timestamptz,
  add column ligada_a            uuid references solicitudes(id) on delete set null,
  add column convenio_id         uuid references convenios(id) on delete set null,
  add column comision_regla      text not null default 'normal' check (comision_regla in ('normal', 'ninguna', 'fija')),
  add column comision_pct        numeric(5,2) check (comision_pct > 0 and comision_pct <= 100),
  add column ajuste_motivo       text check (char_length(ajuste_motivo) <= 500),
  -- Se fijó el final y Notion aún tiene el estimado en "Cotización".
  add column externo_monto_pendiente boolean not null default false;
alter table solicitudes add constraint solicitudes_honorario_coherente check (
      (honorario_tipo <> 'sin_costo' or coalesce(monto_honorarios, 0) = 0)
  and (honorario_tipo <> 'estimado' or estado not in ('tramite') or honorario_estimado is not null)
  and (honorario_final_en is null or honorario_tipo = 'estimado')
  and (honorario_minimo is null or honorario_tipo = 'estimado')
  and (ligada_a is null or (honorario_tipo = 'sin_costo' and ligada_a <> id))
  and ((comision_regla = 'fija') = (comision_pct is not null)));

-- El motivo de un ajuste al precio del convenio llega a la bitácora como su motivo. Corre antes
-- que la bitácora (que es AFTER) dentro de la misma transacción.
create or replace function motivo_de_ajuste()
returns trigger language plpgsql set search_path = public as $$
begin
  if nullif(trim(coalesce(new.ajuste_motivo, '')), '') is not null
     and (tg_op = 'INSERT' or new.ajuste_motivo is distinct from old.ajuste_motivo) then
    perform set_config('tasa.motivo', 'Ajuste al convenio: ' || trim(new.ajuste_motivo), true);
  end if;
  return new;
end;
$$;
revoke all on function motivo_de_ajuste() from public, anon, authenticated;
create trigger al_ajustar_convenio before insert or update on cotizaciones
  for each row execute function motivo_de_ajuste();
create trigger al_ajustar_convenio before insert or update on solicitudes
  for each row execute function motivo_de_ajuste();

-- La regla de comisión sale del convenio al cotizar (no la escribe la pantalla).
create or replace function regla_de_convenio()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  c convenios%rowtype;
begin
  if new.convenio_id is null then
    if tg_op = 'INSERT' or new.convenio_id is distinct from old.convenio_id then
      new.comision_regla := 'normal';
      new.comision_pct := null;
    end if;
    return new;
  end if;
  if tg_op = 'UPDATE' and new.convenio_id is not distinct from old.convenio_id then
    return new;
  end if;
  select * into c from convenios where id = new.convenio_id and organizacion_id = new.organizacion_id;
  if not found then
    raise exception 'Ese convenio no es de esta organización';
  end if;
  new.comision_regla := c.comision_regla;
  new.comision_pct := c.comision_pct;
  return new;
end;
$$;
revoke all on function regla_de_convenio() from public, anon, authenticated;
create trigger al_elegir_convenio before insert or update of convenio_id on cotizaciones
  for each row execute function regla_de_convenio();
create trigger al_elegir_convenio before insert or update of convenio_id on solicitudes
  for each row execute function regla_de_convenio();

-- Al aceptar, el trabajo hereda el tipo de honorario y la regla de comisión de la cotización.
create or replace function aceptar_cotizacion(p_cotizacion uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  c cotizaciones%rowtype;
  s solicitudes%rowtype;
begin
  select * into c from cotizaciones where id = p_cotizacion and organizacion_id = mi_org() for update;
  if not found then
    raise exception 'No existe esa cotización';
  end if;

  select * into s from solicitudes where id = c.solicitud_id for update;
  if s.comisionista_id is distinct from mi_persona_id() and not soy_staff() then
    raise exception 'Esa cotización no es tuya';
  end if;
  if c.estado <> 'emitida' then
    raise exception 'La cotización ya no está vigente';
  end if;
  if c.vigente_hasta < hoy_mx() then
    raise exception 'La cotización venció el %', c.vigente_hasta;
  end if;

  update cotizaciones
     set estado = 'aceptada', respondida_en = now()
   where id = c.id;

  update solicitudes
     set estado              = 'tramite',
         estatus_publico     = 'aceptada',
         aceptada_en         = now(),
         requiere_factura    = c.requiere_factura,
         monto_honorarios    = c.monto_honorarios,
         monto_terceros      = c.monto_terceros,
         cuenta_receptora_id = c.cuenta_receptora_id,
         honorario_tipo      = c.honorario_tipo,
         honorario_minimo    = c.honorario_minimo,
         honorario_estimado  = case when c.honorario_tipo = 'estimado' then c.monto_honorarios end,
         ligada_a            = c.ligada_a,
         convenio_id         = c.convenio_id
   where id = s.id;
  -- La regla copiada de la cotización (el trigger la vuelve a tomar del convenio; aquí se respeta la emitida).
  update solicitudes set comision_regla = c.comision_regla, comision_pct = c.comision_pct where id = s.id;
end;
$$;

-- El trabajo directo nace con su estimado guardado.
create or replace function guardar_estimado()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.honorario_tipo = 'estimado' and new.estado = 'tramite' and new.honorario_estimado is null then
    new.honorario_estimado := new.monto_honorarios;
  end if;
  return new;
end;
$$;
revoke all on function guardar_estimado() from public, anon, authenticated;
create trigger al_guardar_estimado before insert or update on solicitudes
  for each row execute function guardar_estimado();

-- ------------------------------------------------------------
-- 3. HONORARIO FINAL
-- ------------------------------------------------------------

alter table alertas drop constraint alertas_tipo_check;
alter table alertas drop constraint alertas_tipo_completo;
alter table alertas
  add constraint alertas_tipo_check check (tipo in ('cancelado_externo', 'externo_borrado', 'liga_inactiva', 'conector', 'estimado_sin_final')),
  add constraint alertas_tipo_completo check (
    (tipo in ('cancelado_externo', 'externo_borrado', 'liga_inactiva', 'estimado_sin_final') and solicitud_id is not null)
    or (tipo = 'conector' and conector_id is not null and codigo is not null));

create or replace function fijar_honorario_final(p_solicitud uuid, p_monto numeric, p_motivo text)
returns void language plpgsql security definer set search_path = public as $$
declare
  s solicitudes%rowtype;
begin
  select * into s from solicitudes where id = p_solicitud and organizacion_id = mi_org() for update;
  if not found then
    raise exception 'No existe ese trabajo';
  end if;
  if not soy_staff() then
    raise exception 'Solo administración o finanzas fijan el honorario final';
  end if;
  if s.honorario_tipo <> 'estimado' or s.estado <> 'tramite' then
    raise exception 'Solo un trabajo con honorario estimado lleva honorario final';
  end if;
  if s.pagado_en is not null then
    raise exception 'El trabajo ya está pagado: su honorario no cambia';
  end if;
  if p_monto is null or p_monto <= 0 or p_monto <> round(p_monto, 2) then
    raise exception 'Escribe el honorario final (mayor a cero, hasta centavos)';
  end if;
  if char_length(trim(coalesce(p_motivo, ''))) < 3 then
    raise exception 'Escribe el motivo del honorario final';
  end if;

  perform set_config('tasa.motivo', 'Honorario final: ' || trim(p_motivo), true);
  update solicitudes
     set monto_honorarios = p_monto,
         honorario_final_en = now(),
         externo_monto_pendiente = (externo_id is not null)
   where id = s.id;
  update alertas set resuelta_en = now()
   where solicitud_id = s.id and tipo = 'estimado_sin_final' and resuelta_en is null;
  perform set_config('tasa.motivo', '', true);

  -- Si los pagos ya lo cubren, se liquida ahora (con comisión sobre el final).
  perform liquidar_si_completo(s.id);
end;
$$;
revoke all on function fijar_honorario_final(uuid, numeric, text) from public, anon;
grant execute on function fijar_honorario_final(uuid, numeric, text) to authenticated;

-- Al pasar a "Entregado" sin honorario final (solo puede venir de Notion): alerta.
create or replace function alerta_estimado_entregado()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.estatus_publico = 'entregado' and old.estatus_publico is distinct from 'entregado'
     and new.honorario_tipo = 'estimado' and new.honorario_final_en is null
     and not exists (select 1 from alertas where solicitud_id = new.id and tipo = 'estimado_sin_final' and resuelta_en is null) then
    insert into alertas (organizacion_id, tipo, solicitud_id, mensaje)
    values (new.organizacion_id, 'estimado_sin_final', new.id,
            'Se entregó sin honorario final: ' || new.cliente_nombre || coalesce(' · ' || new.folio, '')
            || '. Captúralo para poder cobrar y calcular la comisión.');
  end if;
  return null;
end;
$$;
revoke all on function alerta_estimado_entregado() from public, anon, authenticated;
create trigger al_entregar_estimado after update of estatus_publico on solicitudes
  for each row execute function alerta_estimado_entregado();

-- En Tasa, "Entregado" a mano exige el honorario final.
create or replace function cambiar_estatus_manual(p_solicitud uuid, p_estatus text)
returns void language plpgsql security definer set search_path = public as $$
declare
  s solicitudes%rowtype;
begin
  select * into s from solicitudes where id = p_solicitud and organizacion_id = mi_org() for update;
  if not found then
    raise exception 'No existe ese trabajo';
  end if;
  if not (soy_admin_org() or (mi_rol() = 'admin_marca' and s.marca_id = any (mis_marcas()))) then
    raise exception 'Solo admin_org o el admin de la marca cambian el estatus';
  end if;
  if exists (select 1 from conectores where organizacion_id = s.organizacion_id and activo and tipo <> 'manual') then
    raise exception 'El estatus lo lee el conector: cámbialo en el sistema externo';
  end if;
  if s.estado <> 'tramite' or s.estatus_publico in ('pagado', 'cancelada') then
    raise exception 'Este trabajo ya no cambia de estatus a mano';
  end if;
  if p_estatus not in ('aceptada', 'visita_agendada', 'en_elaboracion', 'en_revision', 'entregado') then
    raise exception 'Ese estatus no se pone a mano';
  end if;
  if p_estatus = 'entregado' and s.honorario_tipo = 'estimado' and s.honorario_final_en is null then
    raise exception 'Captura el honorario final antes de marcarlo Entregado';
  end if;
  update solicitudes set estatus_publico = p_estatus where id = s.id;
end;
$$;

-- ------------------------------------------------------------
-- 4. COMISIÓN Y NIVEL
-- ------------------------------------------------------------

create or replace function liquidar_si_completo(p_solicitud uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  s          solicitudes%rowtype;
  p          record;
  v_suma     numeric := 0;
  v_fecha    date;
  v_mes      date;
  v_pct      numeric;
begin
  select * into s from solicitudes where id = p_solicitud for update;
  if s.pagado_en is not null or coalesce(s.monto_total, 0) <= 0 then
    return;
  end if;

  for p in
    select monto, fecha_pago from pagos
     where solicitud_id = p_solicitud and estado = 'confirmado'
     order by fecha_pago, revisado_en, id
  loop
    v_suma := v_suma + p.monto;
    if v_suma >= s.monto_total then
      v_fecha := p.fecha_pago;
      exit;
    end if;
  end loop;

  if v_fecha is null then
    return;
  end if;

  -- Un estimado no se liquida sin su honorario final: se frena el pago que lo cerraría.
  if s.honorario_tipo = 'estimado' and s.honorario_final_en is null then
    raise exception 'Captura el honorario final antes de confirmar el pago que liquida este trabajo';
  end if;

  v_mes := mes_abierto_desde(s.organizacion_id, v_fecha);

  update solicitudes
     set pagado_en = v_fecha, mes_cierre = v_mes, estatus_publico = 'pagado'
   where id = p_solicitud;

  -- Sin comisión: liga del equipo/admin_org/inactivo, sin costo o convenio que no la genera.
  if coalesce(s.monto_honorarios, 0) > 0 and s.comisionista_id is not null and s.comision_regla <> 'ninguna' then
    v_pct := case when s.comision_regla = 'fija' then s.comision_pct
                  else porcentaje_vigente(s.organizacion_id, s.comisionista_id, v_mes) end;
    insert into comisiones (organizacion_id, comisionista_id, solicitud_id, tipo, base, porcentaje,
                            provisional, monto, mes, nota)
    values (s.organizacion_id, s.comisionista_id, s.id, 'comision', s.monto_honorarios, v_pct,
            s.comision_regla <> 'fija' and porcentaje_es_provisional(s.organizacion_id, s.comisionista_id, v_mes),
            round(s.monto_honorarios * v_pct / 100, 2), v_mes,
            case when s.comision_regla = 'fija' then 'Devengada al quedar pagado el trabajo (% fijo del convenio)'
                 else 'Devengada al quedar pagado el trabajo' end);
  end if;
end;
$$;

-- Nivel: lo que no genera comisión (convenio sin comisión) no suma. "Sin costo" ya suma 0.
create or replace function calcular_nivel(p_org uuid, p_comisionista uuid, p_mes date)
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
     and s.mes_cierre between v_desde and v_anterior
     and s.comision_regla <> 'ninguna';  -- 0041: lo que no genera comisión no cuenta para nivel
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

-- El cierre recalcula con el % del nivel; los de % fijo de convenio se quedan como están.
create or replace function recalcular_comisiones_del_mes(p_org uuid, p_mes date)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_total integer;
begin
  if mes_aprobado(p_org, p_mes) then
    raise exception 'El mes % está cerrado', to_char(p_mes, 'YYYY-MM');
  end if;

  with nuevo as (
    select c.id,
           case when c.provisional
                then greatest(c.porcentaje, porcentaje_vigente(p_org, c.comisionista_id, c.mes))
                else porcentaje_vigente(p_org, c.comisionista_id, c.mes)
           end as porcentaje,
           porcentaje_es_provisional(p_org, c.comisionista_id, c.mes) as provisional
      from comisiones c
     where c.organizacion_id = p_org and c.mes = mes_de(p_mes) and c.tipo = 'comision'
       -- 0041: el % fijo de un convenio no sigue al nivel.
       and not exists (select 1 from solicitudes s where s.id = c.solicitud_id and s.comision_regla = 'fija')
  )
  update comisiones c
     set porcentaje  = n.porcentaje,
         monto       = round(c.base * n.porcentaje / 100, 2),
         provisional = n.provisional
    from nuevo n
   where c.id = n.id
     and (c.porcentaje is distinct from n.porcentaje
          or c.provisional is distinct from n.provisional);

  get diagnostics v_total = row_count;
  return v_total;
end;
$$;

-- ------------------------------------------------------------
-- 5. NOTION: "COTIZACIÓN" AL FIJAR EL FINAL
-- ------------------------------------------------------------

create or replace function por_actualizar_monto_afuera(p_conector uuid)
returns table (solicitud_id uuid, externo_id text, monto numeric)
language sql stable security definer set search_path = public as $$
  select s.id, s.externo_id, s.monto_honorarios
    from solicitudes s join conectores k on k.id = p_conector and k.organizacion_id = s.organizacion_id
   where puede_operar_conector(p_conector)
     and s.externo_monto_pendiente and s.externo_id is not null and s.externo_baja_en is null;
$$;

create or replace function registrar_monto_afuera(p_conector uuid, p_solicitud uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not puede_operar_conector(p_conector) then
    raise exception 'Solo admin_org sincroniza el conector';
  end if;
  update solicitudes s set externo_monto_pendiente = false
    from conectores k
   where k.id = p_conector and s.id = p_solicitud and s.organizacion_id = k.organizacion_id;
end;
$$;

revoke all on function por_actualizar_monto_afuera(uuid), registrar_monto_afuera(uuid, uuid) from public, anon, authenticated;
grant execute on function por_actualizar_monto_afuera(uuid), registrar_monto_afuera(uuid, uuid) to authenticated, service_role;
