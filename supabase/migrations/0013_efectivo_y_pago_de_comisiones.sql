-- ============================================================
-- 0013 — EFECTIVO, COMISIONISTAS Y PAGO DE COMISIONES
--
-- 1. Pagos del cliente en efectivo: vía `efectivo`, con quién lo
--    recibió; el recibo es opcional.
-- 2. Comisionistas: RFC y "emite factura"; alta, edición y baja desde
--    el panel por funciones (dos tablas en un solo paso).
-- 3. ASIGNACIÓN (para reportes): todo movimiento de `comisiones` lleva
--    empresa (cuenta receptora) y servicio. Los de un trabajo los toman
--    del trabajo; los manuales exigen empresa.
-- 4. PAGO (independiente de la empresa): al aprobar un cierre nace un
--    pendiente por comisionista con el total del mes. Un pago de
--    comisión cubre uno o varios pendientes, completos o en parte. Si
--    el mes de alguien sale negativo, no hay pendiente: el negativo
--    pasa como "arrastre" al siguiente mes abierto.
--
-- El comisionista ve sus pendientes y, de cada pago, fecha, referencia
-- y monto. NUNCA el origen del dinero: la tabla de pagos de comisión
-- solo la lee el staff; él la lee por `mis_pagos_comision()`.
-- ============================================================

-- ------------------------------------------------------------
-- 1. PAGOS DEL CLIENTE EN EFECTIVO
-- ------------------------------------------------------------

alter table pagos drop constraint pagos_via_check;
alter table pagos
  add constraint pagos_via_check check (via in ('comprobante', 'directo', 'aviso', 'efectivo')),
  add column recibido_por text check (char_length(recibido_por) <= 80),
  add constraint pagos_efectivo_con_quien
    check (via <> 'efectivo' or nullif(trim(recibido_por), '') is not null);

drop policy reportar_pago on pagos;
create policy reportar_pago on pagos for insert
  with check (
    mi_rol() = 'comisionista'
    and via in ('comprobante', 'aviso', 'efectivo')
    and estado = 'reportado'
    and reportado_por = mi_persona_id()
    and solicitud_id in (
      select id from solicitudes
       where comisionista_id = mi_persona_id() and estado = 'tramite'
    )
  );

-- ------------------------------------------------------------
-- 2. COMISIONISTAS Y AJUSTES
-- ------------------------------------------------------------

alter table comisionistas
  add column rfc text check (rfc is null or rfc ~ '^[A-ZÑ&]{3,4}[0-9]{6}[A-Z0-9]{3}$'),
  add column emite_factura boolean not null default false;

-- Día del mes siguiente al de las comisiones en que vence su pago.
alter table ajustes
  add column dia_limite_pago_comision smallint not null default 10
    check (dia_limite_pago_comision between 1 and 28);

-- ------------------------------------------------------------
-- 3. ASIGNACIÓN DE CADA MOVIMIENTO
-- ------------------------------------------------------------
-- `arrastre`: el saldo negativo de un mes cerrado. Sale del mes con un
-- positivo (lo deja en cero) y entra al siguiente abierto con el
-- negativo. No tiene empresa y los reportes por empresa no lo cuentan:
-- el cargo original ya está contado en su mes.

alter table comisiones drop constraint comisiones_tipo_check;
alter table comisiones
  add constraint comisiones_tipo_check
    check (tipo in ('comision', 'bono', 'ajuste', 'cargo', 'referido', 'arrastre')),
  add column cuenta_receptora_id uuid references cuentas_receptoras(id) on delete restrict,
  add column servicio_id uuid references servicios(id) on delete restrict;

create or replace function asignar_comision()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.solicitud_id is not null then
    select cuenta_receptora_id, servicio_id
      into new.cuenta_receptora_id, new.servicio_id
      from solicitudes where id = new.solicitud_id;
  elsif new.tipo <> 'arrastre' and new.cuenta_receptora_id is null then
    raise exception 'Elige la empresa (cuenta receptora) a la que se asigna el movimiento';
  end if;
  if new.tipo = 'arrastre' then
    new.cuenta_receptora_id := null;
    new.servicio_id := null;
  end if;
  return new;
end;
$$;

-- Los disparadores corren por orden de nombre: "z_" deja que primero
-- hablen el candado del mes y el tope, que dan el error más útil.
create trigger z_asignar
  before insert on comisiones
  for each row execute function asignar_comision();

-- Lo que ya existía, aunque esté en un mes cerrado: el candado del
-- mes se apaga solo durante este relleno.
alter table comisiones disable trigger mes_cerrado;
update comisiones c
   set cuenta_receptora_id = s.cuenta_receptora_id, servicio_id = s.servicio_id
  from solicitudes s
 where s.id = c.solicitud_id;
alter table comisiones enable trigger mes_cerrado;

-- El resumen del cierre agrupa por la empresa asignada.
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
                     select case when c2.tipo = 'arrastre' then 'Saldo arrastrado'
                                 else coalesce(cr.alias, 'Sin cuenta') end as cuenta,
                            sum(c2.monto) as total
                       from comisiones c2
                       left join cuentas_receptoras cr on cr.id = c2.cuenta_receptora_id
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
-- 4. ORIGEN DEL DINERO (catálogo, lo edita super_admin)
-- ------------------------------------------------------------

create table origenes_pago (
  id      uuid primary key default gen_random_uuid(),
  nombre  text not null unique check (char_length(trim(nombre)) between 1 and 40),
  activo  boolean not null default true,
  orden   smallint not null default 0
);

insert into origenes_pago (nombre, orden) values
  ('Scotiabank XG', 1), ('Banorte personal', 2), ('Efectivo', 3), ('Otra', 4);

-- ------------------------------------------------------------
-- 5. PENDIENTES Y PAGOS DE COMISIÓN
-- ------------------------------------------------------------

create table pendientes_comision (
  id                 uuid primary key default gen_random_uuid(),
  comisionista_id    uuid not null references comisionistas(persona_id) on delete restrict,
  cierre_id          uuid not null references cierres(id) on delete restrict,
  mes                date not null check (mes = mes_de(mes)),
  monto              numeric(12,2) not null check (monto > 0),
  -- Lo cubierto por pagos. Solo lo mueve `registrar_pago_comision`.
  pagado             numeric(12,2) not null default 0 check (pagado >= 0 and pagado <= monto),
  -- Fecha del pago que lo dejó completo.
  pagado_en          date,
  -- Factura o recibo del comisionista, en el bucket privado `facturas`.
  factura_ruta       text,
  factura_subida_en  timestamptz,
  creado_en          timestamptz not null default now(),
  unique (comisionista_id, mes),
  check ((pagado_en is not null) = (pagado = monto))
);

create table pagos_comision (
  id                uuid primary key default gen_random_uuid(),
  comisionista_id   uuid not null references comisionistas(persona_id) on delete restrict,
  fecha             date not null,
  monto             numeric(12,2) not null check (monto > 0),
  origen_id         uuid not null references origenes_pago(id) on delete restrict,
  referencia        text check (char_length(referencia) <= 80),
  comprobante_ruta  text,
  documento         text not null check (documento in ('factura', 'recibo', 'ninguno')),
  nota              text check (char_length(nota) <= 300),
  registrado_por    uuid references personas(id) on delete set null,
  registrado_en     timestamptz not null default now()
);

-- Qué parte de cada pago cubre qué pendiente.
create table aplicaciones_pago_comision (
  pago_id       uuid not null references pagos_comision(id) on delete restrict,
  pendiente_id  uuid not null references pendientes_comision(id) on delete restrict,
  monto         numeric(12,2) not null check (monto > 0),
  primary key (pago_id, pendiente_id)
);

create index on pendientes_comision (comisionista_id);
create index on pagos_comision (comisionista_id, fecha);
create index on aplicaciones_pago_comision (pendiente_id);

create trigger bitacora after insert or update or delete on origenes_pago
  for each row execute function registrar_bitacora();
create trigger bitacora after insert or update or delete on pendientes_comision
  for each row execute function registrar_bitacora();
create trigger bitacora after insert or update or delete on pagos_comision
  for each row execute function registrar_bitacora();
create trigger bitacora after insert or update or delete on aplicaciones_pago_comision
  for each row execute function registrar_bitacora();

-- Cuándo vence el pago de las comisiones de un mes: el día límite del
-- mes siguiente. Se calcula, no se guarda: si super_admin cambia el
-- día, cambia para todos los pendientes.
create or replace function vence_pago_comision(p_mes date)
returns date language sql stable security definer set search_path = public as $$
  select (mes_de(p_mes) + interval '1 month')::date
         + ((select dia_limite_pago_comision from ajustes) - 1);
$$;

-- ------------------------------------------------------------
-- 6. APROBAR EL CIERRE AHORA TAMBIÉN DEJA LOS PENDIENTES
-- ------------------------------------------------------------
-- Igual que en 0005, más dos pasos antes de congelar el mes:
--   · saldo negativo → arrastre al siguiente mes abierto;
--   · saldo positivo → pendiente de pago (después de aprobar).

create or replace function ejecutar_aprobacion_cierre(p_mes date, p_persona uuid)
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
  select * into v_cierre from cierres where mes = v_mes for update;
  if not found then
    raise exception 'Primero hay que preparar el cierre de %', to_char(v_mes, 'YYYY-MM');
  end if;
  if v_cierre.estado = 'aprobado' then
    raise exception 'El cierre de % ya estaba aprobado', to_char(v_mes, 'YYYY-MM');
  end if;

  select min(mes) into v_previo
    from comisiones
   where mes < v_mes and not mes_aprobado(mes);
  if v_previo is not null then
    raise exception 'Antes hay que aprobar %', to_char(v_previo, 'YYYY-MM');
  end if;

  perform recalcular_comisiones_del_mes(v_mes);
  update comisiones set provisional = false where mes = v_mes and provisional;

  -- Saldo negativo: sale de este mes en cero y entra al siguiente.
  v_destino := mes_abierto_desde(v_siguiente);
  for k in
    select comisionista_id, sum(monto) as total
      from comisiones where mes = v_mes
     group by comisionista_id having sum(monto) < 0
  loop
    insert into comisiones (comisionista_id, tipo, monto, mes, nota, creada_por)
    values (k.comisionista_id, 'arrastre', -k.total, v_mes,
            'Saldo negativo que pasa a ' || to_char(v_destino, 'YYYY-MM'), p_persona);
    insert into comisiones (comisionista_id, tipo, monto, mes, nota, creada_por)
    values (k.comisionista_id, 'arrastre', k.total, v_destino,
            'Saldo negativo de ' || to_char(v_mes, 'YYYY-MM'), p_persona);
  end loop;

  update comisiones set cierre_id = v_cierre.id where mes = v_mes;

  update cierres
     set estado = 'aprobado',
         resumen = resumen_del_mes(v_mes),
         aprobado_por = p_persona,
         aprobado_en = now()
   where id = v_cierre.id;

  -- Un pendiente por comisionista con saldo a favor.
  insert into pendientes_comision (comisionista_id, cierre_id, mes, monto)
  select comisionista_id, v_cierre.id, v_mes, sum(monto)
    from comisiones where mes = v_mes
   group by comisionista_id having sum(monto) > 0;

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

  if not mes_aprobado(v_siguiente) then
    perform recalcular_comisiones_del_mes(v_siguiente);
  end if;

  return v_cierre.id;
end;
$$;

-- Los cierres aprobados antes de esta migración también dejan su
-- pendiente. Si ya se habían marcado pagados con el botón anterior,
-- el pendiente nace cubierto por un pago "Otra" que lo explica.
do $$
declare
  k       record;
  v_pend  uuid;
  v_pago  uuid;
  v_otra  uuid := (select id from origenes_pago where nombre = 'Otra');
begin
  for k in
    select c.comisionista_id, c.mes, ci.id as cierre_id, sum(c.monto) as total,
           bool_and(c.estado = 'pagada') as todo_pagado, max(c.pagada_en) as pagada_en
      from comisiones c join cierres ci on ci.mes = c.mes and ci.estado = 'aprobado'
     group by c.comisionista_id, c.mes, ci.id
    having sum(c.monto) > 0
  loop
    insert into pendientes_comision (comisionista_id, cierre_id, mes, monto)
    values (k.comisionista_id, k.cierre_id, k.mes, k.total)
    returning id into v_pend;
    if k.todo_pagado then
      insert into pagos_comision (comisionista_id, fecha, monto, origen_id, referencia, documento, nota)
      values (k.comisionista_id, k.pagada_en, k.total, v_otra, 'Registro anterior',
              'ninguno', 'Marcado como pagado antes de que existieran los pagos de comisión')
      returning id into v_pago;
      insert into aplicaciones_pago_comision (pago_id, pendiente_id, monto) values (v_pago, v_pend, k.total);
      update pendientes_comision set pagado = monto, pagado_en = k.pagada_en where id = v_pend;
    end if;
  end loop;
end;
$$;

-- ------------------------------------------------------------
-- 7. REGISTRAR UN PAGO DE COMISIÓN
-- ------------------------------------------------------------
-- p_aplicaciones: [{"pendiente_id": "…", "monto": 1234.50}, …], todos
-- del mismo comisionista. Al completarse un pendiente, sus comisiones
-- quedan "pagada" con la fecha del pago.

create or replace function ejecutar_pago_comision(
  p_persona uuid, p_comisionista uuid, p_fecha date, p_origen uuid, p_referencia text,
  p_comprobante text, p_documento text, p_nota text, p_aplicaciones jsonb
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  a        record;
  pc       pendientes_comision%rowtype;
  v_total  numeric;
  v_pago   uuid;
begin
  if p_fecha is null or p_fecha > hoy_mx() then
    raise exception 'La fecha del pago no puede ser futura';
  end if;
  if not exists (select 1 from origenes_pago where id = p_origen and activo) then
    raise exception 'Elige de dónde salió el dinero';
  end if;
  if coalesce(jsonb_array_length(p_aplicaciones), 0) = 0 then
    raise exception 'Elige al menos un pendiente';
  end if;

  select sum(round((x->>'monto')::numeric, 2)) into v_total from jsonb_array_elements(p_aplicaciones) x;
  if v_total is null or v_total <= 0 then
    raise exception 'El pago tiene que ser mayor que cero';
  end if;

  insert into pagos_comision (comisionista_id, fecha, monto, origen_id, referencia, comprobante_ruta,
                              documento, nota, registrado_por)
  values (p_comisionista, p_fecha, v_total, p_origen, nullif(trim(p_referencia), ''), p_comprobante,
          p_documento, nullif(trim(p_nota), ''), p_persona)
  returning id into v_pago;

  for a in
    select (x->>'pendiente_id')::uuid as pendiente_id, round((x->>'monto')::numeric, 2) as monto
      from jsonb_array_elements(p_aplicaciones) x
  loop
    select * into pc from pendientes_comision where id = a.pendiente_id for update;
    if not found or pc.comisionista_id <> p_comisionista then
      raise exception 'Un pendiente no es de este comisionista';
    end if;
    if a.monto is null or a.monto <= 0 then
      raise exception 'Cada monto aplicado tiene que ser mayor que cero';
    end if;
    if pc.pagado + a.monto > pc.monto then
      raise exception 'El pendiente de % solo tiene % por pagar', to_char(pc.mes, 'YYYY-MM'), pc.monto - pc.pagado;
    end if;

    insert into aplicaciones_pago_comision (pago_id, pendiente_id, monto) values (v_pago, pc.id, a.monto);
    update pendientes_comision
       set pagado = pagado + a.monto,
           pagado_en = case when pagado + a.monto = monto then p_fecha end
     where id = pc.id;
    if pc.pagado + a.monto = pc.monto then
      update comisiones set estado = 'pagada', pagada_en = p_fecha
       where comisionista_id = p_comisionista and mes = pc.mes and estado = 'devengada';
    end if;
  end loop;

  return v_pago;
end;
$$;

create or replace function registrar_pago_comision(
  p_comisionista uuid, p_fecha date, p_origen uuid, p_referencia text,
  p_comprobante text, p_documento text, p_nota text, p_aplicaciones jsonb
) returns uuid language plpgsql security definer set search_path = public as $$
begin
  if not soy_staff() then
    raise exception 'Solo finanzas o super_admin registran pagos de comisión';
  end if;
  if p_comprobante is not null and p_comprobante not like mi_persona_id()::text || '/%' then
    raise exception 'El comprobante no es válido';
  end if;
  return ejecutar_pago_comision(mi_persona_id(), p_comisionista, p_fecha, p_origen, p_referencia,
                                p_comprobante, p_documento, p_nota, p_aplicaciones);
end;
$$;

-- Lo que el comisionista ve de sus pagos: sin origen, sin comprobante.
create or replace function mis_pagos_comision()
returns table (pendiente_id uuid, fecha date, referencia text, monto numeric)
language sql stable security definer set search_path = public as $$
  select a.pendiente_id, p.fecha, p.referencia, a.monto
    from aplicaciones_pago_comision a
    join pagos_comision p on p.id = a.pago_id
   where p.comisionista_id = mi_persona_id()
   order by p.fecha, p.registrado_en;
$$;

-- El comisionista sube su factura o recibo de un pendiente suyo.
create or replace function subir_factura_comision(p_pendiente uuid, p_ruta text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_ruta is null or p_ruta not like mi_persona_id()::text || '/%' then
    raise exception 'El archivo no es válido. Súbelo otra vez.';
  end if;
  update pendientes_comision
     set factura_ruta = p_ruta, factura_subida_en = now()
   where id = p_pendiente and comisionista_id = mi_persona_id();
  if not found then
    raise exception 'Ese pendiente no es tuyo';
  end if;
end;
$$;

-- Lo que falta por pagar, con vencimiento y si espera factura. El
-- inicio del staff y la bandeja de comisiones leen de aquí.
create or replace function comisiones_por_pagar()
returns table (
  pendiente_id uuid, comisionista_id uuid, comisionista text, mes date,
  monto numeric, pagado numeric, saldo numeric, vence_en date, vencido boolean,
  esperando_factura boolean
) language sql stable security definer set search_path = public as $$
  select pc.id, pc.comisionista_id, p.nombre, pc.mes,
         pc.monto, pc.pagado, pc.monto - pc.pagado,
         vence_pago_comision(pc.mes), hoy_mx() > vence_pago_comision(pc.mes),
         c.emite_factura and pc.factura_ruta is null
    from pendientes_comision pc
    join comisionistas c on c.persona_id = pc.comisionista_id
    join personas p on p.id = pc.comisionista_id
   where pc.pagado < pc.monto
     and soy_staff()
   order by vence_pago_comision(pc.mes), p.nombre;
$$;

-- ------------------------------------------------------------
-- 8. COMISIONISTAS DESDE EL PANEL
-- ------------------------------------------------------------

-- El nivel con el que se calcula hoy: Élite si está forzado; si no, el
-- del mes, el último conocido o el más bajo (mismo orden que el porcentaje).
create or replace function nivel_vigente(p_comisionista uuid, p_mes date)
returns text language sql stable security definer set search_path = public as $$
  select coalesce(
    (select n.nombre from comisionistas c, niveles n
      where c.persona_id = p_comisionista and c.porcentaje_forzado is not null and n.es_forzado
      order by n.orden limit 1),
    (select n.nombre from niveles_mensuales nm join niveles n on n.id = nm.nivel_id
      where nm.comisionista_id = p_comisionista and nm.mes <= mes_de(p_mes)
      order by nm.mes desc limit 1),
    (select nombre from niveles where not es_forzado order by orden limit 1)
  );
$$;

create or replace function resumen_comisionistas()
returns table (
  persona_id uuid, nombre text, correo text, activo boolean, nivel text, porcentaje numeric,
  provisional boolean, trabajos_activos bigint, comision_mes numeric, saldo_por_pagar numeric,
  ultimo_acceso timestamptz
) language sql stable security definer set search_path = public as $$
  select p.id, p.nombre, p.correo, p.activo,
         nivel_vigente(p.id, hoy_mx()),
         porcentaje_vigente(p.id, hoy_mx()),
         porcentaje_es_provisional(p.id, hoy_mx()),
         (select count(*) from solicitudes s
           where s.comisionista_id = p.id and s.estado in ('solicitada', 'cotizada', 'tramite')
             and s.pagado_en is null),
         (select coalesce(sum(monto), 0) from comisiones
           where comisionista_id = p.id and mes = mes_abierto_desde(hoy_mx())),
         (select coalesce(sum(monto - pagado), 0) from pendientes_comision where comisionista_id = p.id),
         u.last_sign_in_at
    from personas p
    join comisionistas c on c.persona_id = p.id
    left join auth.users u on u.id = p.user_id
   where soy_staff()
   order by p.nombre;
$$;

create or replace function alta_comisionista(
  p_nombre text, p_correo text, p_telefono text, p_rfc text, p_slug text,
  p_referido_por uuid, p_emite_factura boolean
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  if not soy_staff() then
    raise exception 'Solo finanzas o super_admin dan de alta comisionistas';
  end if;
  if nullif(trim(p_nombre), '') is null then
    raise exception 'Falta el nombre';
  end if;
  if trim(p_correo) !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'El correo no es válido';
  end if;
  if exists (select 1 from personas where lower(correo) = lower(trim(p_correo))) then
    raise exception 'Ese correo ya está dado de alta';
  end if;
  if exists (select 1 from comisionistas where slug = p_slug) then
    raise exception 'Esa liga (slug) ya la usa otra persona';
  end if;

  insert into personas (nombre, correo, telefono, rol)
  values (trim(p_nombre), lower(trim(p_correo)), nullif(trim(p_telefono), ''), 'comisionista')
  returning id into v_id;

  insert into comisionistas (persona_id, slug, rfc, referido_por, emite_factura)
  values (v_id, p_slug, nullif(upper(trim(p_rfc)), ''), p_referido_por, coalesce(p_emite_factura, false));

  -- Si ya tenía usuario de autenticación (entró antes de estar dado de alta).
  update personas p set user_id = u.id
    from auth.users u
   where p.id = v_id and lower(u.email) = lower(p.correo)
     and not exists (select 1 from personas o where o.user_id = u.id);

  return v_id;
end;
$$;

create or replace function actualizar_comisionista(
  p_persona uuid, p_nombre text, p_telefono text, p_rfc text, p_emite_factura boolean
) returns void language plpgsql security definer set search_path = public as $$
begin
  if not soy_staff() then
    raise exception 'Solo finanzas o super_admin editan comisionistas';
  end if;
  if nullif(trim(p_nombre), '') is null then
    raise exception 'Falta el nombre';
  end if;
  update personas set nombre = trim(p_nombre), telefono = nullif(trim(p_telefono), '')
   where id = p_persona and rol = 'comisionista';
  update comisionistas set rfc = nullif(upper(trim(p_rfc)), ''), emite_factura = coalesce(p_emite_factura, false)
   where persona_id = p_persona;
  if not found then
    raise exception 'No existe ese comisionista';
  end if;
end;
$$;

-- Inactivo: no entra al portal ni se le calcula nivel. Lo que se le
-- debe se le sigue pagando.
create or replace function cambiar_activo_comisionista(p_persona uuid, p_activo boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not soy_staff() then
    raise exception 'Solo finanzas o super_admin activan o desactivan comisionistas';
  end if;
  update personas set activo = p_activo where id = p_persona and rol = 'comisionista';
  if not found then
    raise exception 'No existe ese comisionista';
  end if;
end;
$$;

-- Élite: un porcentaje fijo que manda sobre el nivel calculado. Nulo lo quita.
create or replace function forzar_elite(p_persona uuid, p_porcentaje numeric)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not soy_super_admin() then
    raise exception 'Solo super_admin fuerza el nivel Élite';
  end if;
  update comisionistas set porcentaje_forzado = p_porcentaje where persona_id = p_persona;
  if not found then
    raise exception 'No existe ese comisionista';
  end if;
end;
$$;

-- Bono, ajuste o cargo a mano. Cae en el primer mes abierto y exige empresa.
create or replace function agregar_movimiento(
  p_comisionista uuid, p_tipo text, p_monto numeric, p_cuenta uuid, p_servicio uuid, p_nota text
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  if not soy_super_admin() then
    raise exception 'Solo super_admin agrega bonos, ajustes o cargos';
  end if;
  if p_tipo not in ('bono', 'ajuste', 'cargo') then
    raise exception 'Tipo de movimiento no válido';
  end if;
  if p_cuenta is null then
    raise exception 'Elige la empresa (cuenta receptora) a la que se asigna el movimiento';
  end if;
  if nullif(trim(p_nota), '') is null then
    raise exception 'Escribe el concepto';
  end if;
  insert into comisiones (comisionista_id, tipo, monto, mes, cuenta_receptora_id, servicio_id, nota, creada_por)
  values (p_comisionista, p_tipo,
          case when p_tipo = 'cargo' then -abs(p_monto) when p_tipo = 'bono' then abs(p_monto) else p_monto end,
          mes_abierto_desde(hoy_mx()), p_cuenta, p_servicio, trim(p_nota), mi_persona_id())
  returning id into v_id;
  return v_id;
end;
$$;

-- ------------------------------------------------------------
-- 9. STORAGE: facturas de los comisionistas
-- ------------------------------------------------------------
--   facturas/{persona_id}/{uuid}.{pdf|xml|jpg}
-- Cada quien sube a su carpeta; la lee su dueño y el staff.

insert into storage.buckets (id, name, public)
values ('facturas', 'facturas', false)
on conflict (id) do nothing;

create policy facturas_subir on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'facturas'
    and (storage.foldername(name))[1] = public.mi_persona_id()::text
  );

create policy facturas_leer on storage.objects
  for select to authenticated
  using (
    bucket_id = 'facturas'
    and ((storage.foldername(name))[1] = public.mi_persona_id()::text or public.soy_staff())
  );

-- ------------------------------------------------------------
-- 10. RLS Y PERMISOS
-- ------------------------------------------------------------

alter table origenes_pago               enable row level security;
alter table pendientes_comision         enable row level security;
alter table pagos_comision              enable row level security;
alter table aplicaciones_pago_comision  enable row level security;

revoke all on origenes_pago, pendientes_comision, pagos_comision, aplicaciones_pago_comision from anon;

create policy staff_lee_origenes on origenes_pago for select using (soy_staff());
create policy admin_origenes on origenes_pago for all
  using (soy_super_admin()) with check (soy_super_admin());
grant select, insert, update on origenes_pago to authenticated;

-- Pendientes: cada quien los suyos, el staff todos. Nadie escribe
-- directo: nacen al aprobar y se mueven por las funciones.
create policy leer_pendientes on pendientes_comision for select
  using (comisionista_id = mi_persona_id() or soy_staff());
grant select on pendientes_comision to authenticated;

-- Pagos de comisión y sus aplicaciones: solo el staff (ahí está el origen).
create policy staff_lee_pagos_comision on pagos_comision for select using (soy_staff());
create policy staff_lee_aplicaciones on aplicaciones_pago_comision for select using (soy_staff());
grant select on pagos_comision, aplicaciones_pago_comision to authenticated;

revoke all on function
  asignar_comision(), vence_pago_comision(date), ejecutar_pago_comision(uuid, uuid, date, uuid, text, text, text, text, jsonb),
  registrar_pago_comision(uuid, date, uuid, text, text, text, text, jsonb), mis_pagos_comision(),
  subir_factura_comision(uuid, text), comisiones_por_pagar(), nivel_vigente(uuid, date), resumen_comisionistas(),
  alta_comisionista(text, text, text, text, text, uuid, boolean),
  actualizar_comisionista(uuid, text, text, text, boolean), cambiar_activo_comisionista(uuid, boolean),
  forzar_elite(uuid, numeric), agregar_movimiento(uuid, text, numeric, uuid, uuid, text)
  from public, anon, authenticated;

grant execute on function
  vence_pago_comision(date), registrar_pago_comision(uuid, date, uuid, text, text, text, text, jsonb),
  mis_pagos_comision(), subir_factura_comision(uuid, text), comisiones_por_pagar(),
  nivel_vigente(uuid, date), resumen_comisionistas(),
  alta_comisionista(text, text, text, text, text, uuid, boolean),
  actualizar_comisionista(uuid, text, text, text, boolean), cambiar_activo_comisionista(uuid, boolean),
  forzar_elite(uuid, numeric), agregar_movimiento(uuid, text, numeric, uuid, uuid, text)
  to authenticated;
