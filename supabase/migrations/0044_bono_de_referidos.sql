-- ============================================================
-- 0044 — CÁLCULO DEL BONO DE REFERIDOS
--
-- Reglas (docs/referidos-y-herramientas.md):
--   · Escalón por referidos ACTIVOS del que refiere (1–2 → 2%, 3–4 → 3%,
--     5–7 → 4%, 8+ → 5%). Activo = con ≥1 trabajo pagado en los últimos
--     `referido_activo_meses` (3), contando el mes del cierre.
--   · Base: honorarios sin IVA ni terceros de los trabajos del referido
--     que quedaron pagados al 100% en el mes. Sin costo (honorario 0) y
--     convenios "sin comisión" no generan bono.
--   · Vigencia: `referido_vigencia_meses` (12) desde el PRIMER trabajo
--     pagado del referido. admin_org la amplía, acorta o quita, con motivo.
--   · El que refiere cobra el mes solo si tuvo ≥1 trabajo pagado en los
--     últimos `referido_actividad_meses` (3); si no, ese mes no se genera
--     ni se acumula. Con `referido_perdida_meses` (6) sin trabajos pagados,
--     sus vínculos quedan liberados (definitivo).
--   · Un solo nivel. Sale de la reserva (≤5%), nunca de la comisión del
--     referido. Tope 30% por trabajo (comisión + ajustes + bono): si se
--     pasa, se recorta el bono y queda anotado.
--   · Equipo: % fijo si el interruptor de la organización y el suyo están
--     encendidos y vigentes; admin_org nunca. Va en `bonos_equipo` (el
--     equipo no tiene estado de cuenta): finanzas lo marca pagado.
--   · Antifraude: además de correo, RFC y CURP, el mismo teléfono anula el
--     código al pedir el alta, y la misma CLABE de cobro anula el vínculo.
--
-- Dónde se calcula: `calcular_bonos_referido` al preparar el cierre (para
-- revisarlo) y otra vez al aprobarlo (antes del pago del día 10). Los del
-- comisionista son comisiones `tipo = 'referido'`: entran solos a su
-- estado de cuenta y al pago.
--
-- Vínculos: `vinculos_referido` guarda vigencia y estado; se sincroniza
-- con `comisionistas.referido_por` / `referido_por_miembro`, que se
-- quedan como fuente de "quién lo invitó".
-- ============================================================

-- ------------------------------------------------------------
-- 1. PARÁMETROS Y ESCALONES
-- ------------------------------------------------------------

alter table ajustes
  add column referido_vigencia_meses  smallint not null default 12 check (referido_vigencia_meses between 1 and 120),
  add column referido_activo_meses    smallint not null default 3  check (referido_activo_meses between 1 and 24),
  add column referido_actividad_meses smallint not null default 3  check (referido_actividad_meses between 1 and 24),
  add column referido_perdida_meses   smallint not null default 6  check (referido_perdida_meses between 2 and 36),
  add column referido_aviso_meses     smallint not null default 4  check (referido_aviso_meses between 1 and 36);

create table referido_escalones (
  organizacion_id uuid not null default mi_org() references organizaciones(id) on delete restrict,
  desde_activos   smallint not null check (desde_activos >= 1),
  porcentaje      numeric(5,2) not null check (porcentaje > 0 and porcentaje <= 5),
  primary key (organizacion_id, desde_activos)
);
alter table referido_escalones enable row level security;
revoke all on referido_escalones from anon;
grant select, insert, update, delete on referido_escalones to authenticated;
create policy leer_escalones on referido_escalones for select
  using (organizacion_id = (select mi_org()) and (select soy_staff()));
create policy admin_escalones on referido_escalones for all
  using (organizacion_id = (select mi_org()) and (select soy_admin_org()))
  with check (organizacion_id = (select mi_org()) and (select soy_admin_org()));
create trigger bitacora after insert or update or delete on referido_escalones
  for each row execute function registrar_bitacora();
insert into referido_escalones (organizacion_id, desde_activos, porcentaje)
select o.id, e.d, e.p from organizaciones o cross join (values (1, 2.00), (3, 3.00), (5, 4.00), (8, 5.00)) e(d, p);

-- El % del escalón para n activos (sin filas propias, la escala por omisión).
create or replace function escalon_referidos(p_org uuid, p_activos integer)
returns numeric language sql stable security definer set search_path = public as $$
  select case when coalesce(p_activos, 0) < 1 then 0 else coalesce(
    (select porcentaje from referido_escalones where organizacion_id = p_org and desde_activos <= p_activos
      order by desde_activos desc limit 1),
    case when p_activos >= 8 then 5 when p_activos >= 5 then 4 when p_activos >= 3 then 3 else 2 end) end;
$$;

-- El siguiente escalón: desde cuántos activos y con qué %. Nulo si ya está en el último.
create or replace function siguiente_escalon(p_org uuid, p_activos integer)
returns table (desde integer, porcentaje numeric) language sql stable security definer set search_path = public as $$
  with e as (
    select desde_activos::integer as d, porcentaje as p from referido_escalones where organizacion_id = p_org
    union all
    select d, p from (values (1, 2.00), (3, 3.00), (5, 4.00), (8, 5.00)) x(d, p)
     where not exists (select 1 from referido_escalones where organizacion_id = p_org)
  )
  select d, p from e where d > coalesce(p_activos, 0) order by d limit 1;
$$;

-- ------------------------------------------------------------
-- 2. CLABE DE COBRO (antifraude) Y TOPE ANOTADO
-- ------------------------------------------------------------

alter table comisionistas add column clabe_cobro text
  check (clabe_cobro is null or (clabe_cobro ~ '^[0-9]{18}$' and clabe_valida(clabe_cobro)));
alter table comisiones add column tope_ajustado boolean not null default false;

-- ------------------------------------------------------------
-- 3. VÍNCULOS DE REFERIDO
-- ------------------------------------------------------------

create table vinculos_referido (
  id              uuid primary key default gen_random_uuid(),
  organizacion_id uuid not null default mi_org() references organizaciones(id) on delete restrict,
  referido_id     uuid not null,
  referidor_id    uuid not null references personas(id) on delete restrict,
  tipo            text not null check (tipo in ('comisionista', 'equipo')),
  -- activo: corre su vigencia (en espera hasta el primer trabajo pagado; vencido al pasar `fin`).
  estado          text not null default 'activo' check (estado in ('activo', 'quitado', 'anulado', 'liberado')),
  inicio          date,
  fin             date,
  creado_en       timestamptz not null default now(),
  unique (organizacion_id, id),
  unique (organizacion_id, referido_id),
  foreign key (organizacion_id, referido_id) references comisionistas(organizacion_id, persona_id) on delete cascade,
  check (referidor_id <> referido_id),
  check (fin is null or inicio is null or fin >= inicio)
);
create index on vinculos_referido (organizacion_id, referidor_id);

create table eventos_vinculo (
  id              uuid primary key default gen_random_uuid(),
  organizacion_id uuid not null default mi_org() references organizaciones(id) on delete restrict,
  vinculo_id      uuid not null references vinculos_referido(id) on delete cascade,
  tipo            text not null check (tipo in ('inicio', 'ampliar', 'acortar', 'quitar', 'anular', 'liberar')),
  fin_anterior    date,
  fin_nuevo       date,
  motivo          text,
  persona_id      uuid references personas(id) on delete set null,
  creado_en       timestamptz not null default now()
);
create index on eventos_vinculo (vinculo_id);

alter table vinculos_referido enable row level security;
alter table eventos_vinculo enable row level security;
revoke all on vinculos_referido, eventos_vinculo from anon;
grant select on vinculos_referido, eventos_vinculo to authenticated;
-- Staff los ve todos; cada quien, los suyos como referidor (el referido no ve el vínculo).
create policy leer_vinculos on vinculos_referido for select
  using (organizacion_id = (select mi_org()) and ((select soy_staff()) or referidor_id = (select mi_persona_id())));
create policy leer_eventos_vinculo on eventos_vinculo for select
  using (organizacion_id = (select mi_org()) and (select soy_staff()));
create trigger bitacora after insert or update or delete on vinculos_referido
  for each row execute function registrar_bitacora();
create trigger bitacora after insert or update or delete on eventos_vinculo
  for each row execute function registrar_bitacora();

-- Primer trabajo pagado de un comisionista (como comisionista del trabajo).
create or replace function primer_pago_de(p_org uuid, p_comisionista uuid)
returns date language sql stable security definer set search_path = public as $$
  select min(pagado_en) from solicitudes
   where organizacion_id = p_org and comisionista_id = p_comisionista and pagado_en is not null and estado <> 'cancelada';
$$;

-- El vínculo sigue a referido_por / referido_por_miembro.
create or replace function sincronizar_vinculo()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_ref  uuid := coalesce(new.referido_por, new.referido_por_miembro);
  v_tipo text := case when new.referido_por is not null then 'comisionista' else 'equipo' end;
begin
  if tg_op = 'UPDATE' and new.referido_por is not distinct from old.referido_por
     and new.referido_por_miembro is not distinct from old.referido_por_miembro then
    return null;
  end if;
  if v_ref is null then
    update vinculos_referido set estado = 'anulado'
     where organizacion_id = new.organizacion_id and referido_id = new.persona_id and estado = 'activo';
    return null;
  end if;
  insert into vinculos_referido (organizacion_id, referido_id, referidor_id, tipo)
  values (new.organizacion_id, new.persona_id, v_ref, v_tipo)
  on conflict (organizacion_id, referido_id) do update
     set referidor_id = excluded.referidor_id, tipo = excluded.tipo, estado = 'activo', inicio = null, fin = null
   where vinculos_referido.referidor_id is distinct from excluded.referidor_id
      or vinculos_referido.estado <> 'activo';
  return null;
end;
$$;
revoke all on function sincronizar_vinculo() from public, anon, authenticated;
create trigger al_cambiar_referidor
  after insert or update of referido_por, referido_por_miembro on comisionistas
  for each row execute function sincronizar_vinculo();

-- Los vínculos que ya existen, con su inicio si el referido ya tuvo un trabajo pagado.
insert into vinculos_referido (organizacion_id, referido_id, referidor_id, tipo, inicio, fin)
select c.organizacion_id, c.persona_id, coalesce(c.referido_por, c.referido_por_miembro),
       case when c.referido_por is not null then 'comisionista' else 'equipo' end,
       primer_pago_de(c.organizacion_id, c.persona_id),
       (primer_pago_de(c.organizacion_id, c.persona_id) + make_interval(months => a.referido_vigencia_meses) - interval '1 day')::date
  from comisionistas c join ajustes a on a.organizacion_id = c.organizacion_id
 where coalesce(c.referido_por, c.referido_por_miembro) is not null
on conflict do nothing;

-- Estado que se ve: en espera (sin primer pago), vigente o vencido (a una fecha), o el manual.
create or replace function estado_vinculo(v vinculos_referido, p_fecha date)
returns text language sql stable security definer set search_path = public as $$
  select case
    when v.estado <> 'activo' then v.estado
    when coalesce(v.inicio, primer_pago_de(v.organizacion_id, v.referido_id)) is null then 'en_espera'
    when coalesce(v.fin, (coalesce(v.inicio, primer_pago_de(v.organizacion_id, v.referido_id))
                          + make_interval(months => (select referido_vigencia_meses from ajustes where organizacion_id = v.organizacion_id))
                          - interval '1 day')::date) < p_fecha then 'vencido'
    else 'vigente' end;
$$;

-- ------------------------------------------------------------
-- 4. ANTIFRAUDE: TELÉFONO AL PEDIR EL ALTA, CLABE AL GUARDARLA
-- ------------------------------------------------------------

create or replace function diez_digitos(p text)
returns text language sql immutable set search_path = public as $$
  select nullif(right(regexp_replace(coalesce(p, ''), '\D', '', 'g'), 10), '');
$$;

-- ¿Es la misma persona que quien refiere? Correo, RFC, CURP o teléfono (comisionista o equipo).
create or replace function es_autorreferido(p_org uuid, p_referidor uuid, p_correo text, p_rfc text, p_curp text, p_telefono text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from personas p left join comisionistas c on c.persona_id = p.id and c.organizacion_id = p_org
     where p.id = p_referidor
       and (lower(p.correo) = lower(trim(p_correo))
            or (c.rfc is not null and c.rfc = upper(trim(p_rfc)))
            or (c.curp is not null and c.curp = upper(trim(p_curp)))
            or (diez_digitos(p.telefono) is not null and diez_digitos(p.telefono) = diez_digitos(p_telefono))));
$$;

create or replace function atribuir_referido(p_org uuid, p_id uuid, p_codigo text)
returns void language plpgsql security definer set search_path = public as $$
declare
  s        solicitudes_alta;
  v_ref    uuid;
  v_equipo uuid;
begin
  select * into s from solicitudes_alta where organizacion_id = p_org and id = p_id;
  v_ref := referidor_por_codigo(p_org, p_codigo);
  if v_ref is not null and es_autorreferido(p_org, v_ref, s.correo, s.rfc, s.curp, s.telefono) then
    v_ref := null;
  end if;
  if v_ref is null then
    v_equipo := referidor_miembro_por_codigo(p_org, p_codigo);
    if v_equipo is not null and es_autorreferido(p_org, v_equipo, s.correo, s.rfc, s.curp, s.telefono) then
      v_equipo := null;
    end if;
  end if;
  update solicitudes_alta set referidor_id = v_ref, referidor_miembro_id = v_equipo
   where organizacion_id = p_org and id = p_id;
end;
$$;

-- Misma CLABE de cobro que quien lo invitó (o que alguien que él invitó): el vínculo se anula.
create or replace function revisar_clabe_cobro()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v record;
begin
  if new.clabe_cobro is null or new.clabe_cobro is not distinct from old.clabe_cobro then
    return null;
  end if;
  for v in
    select vr.* from vinculos_referido vr
      join comisionistas otro on otro.organizacion_id = vr.organizacion_id
                             and otro.persona_id = case when vr.referido_id = new.persona_id then vr.referidor_id else vr.referido_id end
     where vr.organizacion_id = new.organizacion_id and vr.estado = 'activo' and vr.tipo = 'comisionista'
       and (vr.referido_id = new.persona_id or vr.referidor_id = new.persona_id)
       and otro.clabe_cobro = new.clabe_cobro
  loop
    perform set_config('tasa.motivo', 'Autorreferido: misma CLABE de cobro', true);
    update vinculos_referido set estado = 'anulado' where id = v.id;
    insert into eventos_vinculo (organizacion_id, vinculo_id, tipo, fin_anterior, fin_nuevo, motivo)
    values (v.organizacion_id, v.id, 'anular', v.fin, v.fin, 'Autorreferido: misma CLABE de cobro');
  end loop;
  return null;
end;
$$;
revoke all on function revisar_clabe_cobro() from public, anon, authenticated;
create trigger al_guardar_clabe_cobro after update of clabe_cobro on comisionistas
  for each row execute function revisar_clabe_cobro();

-- El comisionista guarda su propia CLABE de cobro (Mis datos).
create or replace function poner_mi_clabe_cobro(p_clabe text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v text := nullif(regexp_replace(coalesce(p_clabe, ''), '\D', '', 'g'), '');
begin
  if mi_rol() is distinct from 'comisionista' then
    raise exception 'Solo el comisionista guarda su CLABE de cobro';
  end if;
  if v is not null and (v !~ '^[0-9]{18}$' or not clabe_valida(v)) then
    raise exception 'La CLABE no es válida: son 18 dígitos y el último es de control';
  end if;
  update comisionistas set clabe_cobro = v where organizacion_id = mi_org() and persona_id = mi_persona_id();
end;
$$;

-- ------------------------------------------------------------
-- 5. BONO DEL EQUIPO (registro aparte)
-- ------------------------------------------------------------

create table bonos_equipo (
  id              uuid primary key default gen_random_uuid(),
  organizacion_id uuid not null default mi_org() references organizaciones(id) on delete restrict,
  persona_id      uuid not null references personas(id) on delete restrict,
  referido_id     uuid not null references personas(id) on delete restrict,
  solicitud_id    uuid not null,
  mes             date not null check (mes = mes_de(mes)),
  base            numeric(12,2) not null,
  porcentaje      numeric(5,2) not null,
  monto           numeric(12,2) not null check (monto > 0),
  tope_ajustado   boolean not null default false,
  estado          text not null default 'devengado' check (estado in ('devengado', 'pagado')),
  pagado_en       date,
  pagado_por      uuid references personas(id) on delete set null,
  referencia      text check (char_length(referencia) <= 200),
  creado_en       timestamptz not null default now(),
  unique (organizacion_id, id),
  unique (organizacion_id, solicitud_id),
  foreign key (organizacion_id, solicitud_id) references solicitudes(organizacion_id, id) on delete restrict,
  check ((estado = 'pagado') = (pagado_en is not null))
);
create index on bonos_equipo (organizacion_id, mes);
alter table bonos_equipo enable row level security;
revoke all on bonos_equipo from anon;
grant select on bonos_equipo to authenticated;
create policy leer_bonos_equipo on bonos_equipo for select
  using (organizacion_id = (select mi_org()) and ((select soy_staff()) or persona_id = (select mi_persona_id())));
create trigger bitacora after insert or update or delete on bonos_equipo
  for each row execute function registrar_bitacora();

create or replace function marcar_bono_equipo_pagado(p_bono uuid, p_fecha date, p_referencia text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not soy_staff() then
    raise exception 'Solo administración o finanzas registran el pago del bono';
  end if;
  if p_fecha is null or p_fecha > hoy_mx() then
    raise exception 'La fecha de pago no puede ser futura';
  end if;
  perform set_config('tasa.motivo', 'Pago de bono de referidos del equipo', true);
  update bonos_equipo set estado = 'pagado', pagado_en = p_fecha, pagado_por = mi_persona_id(),
         referencia = nullif(trim(p_referencia), '')
   where id = p_bono and organizacion_id = mi_org() and estado = 'devengado'
     and mes_aprobado(organizacion_id, mes);
  if not found then
    raise exception 'Ese bono no está por pagar (o su cierre no se ha aprobado)';
  end if;
end;
$$;

-- ------------------------------------------------------------
-- 6. EL CÁLCULO
-- ------------------------------------------------------------

-- Lo que generaría cada trabajo pagado en el mes, sin guardar nada (lo usan el cierre y las pantallas).
create or replace function bonos_referido_calculados(p_org uuid, p_mes date)
returns table (beneficiario uuid, tipo text, referido uuid, solicitud uuid, base numeric, porcentaje numeric,
               bruto numeric, monto numeric, tope_ajustado boolean, activos integer)
language plpgsql stable security definer set search_path = public as $$
declare
  a        ajustes%rowtype;
  v_mes    date := mes_de(p_mes);
  v_fin    date := (mes_de(p_mes) + interval '1 month' - interval '1 day')::date;
  r        record;
  t        record;
  v_pct    numeric;
  v_act    integer;
  v_ya     numeric;
  v_bruto  numeric;
  v_monto  numeric;
begin
  select * into a from ajustes where organizacion_id = p_org;

  for r in
    select distinct vr.referidor_id, vr.tipo from vinculos_referido vr
     where vr.organizacion_id = p_org and vr.estado = 'activo'
  loop
    if r.tipo = 'comisionista' then
      -- Regla 4: el que refiere tuvo un trabajo pagado en los últimos N meses (contando éste).
      if not exists (select 1 from solicitudes s
                      where s.organizacion_id = p_org and s.comisionista_id = r.referidor_id and s.pagado_en is not null
                        and s.estado <> 'cancelada'
                        and s.mes_cierre between (v_mes - make_interval(months => a.referido_actividad_meses - 1))::date and v_mes) then
        continue;
      end if;
      -- Regla 2: referidos activos con vínculo vigente en el mes.
      select count(*) into v_act from vinculos_referido vr
       where vr.organizacion_id = p_org and vr.referidor_id = r.referidor_id and vr.tipo = 'comisionista'
         and estado_vinculo(vr, v_mes) = 'vigente'
         and exists (select 1 from solicitudes s
                      where s.organizacion_id = p_org and s.comisionista_id = vr.referido_id and s.pagado_en is not null
                        and s.estado <> 'cancelada'
                        and s.mes_cierre between (v_mes - make_interval(months => a.referido_activo_meses - 1))::date and v_mes);
      v_pct := escalon_referidos(p_org, v_act);
    else
      -- Equipo: los dos interruptores, no admin_org, y su % fijo.
      select case when coalesce(a.bono_referido_equipo, false) and m.bono_referido and m.rol <> 'admin_org' and m.activa
                  then m.bono_referido_pct end, null
        into v_pct, v_act
        from membresias m where m.organizacion_id = p_org and m.persona_id = r.referidor_id;
    end if;
    if coalesce(v_pct, 0) <= 0 then
      continue;
    end if;

    for t in
      select s.id, s.comisionista_id, s.monto_honorarios, s.pagado_en,
             (select m.bono_referido_hasta from membresias m where m.organizacion_id = p_org and m.persona_id = r.referidor_id) as hasta
        from vinculos_referido vr
        join solicitudes s on s.organizacion_id = p_org and s.comisionista_id = vr.referido_id
       where vr.organizacion_id = p_org and vr.referidor_id = r.referidor_id and vr.tipo = r.tipo and vr.estado = 'activo'
         and s.mes_cierre = v_mes and s.pagado_en is not null and s.estado <> 'cancelada'
         and coalesce(s.monto_honorarios, 0) > 0 and s.comision_regla <> 'ninguna' and s.honorario_tipo <> 'sin_costo'
         -- Dentro de la vigencia del vínculo (desde el primer trabajo pagado).
         and s.pagado_en >= coalesce(vr.inicio, primer_pago_de(p_org, vr.referido_id))
         and s.pagado_en <= coalesce(vr.fin, (coalesce(vr.inicio, primer_pago_de(p_org, vr.referido_id))
                                              + make_interval(months => a.referido_vigencia_meses) - interval '1 day')::date)
    loop
      if r.tipo = 'equipo' and t.hasta is not null and t.hasta < t.pagado_en then
        continue;
      end if;
      -- Regla 7: lo que ya lleva el trabajo (comisión + ajustes) y el tope de 30%.
      select coalesce(sum(c.monto), 0) into v_ya from comisiones c
       where c.organizacion_id = p_org and c.solicitud_id = t.id and c.tipo in ('comision', 'ajuste', 'bono');
      v_bruto := round(t.monto_honorarios * v_pct / 100, 2);
      v_monto := least(v_bruto, greatest(round(t.monto_honorarios * 0.30, 2) - v_ya, 0));
      beneficiario := r.referidor_id; tipo := r.tipo; referido := t.comisionista_id; solicitud := t.id;
      base := t.monto_honorarios; porcentaje := v_pct; bruto := v_bruto; monto := v_monto;
      tope_ajustado := v_monto < v_bruto; activos := v_act;
      return next;
    end loop;
  end loop;
end;
$$;

-- Guarda el bono del mes (borra y vuelve a calcular; el mes no puede estar cerrado).
create or replace function calcular_bonos_referido(p_org uuid, p_mes date)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_mes date := mes_de(p_mes);
  n     integer;
begin
  if mes_aprobado(p_org, v_mes) then
    raise exception 'El mes % está cerrado', to_char(v_mes, 'YYYY-MM');
  end if;
  delete from comisiones where organizacion_id = p_org and mes = v_mes and tipo = 'referido';
  delete from bonos_equipo where organizacion_id = p_org and mes = v_mes and estado = 'devengado';

  insert into comisiones (organizacion_id, comisionista_id, solicitud_id, tipo, base, porcentaje, provisional,
                          monto, mes, nota, tope_ajustado, servicio_id, cuenta_receptora_id)
  select p_org, b.beneficiario, b.solicitud, 'referido', b.base, b.porcentaje, false, b.monto, v_mes,
         case when b.tope_ajustado then 'Bono ajustado por tope' else 'Bono de referidos' end
           || ' · ' || nombre_visible(p) || coalesce(' · ' || s.folio, ''),
         b.tope_ajustado, s.servicio_id, s.cuenta_receptora_id
    from bonos_referido_calculados(p_org, v_mes) b
    join solicitudes s on s.id = b.solicitud
    join personas p on p.id = b.referido
   where b.tipo = 'comisionista' and b.monto > 0;
  get diagnostics n = row_count;

  insert into bonos_equipo (organizacion_id, persona_id, referido_id, solicitud_id, mes, base, porcentaje, monto, tope_ajustado)
  select p_org, b.beneficiario, b.referido, b.solicitud, v_mes, b.base, b.porcentaje, b.monto, b.tope_ajustado
    from bonos_referido_calculados(p_org, v_mes) b
   where b.tipo = 'equipo' and b.monto > 0
     and not exists (select 1 from bonos_equipo x where x.organizacion_id = p_org and x.solicitud_id = b.solicitud);
  return n;
end;
$$;

-- Al aprobar: fija el inicio de los vínculos que ya arrancaron y libera a quien pasó N meses sin pagos.
create or replace function actualizar_vinculos(p_org uuid, p_mes date)
returns void language plpgsql security definer set search_path = public as $$
declare
  a      ajustes%rowtype;
  v_mes  date := mes_de(p_mes);
  v_fin  date := (mes_de(p_mes) + interval '1 month' - interval '1 day')::date;
  v      record;
  v_ini  date;
begin
  select * into a from ajustes where organizacion_id = p_org;

  for v in select * from vinculos_referido where organizacion_id = p_org and estado = 'activo' and inicio is null loop
    v_ini := primer_pago_de(p_org, v.referido_id);
    if v_ini is not null and v_ini <= v_fin then
      update vinculos_referido
         set inicio = v_ini, fin = coalesce(fin, (v_ini + make_interval(months => a.referido_vigencia_meses) - interval '1 day')::date)
       where id = v.id;
      insert into eventos_vinculo (organizacion_id, vinculo_id, tipo, fin_nuevo, motivo)
      values (p_org, v.id, 'inicio', (select fin from vinculos_referido where id = v.id), 'Primer trabajo pagado del referido');
    end if;
  end loop;

  -- Regla 5: N meses seguidos sin trabajos pagados (contados desde su alta) → vínculos liberados.
  for v in
    select vr.* from vinculos_referido vr join comisionistas c on c.organizacion_id = vr.organizacion_id and c.persona_id = vr.referidor_id
     where vr.organizacion_id = p_org and vr.estado = 'activo' and vr.tipo = 'comisionista'
       and mes_de(c.fecha_alta) <= (v_mes - make_interval(months => a.referido_perdida_meses - 1))::date
       and not exists (select 1 from solicitudes s
                        where s.organizacion_id = p_org and s.comisionista_id = vr.referidor_id and s.pagado_en is not null
                          and s.estado <> 'cancelada'
                          and s.mes_cierre between (v_mes - make_interval(months => a.referido_perdida_meses - 1))::date and v_mes)
  loop
    perform set_config('tasa.motivo', a.referido_perdida_meses || ' meses sin trabajos pagados: referidos liberados', true);
    update vinculos_referido set estado = 'liberado' where id = v.id;
    insert into eventos_vinculo (organizacion_id, vinculo_id, tipo, fin_anterior, fin_nuevo, motivo)
    values (p_org, v.id, 'liberar', v.fin, v.fin, a.referido_perdida_meses || ' meses sin trabajos pagados');
  end loop;
  perform set_config('tasa.motivo', '', true);
end;
$$;

-- Ampliar, acortar o quitar la vigencia de un vínculo (admin_org, con motivo).
create or replace function cambiar_vinculo(p_vinculo uuid, p_accion text, p_fin date, p_motivo text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v vinculos_referido%rowtype;
  v_fin_actual date;
begin
  if not soy_admin_org() then
    raise exception 'Solo admin_org cambia la vigencia de un referido';
  end if;
  select * into v from vinculos_referido where id = p_vinculo and organizacion_id = mi_org() for update;
  if not found then
    raise exception 'Ese vínculo no existe';
  end if;
  if char_length(trim(coalesce(p_motivo, ''))) < 3 then
    raise exception 'Escribe el motivo';
  end if;
  if v.estado <> 'activo' then
    raise exception 'Ese vínculo ya no está activo (%)', v.estado;
  end if;
  v_fin_actual := coalesce(v.fin, (coalesce(v.inicio, primer_pago_de(v.organizacion_id, v.referido_id))
                  + make_interval(months => (select referido_vigencia_meses from ajustes where organizacion_id = v.organizacion_id))
                  - interval '1 day')::date);
  perform set_config('tasa.motivo', 'Vigencia de referido: ' || trim(p_motivo), true);
  if p_accion = 'quitar' then
    update vinculos_referido set estado = 'quitado' where id = v.id;
  elsif p_accion in ('ampliar', 'acortar') then
    if p_fin is null then
      raise exception 'Escribe la nueva fecha de fin';
    end if;
    if v_fin_actual is not null and ((p_accion = 'ampliar' and p_fin <= v_fin_actual) or (p_accion = 'acortar' and p_fin >= v_fin_actual)) then
      raise exception 'Para % la fecha debe ser % que la actual (%)', p_accion,
        case when p_accion = 'ampliar' then 'posterior' else 'anterior' end, to_char(v_fin_actual, 'DD/MM/YYYY');
    end if;
    update vinculos_referido set fin = p_fin, inicio = coalesce(inicio, primer_pago_de(organizacion_id, referido_id)) where id = v.id;
  else
    raise exception 'Acción no válida';
  end if;
  insert into eventos_vinculo (organizacion_id, vinculo_id, tipo, fin_anterior, fin_nuevo, motivo, persona_id)
  values (v.organizacion_id, v.id, p_accion, v_fin_actual, case when p_accion = 'quitar' then v_fin_actual else p_fin end,
          trim(p_motivo), mi_persona_id());
  perform set_config('tasa.motivo', '', true);
end;
$$;

-- ------------------------------------------------------------
-- 7. EL CIERRE LO CALCULA
-- ------------------------------------------------------------

create or replace function ejecutar_preparacion_cierre(p_org uuid, p_mes date, p_persona uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_mes date := mes_de(p_mes);
  v_id  uuid;
begin
  if hoy_mx() <= (v_mes + interval '1 month' - interval '1 day')::date then
    raise exception 'El mes % no ha terminado: el corte es el último día a las 23:59',
      to_char(v_mes, 'YYYY-MM');
  end if;
  if mes_aprobado(p_org, v_mes) then
    raise exception 'El cierre de % ya está aprobado', to_char(v_mes, 'YYYY-MM');
  end if;

  perform recalcular_comisiones_del_mes(p_org, v_mes);
  -- El bono va después de los % definitivos del mes (el tope depende de la comisión del referido).
  perform calcular_bonos_referido(p_org, v_mes);

  insert into cierres (organizacion_id, mes, estado, resumen, preparado_por, preparado_en)
  values (p_org, v_mes, 'preparado', resumen_del_mes(p_org, v_mes), p_persona, now())
  on conflict (organizacion_id, mes) do update
     set resumen = excluded.resumen,
         preparado_por = excluded.preparado_por,
         preparado_en = excluded.preparado_en
  returning id into v_id;

  return v_id;
end;
$$;

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

  -- Bono de referidos: vínculos al día y cálculo definitivo, antes de saldos y pago del día 10.
  perform actualizar_vinculos(p_org, v_mes);
  perform calcular_bonos_referido(p_org, v_mes);

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
-- 8. LO QUE VE CADA QUIEN
-- ------------------------------------------------------------

-- "Mis referidos" del que refiere: estado, si está activo, meses de vigencia que le quedan y lo
-- generado en el mes (estimado mientras no cierra). Nunca los montos ni la comisión del referido.
create or replace function mis_referidos(p_mes date default null)
returns table (vinculo uuid, nombre text, estado text, activo boolean, fin date, meses_restantes integer, generado numeric)
language sql stable security definer set search_path = public as $$
  with a as (select * from ajustes where organizacion_id = mi_org()),
  m as (select mes_de(coalesce(p_mes, hoy_mx())) as mes),
  calc as (select * from bonos_referido_calculados(mi_org(), (select mes from m)) where beneficiario = mi_persona_id())
  select vr.id, nombre_visible(p), estado_vinculo(vr, hoy_mx()),
         exists (select 1 from solicitudes s
                  where s.organizacion_id = vr.organizacion_id and s.comisionista_id = vr.referido_id and s.pagado_en is not null
                    and s.estado <> 'cancelada'
                    and s.mes_cierre between ((select mes from m) - make_interval(months => (select referido_activo_meses from a) - 1))::date
                                         and (select mes from m)),
         coalesce(vr.fin, (coalesce(vr.inicio, primer_pago_de(vr.organizacion_id, vr.referido_id))
                           + make_interval(months => (select referido_vigencia_meses from a)) - interval '1 day')::date),
         case when coalesce(vr.inicio, primer_pago_de(vr.organizacion_id, vr.referido_id)) is null then null
              else greatest(0, (extract(year from age(
                     coalesce(vr.fin, (coalesce(vr.inicio, primer_pago_de(vr.organizacion_id, vr.referido_id))
                              + make_interval(months => (select referido_vigencia_meses from a)) - interval '1 day')::date), hoy_mx())) * 12
                   + extract(month from age(
                     coalesce(vr.fin, (coalesce(vr.inicio, primer_pago_de(vr.organizacion_id, vr.referido_id))
                              + make_interval(months => (select referido_vigencia_meses from a)) - interval '1 day')::date), hoy_mx())))::integer)
         end,
         coalesce((select sum(c.monto) from calc c where c.referido = vr.referido_id), 0)
    from vinculos_referido vr join personas p on p.id = vr.referido_id
   where vr.organizacion_id = mi_org() and vr.referidor_id = mi_persona_id()
   order by p.nombre;
$$;

-- El resumen: escalón actual, cuántos faltan para el siguiente, si cobra este mes y el aviso de pérdida.
create or replace function mi_resumen_referidos()
returns table (activos integer, porcentaje numeric, siguiente_desde integer, siguiente_porcentaje numeric,
               cobra_este_mes boolean, meses_sin_pagos integer, aviso_meses integer, perdida_meses integer, generado_mes numeric)
language plpgsql stable security definer set search_path = public as $$
declare
  a      ajustes%rowtype;
  v_mes  date := mes_de(hoy_mx());
  v_ult  date;
  v_alta date;
begin
  select * into a from ajustes where organizacion_id = mi_org();
  select count(*) into activos from vinculos_referido vr
   where vr.organizacion_id = mi_org() and vr.referidor_id = mi_persona_id() and vr.tipo = 'comisionista'
     and estado_vinculo(vr, hoy_mx()) = 'vigente'
     and exists (select 1 from solicitudes s
                  where s.organizacion_id = vr.organizacion_id and s.comisionista_id = vr.referido_id and s.pagado_en is not null
                    and s.estado <> 'cancelada'
                    and s.mes_cierre between (v_mes - make_interval(months => a.referido_activo_meses - 1))::date and v_mes);
  porcentaje := escalon_referidos(mi_org(), activos);
  select e.desde, e.porcentaje into siguiente_desde, siguiente_porcentaje from siguiente_escalon(mi_org(), activos) e;
  select max(mes_cierre) into v_ult from solicitudes
   where organizacion_id = mi_org() and comisionista_id = mi_persona_id() and pagado_en is not null and estado <> 'cancelada';
  select mes_de(fecha_alta) into v_alta from comisionistas where organizacion_id = mi_org() and persona_id = mi_persona_id();
  meses_sin_pagos := (extract(year from age(v_mes, coalesce(v_ult, v_alta, v_mes))) * 12
                      + extract(month from age(v_mes, coalesce(v_ult, v_alta, v_mes))))::integer;
  cobra_este_mes := v_ult is not null and v_ult >= (v_mes - make_interval(months => a.referido_actividad_meses - 1))::date;
  aviso_meses := a.referido_aviso_meses;
  perdida_meses := a.referido_perdida_meses;
  select coalesce(sum(b.monto), 0) into generado_mes from bonos_referido_calculados(mi_org(), v_mes) b where b.beneficiario = mi_persona_id();
  return next;
end;
$$;

-- El del equipo: lo que lleva el mes en curso (estimado) y lo que tiene por cobrar.
create or replace function mi_bono_equipo()
returns table (estimado_mes numeric, por_cobrar numeric)
language sql stable security definer set search_path = public as $$
  select coalesce((select sum(b.monto) from bonos_referido_calculados(mi_org(), mes_de(hoy_mx())) b
                    where b.beneficiario = mi_persona_id() and b.tipo = 'equipo'), 0),
         coalesce((select sum(monto) from bonos_equipo where organizacion_id = mi_org() and persona_id = mi_persona_id()
                    and estado = 'devengado'), 0);
$$;

-- Reportes: bono por persona en un mes (lo guardado al preparar o aprobar el cierre).
create or replace function reporte_bonos_referido(p_mes date)
returns table (persona_id uuid, nombre text, tipo text, trabajos bigint, monto numeric, recortados bigint, pagado numeric)
language sql stable security definer set search_path = public as $$
  select c.comisionista_id, p.nombre, 'comisionista'::text, count(*), sum(c.monto), count(*) filter (where c.tope_ajustado),
         sum(c.monto) filter (where c.estado = 'pagada')
    from comisiones c join personas p on p.id = c.comisionista_id
   where soy_staff() and c.organizacion_id = mi_org() and c.mes = mes_de(p_mes) and c.tipo = 'referido'
   group by c.comisionista_id, p.nombre
  union all
  select b.persona_id, p.nombre, 'equipo', count(*), sum(b.monto), count(*) filter (where b.tope_ajustado),
         sum(b.monto) filter (where b.estado = 'pagado')
    from bonos_equipo b join personas p on p.id = b.persona_id
   where soy_staff() and b.organizacion_id = mi_org() and b.mes = mes_de(p_mes)
   group by b.persona_id, p.nombre
  order by 5 desc;
$$;

-- ------------------------------------------------------------
-- 9. PERMISOS
-- ------------------------------------------------------------

revoke all on function escalon_referidos(uuid, integer), siguiente_escalon(uuid, integer), primer_pago_de(uuid, uuid),
  estado_vinculo(vinculos_referido, date), diez_digitos(text), es_autorreferido(uuid, uuid, text, text, text, text),
  poner_mi_clabe_cobro(text), marcar_bono_equipo_pagado(uuid, date, text), bonos_referido_calculados(uuid, date),
  calcular_bonos_referido(uuid, date), actualizar_vinculos(uuid, date), cambiar_vinculo(uuid, text, date, text),
  mis_referidos(date), mi_resumen_referidos(), mi_bono_equipo(), reporte_bonos_referido(date)
  from public, anon;
revoke all on function bonos_referido_calculados(uuid, date), calcular_bonos_referido(uuid, date), actualizar_vinculos(uuid, date),
  es_autorreferido(uuid, uuid, text, text, text, text), primer_pago_de(uuid, uuid), estado_vinculo(vinculos_referido, date)
  from authenticated;
grant execute on function poner_mi_clabe_cobro(text), marcar_bono_equipo_pagado(uuid, date, text), cambiar_vinculo(uuid, text, date, text),
  mis_referidos(date), mi_resumen_referidos(), mi_bono_equipo(), reporte_bonos_referido(date), escalon_referidos(uuid, integer),
  siguiente_escalon(uuid, integer), diez_digitos(text)
  to authenticated;
