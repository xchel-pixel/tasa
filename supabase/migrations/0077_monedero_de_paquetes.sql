-- ============================================================
-- 0077 — MONEDERO DE PAQUETES DE CRÉDITO
--
-- El comisionista compra un paquete (precio IVA incluido) y recibe
-- crédito para pagar honorarios de sus trabajos en Tasa.
--
-- · paquetes: catálogo por organización (admin_org en Catálogos, con
--   bitácora): precio, crédito, meses de vigencia, cupos ('socio' o
--   'sin_limite'), DXF extra, entrega prioritaria e insignia.
-- · terminos_paquetes: el texto que se acepta al comprar, versionado;
--   la compra guarda versión y fecha de aceptación.
-- · compras_paquete: cada compra, renovación o subida. Nace "por_pagar"
--   (transferencia a la cuenta de paquetes, ROMI en XG); finanzas o
--   admin_org la confirma con monto, fecha, cuenta, referencia y folio
--   CFDI de anticipo opcional. Con la comisión del cierre se compra al
--   instante (pago de comisión con origen "Crédito Tasa").
--   Una compra o renovación confirmada es un "lote" de crédito con su
--   vigencia. Renovar antes de vencer pasa el saldo vigente al lote
--   nuevo. Subir de paquete (primeros 30 días) cambia el lote original:
--   recibe la diferencia de crédito y la vigencia del superior, contada
--   desde la compra original.
-- · movimientos_credito: el saldo de cada lote es la suma de sus
--   movimientos (carga, aplicación, devolución, vencimiento, traspaso).
-- · Aplicar crédito a un trámite: honorarios + IVA si lleva factura, o
--   solo honorarios; nunca terceros; no a trabajos sin costo, con
--   convenio o estimados sin monto final. Entra como un pago "credito"
--   confirmado (el trabajo se liquida igual que con dinero). La parte de
--   honorarios pagada con crédito queda en solicitudes.credito_honorarios:
--   la comisión y el bono por referido se calculan sobre el resto. El
--   nivel sigue contando los honorarios completos.
-- · Cancelar el trabajo (o deshacer el pago con crédito) devuelve el
--   crédito a su lote, con su vigencia original.
-- · Vencimiento: el cron deja en cero los lotes vencidos (queda el
--   movimiento). Avisos dentro de Tasa a 30 y 7 días (portada).
-- · Beneficios mientras haya un lote vigente: cupos de nivel Socio o
--   sin límite, DXF extra (se cargan al confirmar), entrega prioritaria
--   en los trámites que nazcan en la vigencia, insignia en la tarjeta.
--   No cambian el porcentaje de comisión. Cuenta como actividad (0075).
-- ============================================================

-- ------------------------------------------------------------
-- 1. Catálogo, términos y cuenta para transferir
-- ------------------------------------------------------------

create table paquetes (
  id                  uuid primary key default gen_random_uuid(),
  organizacion_id     uuid not null default mi_org() references organizaciones(id) on delete restrict,
  clave               text not null check (clave ~ '^[a-z_]{3,30}$'),
  nombre              text not null check (char_length(trim(nombre)) between 3 and 40),
  precio              numeric(12,2) not null check (precio > 0),
  credito             numeric(12,2) not null check (credito > 0),
  meses               integer not null check (meses between 1 and 24),
  cupos               text not null check (cupos in ('socio', 'sin_limite')),
  dxf_extra           integer not null default 0 check (dxf_extra between 0 and 500),
  entrega_prioritaria boolean not null default false,
  insignia            text check (insignia is null or char_length(trim(insignia)) between 3 and 30),
  beneficios          text not null check (char_length(trim(beneficios)) between 3 and 300),
  activo              boolean not null default true,
  orden               smallint not null default 0,
  unique (organizacion_id, clave)
);
alter table paquetes enable row level security;
revoke all on paquetes from anon;
create policy leer_paquetes on paquetes for select using (organizacion_id = (select mi_org()));
create policy admin_paquetes on paquetes for all
  using (organizacion_id = (select mi_org()) and (select soy_admin_org()))
  with check (organizacion_id = (select mi_org()) and (select soy_admin_org()));
grant select, insert, update on paquetes to authenticated;
create trigger bitacora after insert or update or delete on paquetes for each row execute function registrar_bitacora();

create table terminos_paquetes (
  organizacion_id uuid not null references organizaciones(id) on delete restrict,
  version         integer not null check (version >= 1),
  texto           text not null check (char_length(trim(texto)) between 20 and 4000),
  creado_en       timestamptz not null default now(),
  primary key (organizacion_id, version)
);
alter table terminos_paquetes enable row level security;
revoke all on terminos_paquetes from anon;
create policy leer_terminos_paquetes on terminos_paquetes for select using (organizacion_id = (select mi_org()));
grant select on terminos_paquetes to authenticated;
create trigger bitacora after insert or update or delete on terminos_paquetes for each row execute function registrar_bitacora();

alter table ajustes add column cuenta_paquetes uuid references cuentas_receptoras(id) on delete set null;

create or replace function sembrar_paquetes(p_org uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into paquetes (organizacion_id, clave, nombre, precio, credito, meses, cupos, dxf_extra, entrega_prioritaria, insignia, beneficios, orden)
  values
    (p_org, 'mensual', 'Mensual', 3500, 3850, 1, 'socio', 0, false, null, 'Herramientas con cupos de nivel Socio.', 1),
    (p_org, 'trimestral', 'Trimestral', 10000, 12000, 3, 'sin_limite', 5, false, null, 'Herramientas sin límite. +5 DXF a tu saldo.', 2),
    (p_org, 'semestral', 'Semestral', 25000, 31250, 6, 'sin_limite', 15, true, null,
     'Herramientas sin límite. +15 DXF a tu saldo. Entrega prioritaria en tus trámites.', 3),
    (p_org, 'anual', 'Anual', 60000, 80000, 12, 'sin_limite', 40, true, 'Aliado anual',
     'Herramientas sin límite. +40 DXF a tu saldo. Entrega prioritaria en tus trámites. Insignia "Aliado anual" en tu tarjeta.', 4)
  on conflict (organizacion_id, clave) do nothing;
  insert into terminos_paquetes (organizacion_id, version, texto)
  values (p_org, 1,
    'El crédito se usa solo para honorarios de trabajos solicitados en Tasa, al monto de honorarios de la cotización aceptada de cada trabajo. '
    'Si el trabajo lleva factura, el crédito se consume por honorarios más IVA; si no lleva factura, solo por honorarios. '
    'Los precios de los paquetes incluyen IVA. No cubre derechos, impuestos ni gastos de terceros. '
    'Vence al terminar la vigencia del paquete; si renuevas antes, tu saldo se suma al nuevo paquete. '
    'No es reembolsable ni transferible a otro aliado. Los trabajos pagados con crédito no generan comisión ni bono por referido. '
    'El pago se factura como anticipo por Conjuntos Habitacionales y Comerciales ROMI, S.A. de C.V.')
  on conflict do nothing;
  update ajustes set cuenta_paquetes = coalesce(cuenta_paquetes,
    (select c.id from cuentas_receptoras c where c.organizacion_id = p_org and c.activa and upper(coalesce(c.alias, '')) = 'ROMI' limit 1))
   where organizacion_id = p_org;
  insert into origenes_pago (organizacion_id, nombre, orden)
  select p_org, 'Crédito Tasa', 90
   where not exists (select 1 from origenes_pago where organizacion_id = p_org and nombre = 'Crédito Tasa');
end;
$$;
create or replace function sembrar_paquetes_nueva()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform sembrar_paquetes(new.id);
  return null;
end;
$$;
create trigger sembrar_paquetes after insert on organizaciones for each row execute function sembrar_paquetes_nueva();
revoke all on function sembrar_paquetes(uuid), sembrar_paquetes_nueva() from public, anon, authenticated;
select sembrar_paquetes(id) from organizaciones;

-- ------------------------------------------------------------
-- 2. Compras, lotes y movimientos
-- ------------------------------------------------------------

create table compras_paquete (
  id                     uuid primary key default gen_random_uuid(),
  organizacion_id        uuid not null references organizaciones(id) on delete restrict,
  persona_id             uuid not null references personas(id) on delete restrict,
  paquete_id             uuid not null references paquetes(id) on delete restrict,
  tipo                   text not null check (tipo in ('compra', 'renovacion', 'subida')),
  forma_pago             text not null default 'transferencia' check (forma_pago in ('transferencia', 'comision')),
  precio                 numeric(12,2) not null check (precio > 0),
  credito                numeric(12,2) not null check (credito > 0),
  estado                 text not null default 'por_pagar' check (estado in ('por_pagar', 'confirmada', 'cancelada')),
  terminos_version       integer not null,
  terminos_aceptados_en  timestamptz not null default now(),
  original_id            uuid references compras_paquete(id) on delete restrict,
  inicia                 date,
  vence                  date,
  reemplazada_por        uuid references compras_paquete(id) on delete restrict,
  pago_monto             numeric(12,2),
  pago_fecha             date,
  cuenta_id              uuid references cuentas_receptoras(id) on delete restrict,
  pago_referencia        text check (pago_referencia is null or char_length(pago_referencia) <= 80),
  folio_cfdi             text check (folio_cfdi is null or char_length(folio_cfdi) <= 60),
  pago_comision_id       uuid references pagos_comision(id) on delete restrict,
  confirmada_por         uuid references personas(id) on delete set null,
  confirmada_en          timestamptz,
  cancelada_motivo       text,
  creado_en              timestamptz not null default now(),
  check (tipo <> 'subida' or original_id is not null),
  check (estado <> 'confirmada' or pago_fecha is not null),
  check (estado <> 'confirmada' or tipo = 'subida' or (inicia is not null and vence is not null))
);
create index on compras_paquete (organizacion_id, persona_id, estado);
create unique index compras_paquete_una_por_pagar on compras_paquete (organizacion_id, persona_id) where estado = 'por_pagar';
alter table compras_paquete enable row level security;
revoke all on compras_paquete from anon;
create policy leer_compras_paquete on compras_paquete for select
  using (organizacion_id = (select mi_org()) and ((select soy_staff()) or persona_id = (select mi_persona_id())));
grant select on compras_paquete to authenticated;
create trigger bitacora after insert or update or delete on compras_paquete for each row execute function registrar_bitacora();

create table movimientos_credito (
  id              bigint generated always as identity primary key,
  organizacion_id uuid not null references organizaciones(id) on delete restrict,
  persona_id      uuid not null references personas(id) on delete restrict,
  compra_id       uuid not null references compras_paquete(id) on delete restrict,
  tipo            text not null check (tipo in ('carga', 'aplicacion', 'devolucion', 'vencimiento', 'traspaso')),
  monto           numeric(12,2) not null check (monto <> 0),
  solicitud_id    uuid references solicitudes(id) on delete restrict,
  pago_id         uuid references pagos(id) on delete restrict,
  devuelve_id     bigint references movimientos_credito(id) on delete restrict,
  nota            text check (nota is null or char_length(nota) <= 200),
  creado_por      uuid references personas(id) on delete set null,
  creado_en       timestamptz not null default now(),
  check ((tipo in ('carga', 'devolucion', 'traspaso') and monto > 0) or (tipo in ('aplicacion', 'vencimiento', 'traspaso') and monto < 0)),
  check (tipo <> 'aplicacion' or (solicitud_id is not null and pago_id is not null))
);
create index on movimientos_credito (compra_id);
create index on movimientos_credito (organizacion_id, persona_id, creado_en desc);
create index on movimientos_credito (solicitud_id) where solicitud_id is not null;
create unique index movimientos_credito_una_devolucion on movimientos_credito (devuelve_id) where devuelve_id is not null;
alter table movimientos_credito enable row level security;
revoke all on movimientos_credito from anon;
create policy leer_movimientos_credito on movimientos_credito for select
  using (organizacion_id = (select mi_org()) and ((select soy_staff()) or persona_id = (select mi_persona_id())));
grant select on movimientos_credito to authenticated;
create trigger bitacora after insert or update or delete on movimientos_credito for each row execute function registrar_bitacora();

-- El pago con crédito y lo que el trabajo lleva pagado con crédito.
alter table pagos drop constraint pagos_via_check;
alter table pagos add constraint pagos_via_check check (via in ('comprobante', 'directo', 'aviso', 'efectivo', 'credito'));
alter table solicitudes
  add column credito_honorarios  numeric(12,2) not null default 0 check (credito_honorarios >= 0),
  add column pagar_con_credito   boolean not null default false,
  add column entrega_prioritaria boolean not null default false;

-- ------------------------------------------------------------
-- 3. Saldos y paquete vigente
-- ------------------------------------------------------------

create or replace function saldo_lote(p_compra uuid)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(sum(monto), 0) from movimientos_credito where compra_id = p_compra;
$$;

-- Lotes vigentes: compra o renovación confirmada, no reemplazada, que no ha vencido.
create or replace function lotes_vigentes(p_org uuid, p_persona uuid)
returns setof compras_paquete language sql stable security definer set search_path = public as $$
  select * from compras_paquete
   where organizacion_id = p_org and persona_id = p_persona and estado = 'confirmada' and tipo in ('compra', 'renovacion')
     and reemplazada_por is null and vence >= hoy_mx()
   order by vence, inicia;
$$;

-- El paquete que da beneficios hoy (el del lote vigente que vence al último).
create or replace function paquete_vigente(p_org uuid, p_persona uuid)
returns paquetes language sql stable security definer set search_path = public as $$
  select p.* from lotes_vigentes(p_org, p_persona) l join paquetes p on p.id = l.paquete_id
   order by l.vence desc limit 1;
$$;

create or replace function saldo_credito(p_org uuid, p_persona uuid)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(sum(saldo_lote(l.id)), 0) from lotes_vigentes(p_org, p_persona) l;
$$;

-- 0075 la dejó en "no": un paquete vigente cuenta como actividad.
create or replace function paquete_vigente_de(p_org uuid, p_persona uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from lotes_vigentes(p_org, p_persona));
$$;

-- El nivel con el que se cuentan las herramientas: con paquete "socio", al menos Socio.
create or replace function nivel_herramientas(p_org uuid, p_persona uuid, p_mes date)
returns uuid language plpgsql stable security definer set search_path = public as $$
declare
  v_nivel uuid := nivel_del_mes(p_org, p_persona, p_mes);
  v_paq   paquetes;
  v_socio niveles;
begin
  v_paq := paquete_vigente(p_org, p_persona);
  if v_paq.id is null then
    return v_nivel;
  end if;
  select * into v_socio from niveles where organizacion_id = p_org and nombre = 'Socio' and not es_forzado;
  if v_socio.id is null or (select orden from niveles where id = v_nivel) >= v_socio.orden then
    return v_nivel;
  end if;
  return v_socio.id;
end;
$$;

create or replace function herramientas_sin_limite(p_org uuid, p_persona uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((paquete_vigente(p_org, p_persona)).cupos = 'sin_limite', false);
$$;

-- ------------------------------------------------------------
-- 4. Comprar, renovar, subir; confirmar
-- ------------------------------------------------------------

-- Lo que el comisionista puede pedir hoy (para la pantalla y para validar).
-- subida: solo en los primeros 30 días del lote vigente (de compra) y a un paquete de mayor precio.
create or replace function pedir_paquete(p_paquete uuid, p_tipo text, p_terminos integer)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_org   uuid := mi_org();
  v_yo    uuid := mi_persona_id();
  p       paquetes;
  l       compras_paquete;
  o       paquetes;
  v_id    uuid;
begin
  if mi_rol() is distinct from 'comisionista' then
    raise exception 'Solo comisionistas compran paquetes';
  end if;
  select * into p from paquetes where id = p_paquete and organizacion_id = v_org and activo;
  if p.id is null then
    raise exception 'Ese paquete no está disponible';
  end if;
  if p_terminos is distinct from (select max(version) from terminos_paquetes where organizacion_id = v_org) then
    raise exception 'Acepta los términos vigentes del paquete';
  end if;
  if exists (select 1 from compras_paquete where organizacion_id = v_org and persona_id = v_yo and estado = 'por_pagar') then
    raise exception 'Ya tienes una compra por pagar: págala o cancélala primero';
  end if;
  select * into l from lotes_vigentes(v_org, v_yo) order by vence desc limit 1;

  if p_tipo = 'compra' then
    if l.id is not null then
      raise exception 'Ya tienes un paquete vigente: renuévalo o sube de paquete';
    end if;
    insert into compras_paquete (organizacion_id, persona_id, paquete_id, tipo, precio, credito, terminos_version)
    values (v_org, v_yo, p.id, 'compra', p.precio, p.credito, p_terminos) returning id into v_id;
  elsif p_tipo = 'renovacion' then
    if l.id is null then
      raise exception 'No tienes un paquete vigente que renovar';
    end if;
    insert into compras_paquete (organizacion_id, persona_id, paquete_id, tipo, precio, credito, terminos_version)
    values (v_org, v_yo, p.id, 'renovacion', p.precio, p.credito, p_terminos) returning id into v_id;
  elsif p_tipo = 'subida' then
    if l.id is null or l.inicia < hoy_mx() - 30 then
      raise exception 'Solo se sube de paquete en los primeros 30 días';
    end if;
    select * into o from paquetes where id = l.paquete_id;
    if p.precio <= o.precio or p.credito <= o.credito then
      raise exception 'Elige un paquete mayor que el tuyo';
    end if;
    insert into compras_paquete (organizacion_id, persona_id, paquete_id, tipo, precio, credito, terminos_version, original_id)
    values (v_org, v_yo, p.id, 'subida', p.precio - o.precio, p.credito - o.credito, p_terminos, l.id) returning id into v_id;
  else
    raise exception 'Tipo de compra no válido';
  end if;
  return v_id;
end;
$$;

create or replace function cancelar_compra_paquete(p_compra uuid, p_motivo text)
returns void language plpgsql security definer set search_path = public as $$
declare
  c compras_paquete;
begin
  select * into c from compras_paquete where id = p_compra and organizacion_id = mi_org() for update;
  if c.id is null or not (c.persona_id = mi_persona_id() or mi_rol() in ('admin_org', 'finanzas')) then
    raise exception 'Esa compra no existe';
  end if;
  if c.estado <> 'por_pagar' then
    raise exception 'Solo se cancela una compra por pagar';
  end if;
  update compras_paquete set estado = 'cancelada', cancelada_motivo = left(coalesce(nullif(trim(p_motivo), ''), 'Cancelada'), 200) where id = c.id;
end;
$$;

-- Los DXF extra del paquete van al saldo de DXF (0065), con su movimiento. Sin límite se queda sin límite.
create or replace function sumar_dxf_paquete(p_org uuid, p_persona uuid, p_cantidad integer, p_motivo text, p_quien uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  a        dxf_autorizaciones;
  v_saldo  integer;
begin
  if coalesce(p_cantidad, 0) <= 0 then
    return;
  end if;
  select * into a from dxf_autorizaciones where organizacion_id = p_org and persona_id = p_persona for update;
  if a.persona_id is not null and a.activa and a.saldo is null then
    return;
  end if;
  if a.persona_id is null then
    insert into dxf_autorizaciones (organizacion_id, persona_id, activa, saldo) values (p_org, p_persona, true, p_cantidad);
    v_saldo := p_cantidad;
  else
    v_saldo := coalesce(a.saldo, 0) + p_cantidad;
    update dxf_autorizaciones set activa = true, saldo = v_saldo, actualizado_en = now()
     where organizacion_id = p_org and persona_id = p_persona;
  end if;
  insert into dxf_movimientos (organizacion_id, persona_id, accion, cantidad, saldo_despues, motivo, hecho_por)
  values (p_org, p_persona, case when a.persona_id is null then 'autorizar' else 'agregar' end, p_cantidad, v_saldo, p_motivo, p_quien);
end;
$$;

-- El corazón de la confirmación (también la usa la compra con comisión).
create or replace function ejecutar_confirmar_compra(p_compra uuid, p_fecha date, p_quien uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  c        compras_paquete;
  p        paquetes;
  o        compras_paquete;
  po       paquetes;
  l        record;
  v_saldo  numeric;
begin
  select * into c from compras_paquete where id = p_compra for update;
  select * into p from paquetes where id = c.paquete_id;
  if c.tipo = 'subida' then
    select * into o from compras_paquete where id = c.original_id for update;
    select * into po from paquetes where id = o.paquete_id;
    update compras_paquete set estado = 'confirmada', confirmada_por = p_quien, confirmada_en = now() where id = c.id;
    update compras_paquete set paquete_id = p.id, credito = o.credito + c.credito,
           vence = (o.inicia + make_interval(months => p.meses))::date - 1
     where id = o.id;
    insert into movimientos_credito (organizacion_id, persona_id, compra_id, tipo, monto, nota, creado_por)
    values (c.organizacion_id, c.persona_id, o.id, 'carga', c.credito, 'Subida a ' || p.nombre, p_quien);
    perform sumar_dxf_paquete(c.organizacion_id, c.persona_id, p.dxf_extra - po.dxf_extra, 'Subida a paquete ' || p.nombre, p_quien);
    return;
  end if;

  update compras_paquete set estado = 'confirmada', confirmada_por = p_quien, confirmada_en = now(),
         inicia = p_fecha, vence = (p_fecha + make_interval(months => p.meses))::date - 1
   where id = c.id;
  insert into movimientos_credito (organizacion_id, persona_id, compra_id, tipo, monto, nota, creado_por)
  values (c.organizacion_id, c.persona_id, c.id, 'carga', c.credito, 'Paquete ' || p.nombre, p_quien);
  -- Renovar: el saldo vigente pasa al lote nuevo (con la vigencia nueva) y los lotes anteriores terminan.
  for l in select * from lotes_vigentes(c.organizacion_id, c.persona_id) x where x.id <> c.id loop
    v_saldo := saldo_lote(l.id);
    if v_saldo > 0 then
      insert into movimientos_credito (organizacion_id, persona_id, compra_id, tipo, monto, nota, creado_por)
      values (c.organizacion_id, c.persona_id, l.id, 'traspaso', -v_saldo, 'Pasa al paquete renovado', p_quien),
             (c.organizacion_id, c.persona_id, c.id, 'traspaso', v_saldo, 'Saldo del paquete anterior', p_quien);
    end if;
    update compras_paquete set reemplazada_por = c.id where id = l.id;
  end loop;
  perform sumar_dxf_paquete(c.organizacion_id, c.persona_id, p.dxf_extra, 'Paquete ' || p.nombre, p_quien);
end;
$$;

-- Finanzas o admin_org confirma la transferencia.
create or replace function confirmar_compra_paquete(p_compra uuid, p_monto numeric, p_fecha date, p_cuenta uuid, p_referencia text, p_cfdi text)
returns void language plpgsql security definer set search_path = public as $$
declare
  c compras_paquete;
begin
  if mi_rol() not in ('admin_org', 'finanzas') then
    raise exception 'Solo finanzas o administración confirman pagos';
  end if;
  select * into c from compras_paquete where id = p_compra and organizacion_id = mi_org() for update;
  if c.id is null or c.estado <> 'por_pagar' then
    raise exception 'Esa compra no está por pagar';
  end if;
  if p_monto is distinct from c.precio then
    raise exception 'El monto recibido (%) no es el precio del paquete (%)', p_monto, c.precio;
  end if;
  if p_fecha is null or p_fecha > hoy_mx() then
    raise exception 'La fecha del pago no puede ser futura';
  end if;
  if not exists (select 1 from cuentas_receptoras where id = p_cuenta and organizacion_id = c.organizacion_id) then
    raise exception 'Elige la cuenta donde entró el pago';
  end if;
  if nullif(trim(p_referencia), '') is null then
    raise exception 'Escribe la referencia del banco';
  end if;
  update compras_paquete set pago_monto = p_monto, pago_fecha = p_fecha, cuenta_id = p_cuenta,
         pago_referencia = trim(p_referencia), folio_cfdi = nullif(trim(p_cfdi), '')
   where id = c.id;
  perform set_config('tasa.motivo', 'Pago de paquete confirmado', true);
  perform ejecutar_confirmar_compra(c.id, p_fecha, mi_persona_id());
  perform set_config('tasa.motivo', '', true);
end;
$$;

-- "Convertir mi comisión en crédito": con lo que se le debe de cierres aprobados (lo más viejo primero).
-- Queda como pago de comisión con origen "Crédito Tasa" (sin ir a Notion por ahora) y el paquete, confirmado.
create or replace function comprar_paquete_con_comision(p_paquete uuid, p_terminos integer)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_org     uuid := mi_org();
  v_yo      uuid := mi_persona_id();
  p         paquetes;
  v_tipo    text;
  v_compra  uuid;
  v_falta   numeric;
  v_apl     jsonb := '[]';
  pc        record;
  v_pago    uuid;
  v_origen  uuid;
begin
  if mi_rol() is distinct from 'comisionista' then
    raise exception 'Solo comisionistas compran paquetes';
  end if;
  select * into p from paquetes where id = p_paquete and organizacion_id = v_org and activo;
  if p.id is null then
    raise exception 'Ese paquete no está disponible';
  end if;
  if (select coalesce(sum(monto - pagado), 0) from pendientes_comision where organizacion_id = v_org and comisionista_id = v_yo and pagado < monto) < p.precio then
    raise exception 'Tu comisión por cobrar no alcanza para el paquete %', p.nombre;
  end if;
  v_tipo := case when exists (select 1 from lotes_vigentes(v_org, v_yo)) then 'renovacion' else 'compra' end;
  v_compra := pedir_paquete(p.id, v_tipo, p_terminos);

  v_falta := p.precio;
  for pc in select id, monto - pagado as debe from pendientes_comision
             where organizacion_id = v_org and comisionista_id = v_yo and pagado < monto order by mes loop
    exit when v_falta <= 0;
    v_apl := v_apl || jsonb_build_array(jsonb_build_object('pendiente_id', pc.id, 'monto', least(pc.debe, v_falta)));
    v_falta := v_falta - least(pc.debe, v_falta);
  end loop;
  v_origen := (select id from origenes_pago where organizacion_id = v_org and nombre = 'Crédito Tasa');
  update origenes_pago set activo = true where id = v_origen;
  v_pago := ejecutar_pago_comision(v_org, v_yo, v_yo, hoy_mx(), v_origen, 'Paquete ' || p.nombre, null, 'ninguno',
                                   'Comisión convertida en crédito', v_apl);
  -- Notion: no se registra hasta que esté lista la propiedad "Crédito Tasa".
  update pagos_comision set externo_pendiente = false where id = v_pago;

  update compras_paquete set forma_pago = 'comision', pago_monto = p.precio, pago_fecha = hoy_mx(), pago_comision_id = v_pago,
         pago_referencia = 'Comisión convertida'
   where id = v_compra;
  perform set_config('tasa.motivo', 'Comisión convertida en crédito', true);
  perform ejecutar_confirmar_compra(v_compra, hoy_mx(), v_yo);
  perform set_config('tasa.motivo', '', true);
  return v_compra;
end;
$$;

-- ------------------------------------------------------------
-- 5. Aplicar, devolver y vencer crédito
-- ------------------------------------------------------------

-- Cuánto crédito admite hoy un trabajo (honorarios + IVA si lleva factura, menos lo ya pagado). Nulo con motivo si no admite.
create or replace function credito_aplicable(p_solicitud uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  s          solicitudes;
  v_factor   numeric;
  v_hon      numeric;
  v_conf     numeric;
  v_max      numeric;
begin
  select * into s from solicitudes where id = p_solicitud;
  if s.id is null then return jsonb_build_object('monto', 0, 'motivo', 'No existe'); end if;
  if s.estado <> 'tramite' or s.pagado_en is not null then return jsonb_build_object('monto', 0, 'motivo', 'Solo trámites sin pagar'); end if;
  if s.honorario_tipo = 'sin_costo' or coalesce(s.monto_honorarios, 0) <= 0 then return jsonb_build_object('monto', 0, 'motivo', 'Trabajo sin costo'); end if;
  if s.convenio_id is not null then return jsonb_build_object('monto', 0, 'motivo', 'Trabajo con convenio'); end if;
  if s.honorario_tipo = 'estimado' and s.honorario_final_en is null then return jsonb_build_object('monto', 0, 'motivo', 'Falta el honorario final'); end if;
  v_factor := case when s.requiere_factura then 1.16 else 1 end;
  v_hon := round((s.monto_honorarios - s.credito_honorarios) * v_factor, 2);
  select coalesce(sum(monto), 0) into v_conf from pagos where solicitud_id = s.id and estado in ('confirmado', 'reportado');
  v_max := greatest(0, least(v_hon, s.monto_total - v_conf));
  return jsonb_build_object('monto', v_max, 'saldo', saldo_credito(s.organizacion_id, s.comisionista_id),
                            'motivo', case when v_max <= 0 then 'Ya está cubierto' end);
end;
$$;

create or replace function ejecutar_aplicar_credito(p_solicitud uuid, p_monto numeric, p_quien uuid)
returns numeric language plpgsql security definer set search_path = public as $$
declare
  s        solicitudes;
  v_ap     jsonb := credito_aplicable(p_solicitud);
  v_monto  numeric;
  v_factor numeric;
  v_resta  numeric;
  v_toma   numeric;
  v_pago   uuid;
  l        record;
begin
  select * into s from solicitudes where id = p_solicitud for update;
  v_monto := least((v_ap->>'monto')::numeric, saldo_credito(s.organizacion_id, s.comisionista_id), coalesce(p_monto, 1e12));
  if coalesce(v_monto, 0) <= 0 then
    raise exception 'No se puede aplicar crédito: %', coalesce(v_ap->>'motivo', 'sin saldo vigente');
  end if;
  v_monto := round(v_monto, 2);
  v_factor := case when s.requiere_factura then 1.16 else 1 end;
  -- Primero la parte con crédito (la comisión que se devengue al liquidarse ya la descuenta), luego el pago.
  update solicitudes set credito_honorarios = least(monto_honorarios, credito_honorarios + round(v_monto / v_factor, 2)) where id = s.id;
  insert into pagos (solicitud_id, via, monto, fecha_pago, referencia, nota, reportado_por)
  values (s.id, 'credito', v_monto, hoy_mx(), 'Crédito Tasa', 'Pagado con crédito del paquete', p_quien)
  returning id into v_pago;
  v_resta := v_monto;
  for l in select x.id, saldo_lote(x.id) as saldo from lotes_vigentes(s.organizacion_id, s.comisionista_id) x loop
    exit when v_resta <= 0;
    continue when l.saldo <= 0;
    v_toma := least(l.saldo, v_resta);
    insert into movimientos_credito (organizacion_id, persona_id, compra_id, tipo, monto, solicitud_id, pago_id, nota, creado_por)
    values (s.organizacion_id, s.comisionista_id, l.id, 'aplicacion', -v_toma, s.id, v_pago,
            'Trabajo ' || coalesce(s.folio, s.cliente_nombre), p_quien);
    v_resta := v_resta - v_toma;
  end loop;
  update pagos set estado = 'confirmado' where id = v_pago;
  return v_monto;
end;
$$;

-- Desde el detalle del trámite (admin_org o finanzas).
create or replace function aplicar_credito(p_solicitud uuid, p_monto numeric)
returns numeric language plpgsql security definer set search_path = public as $$
begin
  if mi_rol() not in ('admin_org', 'finanzas') then
    raise exception 'Solo finanzas o administración aplican crédito';
  end if;
  if not exists (select 1 from solicitudes where id = p_solicitud and organizacion_id = mi_org()) then
    raise exception 'Ese trabajo no existe';
  end if;
  return ejecutar_aplicar_credito(p_solicitud, p_monto, mi_persona_id());
end;
$$;

-- Devuelve a su lote lo aplicado (todo el trabajo, o un pago). Con su vigencia original.
create or replace function devolver_credito(p_solicitud uuid, p_pago uuid, p_nota text)
returns numeric language plpgsql security definer set search_path = public as $$
declare
  m       record;
  v_total numeric := 0;
  v_fac   numeric;
begin
  for m in select * from movimientos_credito x
            where x.tipo = 'aplicacion' and (x.solicitud_id = p_solicitud or x.pago_id = p_pago)
              and not exists (select 1 from movimientos_credito d where d.devuelve_id = x.id) loop
    insert into movimientos_credito (organizacion_id, persona_id, compra_id, tipo, monto, solicitud_id, pago_id, devuelve_id, nota, creado_por)
    values (m.organizacion_id, m.persona_id, m.compra_id, 'devolucion', -m.monto, m.solicitud_id, m.pago_id, m.id, p_nota, mi_persona_id());
    v_total := v_total - m.monto;
  end loop;
  if v_total > 0 and p_pago is not null then
    select case when requiere_factura then 1.16 else 1 end into v_fac from solicitudes s join pagos g on g.solicitud_id = s.id where g.id = p_pago;
    update solicitudes s set credito_honorarios = greatest(0, s.credito_honorarios - round(v_total / v_fac, 2))
      from pagos g where g.id = p_pago and s.id = g.solicitud_id;
  end if;
  return v_total;
end;
$$;

create or replace function al_cancelar_con_credito()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform devolver_credito(new.id, null, 'Trabajo cancelado: el crédito regresa');
  return null;
end;
$$;
create trigger devolver_credito_al_cancelar after update of estado on solicitudes
  for each row when (new.estado = 'cancelada' and old.estado is distinct from 'cancelada') execute function al_cancelar_con_credito();

create or replace function al_deshacer_pago_credito()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform devolver_credito(null, new.id, 'Pago con crédito deshecho: el crédito regresa');
  return null;
end;
$$;
create trigger devolver_credito_al_deshacer after update of estado on pagos
  for each row when (new.via = 'credito' and old.estado = 'confirmado' and new.estado <> 'confirmado') execute function al_deshacer_pago_credito();

-- Al nacer el trámite: entrega prioritaria (si su paquete la da) y "Pagar con mi crédito".
create or replace function al_nacer_tramite_paquete()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.estado = 'tramite' and (tg_op = 'INSERT' or old.estado is distinct from 'tramite') and new.comisionista_id is not null
     and coalesce((paquete_vigente(new.organizacion_id, new.comisionista_id)).entrega_prioritaria, false) then
    new.entrega_prioritaria := true;
  end if;
  return new;
end;
$$;
create trigger entrega_prioritaria before insert or update of estado on solicitudes
  for each row execute function al_nacer_tramite_paquete();

create or replace function al_tramite_pagar_con_credito()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  begin
    perform ejecutar_aplicar_credito(new.id, null, new.comisionista_id);
  exception when others then
    -- Sin saldo o el trabajo no admite crédito: se paga normal; finanzas puede aplicarlo después.
    null;
  end;
  return null;
end;
$$;
create trigger pagar_con_credito after insert or update of estado on solicitudes
  for each row when (new.estado = 'tramite' and new.pagar_con_credito) execute function al_tramite_pagar_con_credito();

-- El cron: los lotes vencidos con saldo se quedan en cero (queda el movimiento).
create or replace function vencer_creditos()
returns integer language plpgsql security definer set search_path = public as $$
declare
  l    record;
  v_n  integer := 0;
begin
  for l in select c.*, saldo_lote(c.id) as saldo from compras_paquete c
            where c.estado = 'confirmada' and c.tipo in ('compra', 'renovacion') and c.vence < hoy_mx() loop
    if l.saldo > 0 then
      perform set_config('tasa.motivo', 'Crédito vencido', true);
      insert into movimientos_credito (organizacion_id, persona_id, compra_id, tipo, monto, nota)
      values (l.organizacion_id, l.persona_id, l.id, 'vencimiento', -l.saldo, 'Venció sin renovar');
      v_n := v_n + 1;
    end if;
  end loop;
  perform set_config('tasa.motivo', '', true);
  return v_n;
end;
$$;

-- ------------------------------------------------------------
-- 6. Lecturas para las pantallas
-- ------------------------------------------------------------

-- Movimientos con su trabajo, para el comisionista y para administración.
create or replace function movimientos_de(p_org uuid, p_persona uuid, p_limite integer)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x order by x.creado_en desc, x.id desc), '[]') from (
    select m.id, m.tipo, m.monto, m.creado_en, m.nota, s.folio, s.cliente_nombre, p.nombre as paquete
      from movimientos_credito m join compras_paquete c on c.id = m.compra_id join paquetes p on p.id = c.paquete_id
      left join solicitudes s on s.id = m.solicitud_id
     where m.organizacion_id = p_org and m.persona_id = p_persona
     order by m.creado_en desc, m.id desc limit p_limite) x;
$$;

-- "Mis paquetes".
create or replace function mis_paquetes()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_org   uuid := mi_org();
  v_yo    uuid := mi_persona_id();
  l       compras_paquete;
  v_paq   paquetes;
  v_orig  paquetes;
begin
  if mi_rol() is distinct from 'comisionista' then
    raise exception 'Solo comisionistas';
  end if;
  select * into l from lotes_vigentes(v_org, v_yo) order by vence desc limit 1;
  v_paq := paquete_vigente(v_org, v_yo);
  if l.id is not null then select * into v_orig from paquetes where id = l.paquete_id; end if;
  return jsonb_build_object(
    'saldo', saldo_credito(v_org, v_yo),
    'vigente', case when l.id is not null then jsonb_build_object('compra_id', l.id, 'paquete', v_paq.nombre, 'clave', v_paq.clave, 'beneficios', v_paq.beneficios,
                 'inicia', l.inicia, 'vence', l.vence, 'credito', l.credito, 'saldo', saldo_lote(l.id),
                 'puede_subir', l.inicia >= hoy_mx() - 30, 'subir_hasta', l.inicia + 30) end,
    'catalogo', coalesce((select jsonb_agg(to_jsonb(p) - 'organizacion_id' order by p.orden) from paquetes p where p.organizacion_id = v_org and p.activo), '[]'),
    'terminos', (select jsonb_build_object('version', t.version, 'texto', t.texto) from terminos_paquetes t where t.organizacion_id = v_org order by t.version desc limit 1),
    'cuenta', (select jsonb_build_object('alias', c.alias, 'banco', c.banco, 'clabe', c.clabe, 'titular', c.titular)
                 from ajustes a join cuentas_receptoras c on c.id = a.cuenta_paquetes where a.organizacion_id = v_org),
    'por_pagar', (select jsonb_build_object('id', c.id, 'tipo', c.tipo, 'paquete', p.nombre, 'precio', c.precio, 'credito', c.credito, 'creado_en', c.creado_en)
                    from compras_paquete c join paquetes p on p.id = c.paquete_id
                   where c.organizacion_id = v_org and c.persona_id = v_yo and c.estado = 'por_pagar'),
    'comision_por_cobrar', (select coalesce(sum(monto - pagado), 0) from pendientes_comision where organizacion_id = v_org and comisionista_id = v_yo and pagado < monto),
    'por_vencer', (select jsonb_agg(jsonb_build_object('vence', x.vence, 'saldo', saldo_lote(x.id)) order by x.vence)
                     from lotes_vigentes(v_org, v_yo) x where x.vence <= hoy_mx() + 30 and saldo_lote(x.id) > 0),
    'compras', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'tipo', c.tipo, 'forma_pago', c.forma_pago, 'paquete', p.nombre, 'precio', c.precio,
                  'credito', c.credito, 'estado', c.estado, 'inicia', c.inicia, 'vence', c.vence, 'creado_en', c.creado_en,
                  'terminos_version', c.terminos_version, 'terminos_aceptados_en', c.terminos_aceptados_en) order by c.creado_en desc)
                  from compras_paquete c join paquetes p on p.id = c.paquete_id where c.organizacion_id = v_org and c.persona_id = v_yo), '[]'),
    'movimientos', movimientos_de(v_org, v_yo, 40));
end;
$$;

-- Administración: por confirmar y todos los lotes con su estado.
create or replace function paquetes_admin()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_org uuid := mi_org();
begin
  if mi_rol() not in ('admin_org', 'finanzas') then
    raise exception 'Solo administración';
  end if;
  return jsonb_build_object(
    'por_confirmar', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'persona', pe.nombre, 'persona_id', pe.id, 'tipo', c.tipo, 'paquete', p.nombre,
                        'precio', c.precio, 'credito', c.credito, 'creado_en', c.creado_en) order by c.creado_en)
                        from compras_paquete c join paquetes p on p.id = c.paquete_id join personas pe on pe.id = c.persona_id
                       where c.organizacion_id = v_org and c.estado = 'por_pagar'), '[]'),
    'lotes', coalesce((select jsonb_agg(x order by x.orden, x.vence) from (
        select c.id, pe.nombre as persona, pe.id as persona_id, p.nombre as paquete, c.forma_pago, c.inicia, c.vence, c.credito,
               c.pago_monto, c.folio_cfdi, saldo_lote(c.id) as saldo,
               (select coalesce(-sum(m.monto), 0) from movimientos_credito m where m.compra_id = c.id and m.tipo in ('aplicacion', 'devolucion')) as consumido,
               (select coalesce(-sum(m.monto), 0) from movimientos_credito m where m.compra_id = c.id and m.tipo = 'vencimiento') as vencido,
               case when c.reemplazada_por is not null then 'renovado'
                    when c.vence < hoy_mx() then 'vencido'
                    when saldo_lote(c.id) <= 0 then 'consumido'
                    when c.vence <= hoy_mx() + 30 then 'por_vencer'
                    else 'vigente' end as estado,
               case when c.reemplazada_por is not null then 4 when c.vence < hoy_mx() then 3 when saldo_lote(c.id) <= 0 then 2
                    when c.vence <= hoy_mx() + 30 then 0 else 1 end as orden
          from compras_paquete c join paquetes p on p.id = c.paquete_id join personas pe on pe.id = c.persona_id
         where c.organizacion_id = v_org and c.estado = 'confirmada' and c.tipo in ('compra', 'renovacion')) x), '[]'),
    'cuentas', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'alias', c.alias) order by c.alias) from cuentas_receptoras c
                          where c.organizacion_id = v_org and c.activa), '[]'),
    'cuenta_paquetes', (select cuenta_paquetes from ajustes where organizacion_id = v_org));
end;
$$;

-- Accesos y el detalle del trámite: paquete y saldo de una persona.
create or replace function credito_de(p_persona uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_org uuid := mi_org();
  v_paq paquetes;
begin
  if mi_rol() not in ('admin_org', 'finanzas') then
    raise exception 'Solo administración';
  end if;
  v_paq := paquete_vigente(v_org, p_persona);
  return jsonb_build_object('paquete', v_paq.nombre, 'vence', (select max(vence) from lotes_vigentes(v_org, p_persona)),
                            'saldo', saldo_credito(v_org, p_persona), 'movimientos', movimientos_de(v_org, p_persona, 10));
end;
$$;

-- Estadísticas: ventas y consumo de crédito del periodo.
create or replace function estadisticas_credito(p_desde date, p_hasta date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_org uuid := mi_org();
begin
  if mi_rol() not in ('admin_org', 'finanzas') then
    raise exception 'Solo administración';
  end if;
  return jsonb_build_object(
    'ventas', coalesce((select jsonb_agg(x order by x.orden) from (
        select p.nombre as paquete, p.orden, count(c.*) as vendidos, coalesce(sum(c.pago_monto), 0) as cobrado,
               count(c.*) filter (where c.forma_pago = 'comision') as con_comision, coalesce(sum(c.credito), 0) as credito
          from paquetes p join compras_paquete c on c.paquete_id = p.id and c.estado = 'confirmada'
           and c.pago_fecha between p_desde and p_hasta
         where p.organizacion_id = v_org group by p.nombre, p.orden) x), '[]'),
    'consumo', (select jsonb_build_object(
        'aplicado', coalesce(-sum(monto) filter (where tipo = 'aplicacion'), 0),
        'devuelto', coalesce(sum(monto) filter (where tipo = 'devolucion'), 0),
        'vencido', coalesce(-sum(monto) filter (where tipo = 'vencimiento'), 0),
        'trabajos', count(distinct solicitud_id) filter (where tipo = 'aplicacion'))
      from movimientos_credito where organizacion_id = v_org
       and (creado_en at time zone 'America/Mexico_City')::date between p_desde and p_hasta),
    'saldo_vigente', (select coalesce(sum(saldo_lote(c.id)), 0) from compras_paquete c
                       where c.organizacion_id = v_org and c.estado = 'confirmada' and c.tipo in ('compra', 'renovacion')
                         and c.reemplazada_por is null and c.vence >= hoy_mx()));
end;
$$;

-- La insignia de la tarjeta pública (anon): solo el texto, con paquete vigente.
create or replace function insignia_tarjeta(p_org text, p_clave text)
returns text language sql stable security definer set search_path = public as $$
  select (paquete_vigente(o.id, c.persona_id)).insignia
    from organizaciones o join comisionistas c on c.organizacion_id = o.id
   where o.slug = lower(trim(p_org)) and o.activa
     and (c.slug = lower(trim(p_clave)) or c.codigo_referido = upper(trim(p_clave)))
   limit 1;
$$;

create or replace function mi_insignia()
returns text language sql stable security definer set search_path = public as $$
  select (paquete_vigente(mi_org(), mi_persona_id())).insignia;
$$;

-- ------------------------------------------------------------
-- 7. Lo que cambia: comisión y bono sobre la parte en dinero; cupos con paquete
-- ------------------------------------------------------------

-- 0047 + la base es lo pagado en dinero (honorarios − la parte con crédito).
create or replace function devengar_comision(p_solicitud uuid, p_tarde boolean, p_nota text)
returns void language plpgsql security definer set search_path = public as $$
declare
  s       solicitudes%rowtype;
  v_mes   date;
  v_pct   numeric;
  v_tipo  text := 'comision';
begin
  select * into s from solicitudes where id = p_solicitud;
  if s.pagado_en is null or coalesce(s.monto_honorarios, 0) - s.credito_honorarios <= 0 or s.comisionista_id is null
     or s.comision_regla = 'ninguna' then
    return;
  end if;
  if exists (select 1 from comisiones c
              where c.solicitud_id = s.id and c.comisionista_id = s.comisionista_id and c.tipo in ('comision', 'ajuste')
                and c.anula_id is null and not exists (select 1 from comisiones x where x.anula_id = c.id)) then
    return;
  end if;

  v_mes := mes_abierto_desde(s.organizacion_id, s.pagado_en);
  if p_tarde and (mes_aprobado(s.organizacion_id, mes_de(s.pagado_en))
                  or exists (select 1 from comisiones c where c.solicitud_id = s.id
                                and c.comisionista_id = s.comisionista_id and c.tipo = 'comision')) then
    v_tipo := 'ajuste';
  end if;
  v_pct := case when s.comision_regla = 'fija' then s.comision_pct
                else porcentaje_vigente(s.organizacion_id, s.comisionista_id, v_mes) end;

  insert into comisiones (organizacion_id, comisionista_id, solicitud_id, tipo, base, porcentaje,
                          provisional, monto, mes, nota, creada_por)
  values (s.organizacion_id, s.comisionista_id, s.id, v_tipo, s.monto_honorarios - s.credito_honorarios, v_pct,
          v_tipo = 'comision' and s.comision_regla <> 'fija'
            and porcentaje_es_provisional(s.organizacion_id, s.comisionista_id, v_mes),
          round((s.monto_honorarios - s.credito_honorarios) * v_pct / 100, 2), v_mes,
          coalesce(p_nota,
            case when s.comision_regla = 'fija' then 'Devengada al quedar pagado el trabajo (% fijo del convenio)'
                 else 'Devengada al quedar pagado el trabajo' end),
          case when p_tarde then mi_persona_id() end);
end;
$$;

-- 0044 + el bono por referido también sobre la parte en dinero (el tope de 30% sigue sobre los honorarios completos).
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
      select s.id, s.comisionista_id, s.monto_honorarios - s.credito_honorarios as monto_honorarios, s.monto_honorarios as honorarios_completos, s.pagado_en,
             (select m.bono_referido_hasta from membresias m where m.organizacion_id = p_org and m.persona_id = r.referidor_id) as hasta
        from vinculos_referido vr
        join solicitudes s on s.organizacion_id = p_org and s.comisionista_id = vr.referido_id
       where vr.organizacion_id = p_org and vr.referidor_id = r.referidor_id and vr.tipo = r.tipo and vr.estado = 'activo'
         and s.mes_cierre = v_mes and s.pagado_en is not null and s.estado <> 'cancelada'
         and coalesce(s.monto_honorarios, 0) - s.credito_honorarios > 0 and s.comision_regla <> 'ninguna' and s.honorario_tipo <> 'sin_costo'
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
      v_monto := least(v_bruto, greatest(round(t.honorarios_completos * 0.30, 2) - v_ya, 0));
      beneficiario := r.referidor_id; tipo := r.tipo; referido := t.comisionista_id; solicitud := t.id;
      base := t.monto_honorarios; porcentaje := v_pct; bruto := v_bruto; monto := v_monto;
      tope_ajustado := v_monto < v_bruto; activos := v_act;
      return next;
    end loop;
  end loop;
end;
$$;

-- 0072 + con paquete: cupos de nivel Socio o sin límite.
create or replace function cupo_de(p_org uuid, p_persona uuid, p_herramienta text)
returns table (limite integer, extras integer, usados integer, disponibles integer)
language plpgsql stable security definer set search_path = public as $$
declare
  v_mes   date := mes_mx(now());
  v_rol   text := (select rol from membresias where organizacion_id = p_org and persona_id = p_persona and activa limit 1);
  v_lim   integer;
  v_hay   boolean := false;
begin
  if v_rol is distinct from 'comisionista' or herramientas_sin_limite(p_org, p_persona) then
    v_lim := null;
  else
    select true, c.cantidad into v_hay, v_lim from cupos_herramienta c
     where c.organizacion_id = p_org and c.herramienta = p_herramienta and c.nivel_id = nivel_herramientas(p_org, p_persona, v_mes);
    if not coalesce(v_hay, false) then v_lim := null; end if;
  end if;
  extras := coalesce((select sum(e.cantidad) from extras_herramienta e where e.organizacion_id = p_org and e.persona_id = p_persona
                       and e.herramienta = p_herramienta and e.mes = v_mes), 0);
  usados := (select count(*) from usos_herramienta u where u.organizacion_id = p_org and u.persona_id = p_persona and not u.humo
              and u.herramienta = p_herramienta and mes_mx(u.creado_en) = v_mes);
  limite := v_lim;
  disponibles := case when v_lim is null then null else greatest(0, v_lim + extras - usados) end;
  return next;
end;
$$;

-- 0075 + con paquete, el nivel de las herramientas es al menos Socio (o todas, sin límite).
create or replace function mis_herramientas()
returns table (clave text, nombre text, en_menu boolean, orden integer)
language sql stable security definer set search_path = public as $$
  select h.clave, h.nombre, h.en_menu, h.orden
    from herramientas h
   where h.organizacion_id = mi_org() and h.activa and mi_rol() = any (h.roles)
     and (mi_rol() <> 'comisionista' or h.niveles is null or mi_nivel_actual() = any (h.niveles)
          or nivel_herramientas(mi_org(), mi_persona_id(), mes_mx(now())) = any (h.niveles) or herramientas_sin_limite(mi_org(), mi_persona_id()))
     and not (mi_rol() = 'comisionista' and herramienta_de_activos(h.clave) and esta_inactiva(mi_org(), mi_persona_id()))
   order by h.orden;
$$;

create or replace function catastro_tiene_herramienta(p_org uuid, p_persona uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from herramientas h, lateral (select catastro_rol_de(p_org, p_persona) as v_rol) r
     where h.organizacion_id = p_org and h.clave = 'mapa_catastral' and h.activa and r.v_rol = any (h.roles)
       and (r.v_rol <> 'comisionista' or h.niveles is null or nivel_herramientas(p_org, p_persona, mes_mx(now())) = any (h.niveles)
            or herramientas_sin_limite(p_org, p_persona))
       and not (r.v_rol = 'comisionista' and esta_inactiva(p_org, p_persona)));
$$;

-- ------------------------------------------------------------
-- 8. Permisos
-- ------------------------------------------------------------
revoke all on function sembrar_paquetes(uuid), saldo_lote(uuid), lotes_vigentes(uuid, uuid), paquete_vigente(uuid, uuid), saldo_credito(uuid, uuid),
  nivel_herramientas(uuid, uuid, date), herramientas_sin_limite(uuid, uuid), pedir_paquete(uuid, text, integer), cancelar_compra_paquete(uuid, text),
  sumar_dxf_paquete(uuid, uuid, integer, text, uuid), ejecutar_confirmar_compra(uuid, date, uuid),
  confirmar_compra_paquete(uuid, numeric, date, uuid, text, text), comprar_paquete_con_comision(uuid, integer), credito_aplicable(uuid),
  ejecutar_aplicar_credito(uuid, numeric, uuid), aplicar_credito(uuid, numeric), devolver_credito(uuid, uuid, text), al_cancelar_con_credito(),
  al_deshacer_pago_credito(), al_nacer_tramite_paquete(), al_tramite_pagar_con_credito(), vencer_creditos(), movimientos_de(uuid, uuid, integer),
  mis_paquetes(), paquetes_admin(), credito_de(uuid), estadisticas_credito(date, date), insignia_tarjeta(text, text), mi_insignia()
  from public, anon, authenticated;
grant execute on function pedir_paquete(uuid, text, integer), cancelar_compra_paquete(uuid, text), confirmar_compra_paquete(uuid, numeric, date, uuid, text, text),
  comprar_paquete_con_comision(uuid, integer), credito_aplicable(uuid), aplicar_credito(uuid, numeric), mis_paquetes(), paquetes_admin(), credito_de(uuid),
  estadisticas_credito(date, date), mi_insignia() to authenticated;
grant execute on function insignia_tarjeta(text, text) to anon, authenticated;
grant execute on function vencer_creditos() to service_role;
