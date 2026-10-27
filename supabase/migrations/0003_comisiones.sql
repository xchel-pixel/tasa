-- ============================================================
-- 0003 — NIVELES, CIERRES Y COMISIONES
--
-- Tres reglas viven aquí y no en la aplicación, porque una pantalla
-- se puede saltar y la base no:
--   1. Tope de 30% por trabajo (comisión + bonos + ajustes + referido).
--   2. Un cierre aprobado no se toca. Nunca se reabre.
--   3. El porcentaje sale del nivel vigente del mes, no del que el
--      comisionista tenga "hoy".
-- ============================================================

-- ------------------------------------------------------------
-- 1. NIVELES (parámetros editables)
-- ------------------------------------------------------------
-- `umbral_minimo`: promedio mensual de honorarios pagados a partir del
-- cual aplica. Élite no tiene umbral: lo asigna super_admin con un
-- porcentaje caso por caso (`comisionistas.porcentaje_forzado`).

create table niveles (
  id             uuid primary key default gen_random_uuid(),
  nombre         text not null unique,
  orden          smallint not null unique,
  umbral_minimo  numeric(12,2) check (umbral_minimo >= 0),
  porcentaje     numeric(5,2) check (porcentaje > 0 and porcentaje <= 30),
  es_forzado     boolean not null default false,
  check (es_forzado or (umbral_minimo is not null and porcentaje is not null))
);

-- ------------------------------------------------------------
-- 2. CIERRES
-- ------------------------------------------------------------
-- Uno por mes. Finanzas lo prepara (puede repetirlo); super_admin lo
-- aprueba y desde ese momento queda bloqueado.

create table cierres (
  id             uuid primary key default gen_random_uuid(),
  mes            date not null unique check (mes = mes_de(mes)),
  estado         text not null default 'preparado'
                   check (estado in ('preparado', 'aprobado')),
  resumen        jsonb,
  preparado_por  uuid references personas(id) on delete set null,
  preparado_en   timestamptz,
  aprobado_por   uuid references personas(id) on delete set null,
  aprobado_en    timestamptz,
  check (estado <> 'aprobado' or aprobado_en is not null)
);

create or replace function mes_aprobado(p_mes date)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from cierres where mes = mes_de(p_mes) and estado = 'aprobado');
$$;

-- El primer mes, a partir de `p_fecha`, que todavía no está aprobado.
-- Ahí cae lo que llega tarde: un pago con fecha de un mes cerrado, o
-- el cargo por una cancelación posterior.
create or replace function mes_abierto_desde(p_fecha date)
returns date language plpgsql stable security definer set search_path = public as $$
declare
  v_mes date := mes_de(p_fecha);
begin
  while mes_aprobado(v_mes) loop
    v_mes := (v_mes + interval '1 month')::date;
  end loop;
  return v_mes;
end;
$$;

-- Un cierre aprobado no se modifica ni se borra.
create or replace function proteger_cierre()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if old.estado = 'aprobado' then
      raise exception 'El cierre de % está aprobado: no se borra', to_char(old.mes, 'YYYY-MM');
    end if;
    return old;
  end if;

  if old.estado = 'aprobado' then
    raise exception 'El cierre de % está aprobado: no se reabre ni se modifica', to_char(old.mes, 'YYYY-MM');
  end if;
  return new;
end;
$$;

create trigger al_tocar_cierre
  before update or delete on cierres
  for each row execute function proteger_cierre();

-- ------------------------------------------------------------
-- 3. NIVEL DE CADA MES
-- ------------------------------------------------------------
-- Lo escribe la aprobación del cierre del mes anterior y aplica a TODO
-- el mes. Se guarda con el promedio que lo justificó, para poder
-- explicárselo al comisionista sin recalcular nada.

create table niveles_mensuales (
  comisionista_id     uuid not null references comisionistas(persona_id) on delete cascade,
  mes                 date not null check (mes = mes_de(mes)),
  nivel_id            uuid not null references niveles(id) on delete restrict,
  porcentaje          numeric(5,2) not null,
  promedio            numeric(12,2) not null,
  meses_considerados  smallint not null,
  cierre_id           uuid references cierres(id) on delete restrict,
  primary key (comisionista_id, mes)
);

-- ------------------------------------------------------------
-- 4. COMISIONES (y todo lo que mueve el estado de cuenta)
-- ------------------------------------------------------------
--   · comision: se devenga sola cuando el trabajo queda pagado al 100%.
--   · bono / ajuste: a mano, super_admin.
--   · cargo: negativo; p. ej. una cancelación después de un cierre.
--   · referido: fase 2, sin UI. Cuenta para el tope.

create table comisiones (
  id               uuid primary key default gen_random_uuid(),
  comisionista_id  uuid not null references comisionistas(persona_id) on delete restrict,
  solicitud_id     uuid references solicitudes(id) on delete restrict,
  tipo             text not null check (tipo in ('comision', 'bono', 'ajuste', 'cargo', 'referido')),
  base             numeric(12,2),
  porcentaje       numeric(5,2),
  -- El nivel de su mes aún no existía al devengarse: se usó el último
  -- conocido. Se recalcula al aprobar el cierre anterior y se apaga al
  -- aprobar el suyo.
  provisional      boolean not null default false,
  monto            numeric(12,2) not null,
  mes              date not null check (mes = mes_de(mes)),
  cierre_id        uuid references cierres(id) on delete restrict,
  estado           text not null default 'devengada' check (estado in ('devengada', 'pagada')),
  pagada_en        date,
  nota             text,
  creada_por       uuid references personas(id) on delete set null,
  creado_en        timestamptz not null default now(),

  check (tipo not in ('comision', 'bono', 'referido') or monto > 0),
  check (tipo <> 'cargo' or monto < 0),
  check (tipo not in ('comision', 'referido') or solicitud_id is not null),
  check ((estado = 'pagada') = (pagada_en is not null))
);

-- Una sola comisión por trabajo y por persona. Si el trabajo se
-- cancela antes del cierre, la comisión se borra; después, entra un cargo.
create unique index comisiones_una_por_trabajo
  on comisiones (solicitud_id, comisionista_id) where tipo = 'comision';
create index on comisiones (comisionista_id, mes);
create index on comisiones (mes);

-- El tope: lo que se paga por un trabajo (sin contar cargos) no pasa
-- del 30% de sus honorarios. Bloquea la fila con `for update` para que
-- dos bonos capturados al mismo tiempo no pasen juntos por debajo.
create or replace function validar_tope()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_honorarios numeric;
  v_suma       numeric;
begin
  if new.solicitud_id is null or new.tipo = 'cargo' then
    return new;
  end if;

  select monto_honorarios into v_honorarios
    from solicitudes where id = new.solicitud_id for update;

  select coalesce(sum(monto), 0) into v_suma
    from comisiones
   where solicitud_id = new.solicitud_id
     and tipo <> 'cargo'
     and id <> new.id;

  if v_suma + new.monto > round(coalesce(v_honorarios, 0) * 0.30, 2) then
    raise exception 'Tope de 30%% rebasado: este trabajo admite % y sumaría %',
      round(coalesce(v_honorarios, 0) * 0.30, 2), v_suma + new.monto
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger tope_30
  before insert or update of monto, solicitud_id, tipo on comisiones
  for each row execute function validar_tope();

-- Lo de un mes aprobado queda congelado. Lo único que se mueve
-- después es marcarlo pagado: eso pasa justo DESPUÉS de aprobar.
create or replace function proteger_mes_cerrado()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if mes_aprobado(new.mes) then
      raise exception 'El mes % ya está cerrado: va en %',
        to_char(new.mes, 'YYYY-MM'), to_char(mes_abierto_desde(new.mes), 'YYYY-MM');
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    if mes_aprobado(old.mes) then
      raise exception 'El mes % ya está cerrado: esto no se borra; registra un cargo',
        to_char(old.mes, 'YYYY-MM');
    end if;
    return old;
  end if;

  if mes_aprobado(old.mes) then
    -- Solo se permite: asignarle el cierre (al aprobar) y marcarla pagada.
    if (to_jsonb(new) - array['estado', 'pagada_en', 'cierre_id'])
       is distinct from (to_jsonb(old) - array['estado', 'pagada_en', 'cierre_id']) then
      raise exception 'El mes % ya está cerrado: solo se puede marcar como pagada',
        to_char(old.mes, 'YYYY-MM');
    end if;
    if old.cierre_id is not null and new.cierre_id is distinct from old.cierre_id then
      raise exception 'No se cambia el cierre de una comisión ya cerrada';
    end if;
  elsif mes_aprobado(new.mes) then
    raise exception 'No se puede mover una comisión a un mes cerrado';
  end if;

  if new.estado = 'pagada' and not mes_aprobado(new.mes) then
    raise exception 'Solo se marca pagado lo de un cierre aprobado';
  end if;

  return new;
end;
$$;

create trigger mes_cerrado
  before insert or update or delete on comisiones
  for each row execute function proteger_mes_cerrado();

create trigger bitacora after insert or update or delete on niveles
  for each row execute function registrar_bitacora();
create trigger bitacora after insert or update or delete on cierres
  for each row execute function registrar_bitacora();
create trigger bitacora after insert or update or delete on comisiones
  for each row execute function registrar_bitacora();
create trigger bitacora after insert or update or delete on niveles_mensuales
  for each row execute function registrar_bitacora();

-- ------------------------------------------------------------
-- 5. CÁLCULO DEL NIVEL
-- ------------------------------------------------------------

-- El porcentaje que le toca a un comisionista en un mes.
-- Orden:
--   1. Élite forzado;
--   2. el nivel de ese mes (lo dejó la aprobación del cierre anterior);
--   3. PROVISIONAL: el último nivel que tuvo — si el cierre anterior
--      todavía no se aprueba, el del mes anterior;
--   4. PROVISIONAL: el nivel más bajo (comisionista nuevo, sin niveles).
create or replace function porcentaje_vigente(p_comisionista uuid, p_mes date)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(
    (select porcentaje_forzado from comisionistas where persona_id = p_comisionista),
    (select porcentaje from niveles_mensuales
      where comisionista_id = p_comisionista and mes = mes_de(p_mes)),
    (select porcentaje from niveles_mensuales
      where comisionista_id = p_comisionista and mes < mes_de(p_mes)
      order by mes desc limit 1),
    (select porcentaje from niveles where not es_forzado order by orden limit 1)
  );
$$;

-- Si el porcentaje de ese mes todavía puede cambiar: no es Élite y el
-- nivel del mes aún no existe. El estado de cuenta lo marca así.
create or replace function porcentaje_es_provisional(p_comisionista uuid, p_mes date)
returns boolean language sql stable security definer set search_path = public as $$
  select not exists (
           select 1 from comisionistas
            where persona_id = p_comisionista and porcentaje_forzado is not null)
     and not exists (
           select 1 from niveles_mensuales
            where comisionista_id = p_comisionista and mes = mes_de(p_mes));
$$;

-- El nivel que corresponde a `p_mes`, calculado con los 3 meses
-- anteriores. Meses en cero cuentan; meses antes del alta, no.
--
-- Ejemplo: alta en agosto, se calcula noviembre → ventana ago-sep-oct,
-- 3 meses. Alta en octubre → solo octubre, 1 mes.
create or replace function calcular_nivel(p_comisionista uuid, p_mes date)
returns table (nivel_id uuid, porcentaje numeric, promedio numeric, meses_considerados smallint)
language plpgsql stable security definer set search_path = public as $$
declare
  v_alta     date;
  v_forzado  numeric;
  v_desde    date;
  v_hasta    date := (mes_de(p_mes) - interval '1 month')::date;
  v_meses    integer;
  v_suma     numeric;
begin
  select mes_de(fecha_alta), porcentaje_forzado into v_alta, v_forzado
    from comisionistas where persona_id = p_comisionista;

  v_desde := greatest((mes_de(p_mes) - interval '3 months')::date, v_alta);
  v_meses := case when v_desde > v_hasta then 0
                  else (extract(year from age(v_hasta, v_desde)) * 12
                        + extract(month from age(v_hasta, v_desde)))::integer + 1 end;

  select coalesce(sum(monto_honorarios), 0) into v_suma
    from solicitudes
   where comisionista_id = p_comisionista
     and mes_cierre between v_desde and v_hasta;

  promedio := case when v_meses = 0 then 0 else round(v_suma / v_meses, 2) end;
  meses_considerados := v_meses;

  if v_forzado is not null then
    select n.id into nivel_id from niveles n where n.es_forzado order by n.orden limit 1;
    porcentaje := v_forzado;
  else
    select n.id, n.porcentaje into nivel_id, porcentaje
      from niveles n
     where not n.es_forzado and n.umbral_minimo <= promedio
     order by n.umbral_minimo desc
     limit 1;
  end if;

  return next;
end;
$$;

-- Reajusta el porcentaje de las comisiones de un mes todavía abierto.
-- Hace falta porque un trabajo puede quedar pagado el día 2 y el nivel
-- de ese mes se conoce hasta que se aprueba el cierre anterior: mientras
-- tanto la comisión es provisional, con el nivel del mes anterior.
create or replace function recalcular_comisiones_del_mes(p_mes date)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_total integer;
begin
  if mes_aprobado(p_mes) then
    raise exception 'El mes % está cerrado', to_char(p_mes, 'YYYY-MM');
  end if;

  update comisiones c
     set porcentaje  = porcentaje_vigente(c.comisionista_id, c.mes),
         monto       = round(c.base * porcentaje_vigente(c.comisionista_id, c.mes) / 100, 2),
         provisional = porcentaje_es_provisional(c.comisionista_id, c.mes)
   where c.mes = mes_de(p_mes)
     and c.tipo = 'comision'
     and (c.porcentaje is distinct from porcentaje_vigente(c.comisionista_id, c.mes)
          or c.provisional is distinct from porcentaje_es_provisional(c.comisionista_id, c.mes));

  get diagnostics v_total = row_count;
  return v_total;
end;
$$;

revoke all on function porcentaje_vigente(uuid, date), porcentaje_es_provisional(uuid, date),
  calcular_nivel(uuid, date), recalcular_comisiones_del_mes(date),
  mes_abierto_desde(date), mes_aprobado(date)
  from public, anon;
grant execute on function porcentaje_vigente(uuid, date), porcentaje_es_provisional(uuid, date),
  calcular_nivel(uuid, date),
  mes_abierto_desde(date), mes_aprobado(date)
  to authenticated;

-- ------------------------------------------------------------
-- 6. RLS
-- ------------------------------------------------------------

alter table niveles            enable row level security;
alter table cierres            enable row level security;
alter table niveles_mensuales  enable row level security;
alter table comisiones         enable row level security;

revoke all on niveles, cierres, niveles_mensuales, comisiones from anon;

create policy leer_niveles on niveles for select to authenticated using (true);
create policy admin_niveles on niveles for all
  using (soy_super_admin()) with check (soy_super_admin());

-- El comisionista sabe qué meses ya están publicados; el staff ve todo.
-- Nadie escribe cierres directo: pasan por preparar/aprobar (0005).
create policy leer_cierres on cierres for select
  using (soy_staff() or estado = 'aprobado');
revoke insert, update, delete on cierres from authenticated;

create policy leer_niveles_mensuales on niveles_mensuales for select
  using (comisionista_id = mi_persona_id() or soy_staff());
revoke insert, update, delete on niveles_mensuales from authenticated;

create policy leer_comisiones on comisiones for select
  using (comisionista_id = mi_persona_id() or soy_staff());
-- Bonos, ajustes y cargos a mano: super_admin.
create policy admin_comisiones on comisiones for insert
  with check (soy_super_admin() and tipo in ('bono', 'ajuste', 'cargo'));
create policy admin_borra_comisiones on comisiones for delete
  using (soy_super_admin());
-- Marcar pagadas: finanzas o super_admin. El disparador impide tocar
-- otra cosa en un mes cerrado.
create policy staff_actualiza_comisiones on comisiones for update
  using (soy_staff()) with check (soy_staff());
