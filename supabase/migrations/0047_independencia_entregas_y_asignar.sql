-- ============================================================
-- 0047 — NOTA DE INDEPENDENCIA, PAGOS POR ENTREGAR Y ASIGNAR TRÁMITES
--
-- 1. NOTA DE INDEPENDENCIA. Tres textos en Ajustes (tarjeta, liga de
--    cliente y pie del PDF), editables por admin_org, con versión y
--    bitácora. `{nombre}` es el nombre para mostrar del comisionista.
--    Solo se muestran cuando el dueño de la liga es comisionista: las
--    ligas del equipo y de admin_org son del despacho.
--
-- 2. PAGOS POR ENTREGAR. Al reportar, el comisionista dice si el
--    cliente pagó a la cuenta o si lo recibió él. Si lo recibió él,
--    debe entregarlo en 2 días hábiles (sin fines de semana ni feriados
--    de la LFT); vencido, alerta para admin y finanzas. Marca "Ya lo
--    entregué" con el comprobante del depósito y se confirma como
--    siempre. El trabajo se paga con la fecha en que el dinero llegó a
--    la cuenta, no con la del cobro al cliente.
--
-- 3. ASIGNAR O CAMBIAR COMISIONISTA (admin_org; finanzas si Ajustes lo
--    permite), con motivo. La comisión se mueve: al anterior se le
--    quita (borrada si su mes sigue abierto; cargo en el siguiente
--    cierre si ya cerró) y al nuevo se le devenga (ajuste en el
--    siguiente cierre si el mes ya cerró).
--
-- 4. "NO GENERA COMISIÓN" por trámite, con motivo: tampoco genera bono
--    de referido ni cuenta para nivel (como un convenio sin comisión).
--
-- 5. TRAER TRÁMITE DE NOTION. El trámite se crea en Tasa ligado a la
--    página que ya existe (no crea otra) y con el folio de esa página.
-- ============================================================

-- ------------------------------------------------------------
-- 1. NOTA DE INDEPENDENCIA
-- ------------------------------------------------------------

alter table ajustes
  add column nota_tarjeta text not null default
    'Los servicios de valuación los presta un despacho independiente. {nombre} es asesor afiliado y no realiza los avalúos.'
    check (char_length(nota_tarjeta) between 1 and 600),
  add column nota_liga text not null default
    'Tu solicitud se envía a un despacho de valuación independiente, que es quien cotiza, realiza el trabajo y emite los documentos. '
    || '{nombre} es un asesor afiliado: promueve el servicio mediante una alianza comercial, pero no forma parte del despacho ni es '
    || 'responsable del avalúo. La cotización indicará la empresa que realizará el trabajo y la cuenta a la que se paga. '
    || 'El asesor puede recibir una comisión por recomendar el servicio.'
    check (char_length(nota_liga) between 1 and 2000),
  add column nota_pdf text not null default
    'Servicio recomendado por {nombre}, asesor afiliado independiente.'
    check (char_length(nota_pdf) between 1 and 160),
  add column nota_version integer not null default 1,
  add column nota_actualizada_en timestamptz,
  -- Finanzas también asigna comisionistas y trae trámites de Notion (lo decide admin_org).
  add column finanzas_asigna boolean not null default false;

-- Cada cambio de cualquiera de los tres textos es una versión nueva.
create or replace function versionar_nota()
returns trigger language plpgsql as $$
begin
  if (new.nota_tarjeta, new.nota_liga, new.nota_pdf) is distinct from (old.nota_tarjeta, old.nota_liga, old.nota_pdf) then
    new.nota_version := old.nota_version + 1;
    new.nota_actualizada_en := now();
  end if;
  return new;
end;
$$;
create trigger al_cambiar_nota before update on ajustes
  for each row execute function versionar_nota();

create or replace function con_nombre(p_texto text, p_nombre text)
returns text language sql immutable as $$
  select replace(p_texto, '{nombre}', coalesce(p_nombre, ''));
$$;

-- La versión de la nota que vio el cliente al pedir por la liga de un comisionista.
alter table solicitudes add column nota_version integer;

create or replace function anotar_version_nota()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.origen = 'liga_cliente' and new.comisionista_id is not null then
    new.nota_version := (select nota_version from ajustes where organizacion_id = new.organizacion_id);
  end if;
  return new;
end;
$$;
create trigger al_pedir_con_nota before insert on solicitudes
  for each row execute function anotar_version_nota();

-- La liga pública: ahora también trae la nota (solo si el dueño es un comisionista activo).
create or replace function datos_liga_cliente(p_org text, p_codigo text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  o       organizaciones%rowtype;
  d       record;
  v_con   text;
begin
  select * into o from organizaciones where slug = lower(trim(p_org)) and activa;
  if not found or coalesce(trim(p_codigo), '') = '' then
    return null;
  end if;
  select * into d from dueno_de_liga(o.id, p_codigo);
  if d.persona_id is null then
    return null;
  end if;
  v_con := case when d.activo then (select nombre_visible(p) from personas p where p.id = d.persona_id) else o.nombre end;
  return jsonb_build_object(
    'organizacion', o.nombre,
    'con', v_con,
    'aviso_version', (select aviso_version from ajustes where organizacion_id = o.id),
    'nota', case when d.es_comisionista and d.activo
                 then (select con_nombre(a.nota_liga, v_con) from ajustes a where a.organizacion_id = o.id) end,
    'servicios', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'nombre', s.nombre) order by s.nombre)
                             from servicios s where s.organizacion_id = o.id and s.activo), '[]'::jsonb));
end;
$$;

-- La tarjeta pública: la nota corta va debajo del botón de solicitar.
create or replace function datos_tarjeta(p_org text, p_clave text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  o       organizaciones%rowtype;
  c       comisionistas%rowtype;
  t       tarjetas%rowtype;
  p       personas%rowtype;
  v_nivel integer;
begin
  select * into o from organizaciones where slug = lower(trim(p_org)) and activa;
  if not found then
    return null;
  end if;
  select * into c from comisionistas
   where organizacion_id = o.id and (slug = lower(trim(p_clave)) or codigo_referido = upper(trim(p_clave)));
  if not found then
    return null;
  end if;
  select * into t from tarjetas where organizacion_id = o.id and comisionista_id = c.persona_id;
  select * into p from personas where id = c.persona_id;
  if t.comisionista_id is null or t.estado <> 'publicada' or not p.activo
     or not exists (select 1 from membresias m where m.organizacion_id = o.id and m.persona_id = c.persona_id and m.activa) then
    return jsonb_build_object('disponible', false, 'organizacion', o.nombre);
  end if;
  v_nivel := nivel_tarjeta(o.id, c.persona_id);
  return jsonb_build_object(
    'disponible', true,
    'organizacion', o.nombre,
    'org', o.slug,
    'codigo', c.codigo_referido,
    'slug', c.slug,
    'nivel', v_nivel,
    'nombre', nombre_visible(p),
    'frase', t.frase,
    'telefono', t.telefono,
    'correo', case when t.mostrar_correo then t.correo end,
    'zona', t.zona,
    'foto', t.foto_ruta,
    'logo', case when v_nivel >= 2 then t.logo_ruta end,
    'color', case when v_nivel >= 2 then t.color end,
    'nota', (select con_nombre(a.nota_tarjeta, nombre_visible(p)) from ajustes a where a.organizacion_id = o.id),
    'servicios', case when v_nivel >= 4 then
       (select coalesce(jsonb_agg(s.nombre order by s.orden, s.nombre), '[]') from servicios s
         where s.organizacion_id = o.id and s.activo and s.id = any (t.servicios)) else '[]'::jsonb end,
    'testimonios', case when v_nivel >= 4 then
       (select coalesce(jsonb_agg(jsonb_build_object('cliente', x.cliente, 'texto', x.texto) order by x.decidido_en desc), '[]')
          from (select * from testimonios where organizacion_id = o.id and comisionista_id = c.persona_id and estado = 'aprobado'
                 order by decidido_en desc limit 6) x) else '[]'::jsonb end);
end;
$$;

-- Las notas ya armadas de un trabajo: la larga (correo al cliente) y el pie del PDF. Nulas si el
-- trabajo no llegó por un comisionista. La pide el staff (PDF) o el servidor (correo de la liga).
create or replace function notas_de_solicitud(p_solicitud uuid)
returns table (liga text, pdf text)
language sql stable security definer set search_path = public as $$
  select con_nombre(a.nota_liga, nombre_visible(p)), con_nombre(a.nota_pdf, nombre_visible(p))
    from solicitudes s
    join personas p on p.id = s.comisionista_id
    join ajustes a on a.organizacion_id = s.organizacion_id
   where s.id = p_solicitud
     and (auth.uid() is null or (s.organizacion_id = mi_org() and soy_staff()));
$$;

-- ------------------------------------------------------------
-- 2. DÍAS HÁBILES (sin fines de semana ni descansos obligatorios de la LFT, art. 74)
-- ------------------------------------------------------------

create or replace function es_dia_inhabil(p_dia date)
returns boolean language sql immutable as $$
  select extract(isodow from p_dia) in (6, 7)
      or to_char(p_dia, 'MM-DD') in ('01-01', '05-01', '09-16', '12-25')
      -- Primer lunes de febrero, tercer lunes de marzo y tercer lunes de noviembre.
      or (extract(isodow from p_dia) = 1 and (
            (extract(month from p_dia) = 2 and extract(day from p_dia) <= 7)
         or (extract(month from p_dia) in (3, 11) and extract(day from p_dia) between 15 and 21)))
      -- 1 de octubre cada seis años (transmisión del Poder Ejecutivo: 2024, 2030…).
      or (to_char(p_dia, 'MM-DD') = '10-01' and extract(year from p_dia) >= 2024
          and (extract(year from p_dia)::integer - 2024) % 6 = 0);
$$;

create or replace function sumar_dias_habiles(p_desde date, p_dias integer)
returns date language plpgsql immutable as $$
declare
  v_dia   date := p_desde;
  v_resta integer := p_dias;
begin
  while v_resta > 0 loop
    v_dia := v_dia + 1;
    if not es_dia_inhabil(v_dia) then
      v_resta := v_resta - 1;
    end if;
  end loop;
  return v_dia;
end;
$$;

-- ------------------------------------------------------------
-- 3. PAGOS POR ENTREGAR
-- ------------------------------------------------------------

alter table pagos
  -- El cliente le pagó al comisionista (efectivo o transferencia a su cuenta), no a la cuenta indicada.
  add column recibio_asesor  boolean not null default false,
  add column entregar_antes  date,
  -- "Ya lo entregué": cuándo y con qué comprobante del depósito a la cuenta.
  add column entregado_en    timestamptz,
  add column entrega_ruta    text,
  -- El día en que el dinero llegó a la cuenta (lo fija la confirmación). Define el mes.
  add column fecha_en_cuenta date,
  add constraint pagos_entrega_con_plazo check (not recibio_asesor or entregar_antes is not null),
  add constraint pagos_entrega_solo_asesor check (recibio_asesor or (entregado_en is null and entrega_ruta is null));

create index pagos_por_entregar on pagos (entregar_antes)
  where recibio_asesor and estado = 'reportado' and entregado_en is null;

create or replace function reglas_pago()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  s            solicitudes%rowtype;
  v_confirmado numeric;
  v_libres     text[] := array['estado', 'motivo_rechazo', 'motivo_retiro', 'revisado_por', 'revisado_en',
                               'entregado_en', 'entrega_ruta', 'fecha_en_cuenta'];
begin
  if tg_op = 'INSERT' then
    if new.estado <> 'reportado' then
      raise exception 'Todo pago entra como reportado';
    end if;
    select * into s from solicitudes where id = new.solicitud_id;
    if s.estado <> 'tramite' then
      raise exception 'Solo se registran pagos de trámites (este está en "%")', s.estado;
    end if;
    if s.pagado_en is not null then
      raise exception 'Este trabajo ya está pagado al 100%%';
    end if;
    if new.recibio_asesor then
      if new.via not in ('comprobante', 'efectivo') then
        raise exception 'Si tú recibiste el pago, sube el comprobante de la transferencia o dilo como efectivo';
      end if;
      new.entregar_antes := sumar_dias_habiles(new.fecha_pago, 2);
    else
      new.entregar_antes := null;
    end if;
    new.entregado_en := null;
    new.entrega_ruta := null;
    new.fecha_en_cuenta := null;
    new.reportado_en := now();
    return new;
  end if;

  if (to_jsonb(new) - v_libres) is distinct from (to_jsonb(old) - v_libres) then
    raise exception 'Un pago reportado no se edita: recházalo con motivo y que se reporte de nuevo';
  end if;
  if old.entregado_en is not null
     and (new.entregado_en is distinct from old.entregado_en or new.entrega_ruta is distinct from old.entrega_ruta) then
    raise exception 'La entrega de este pago ya estaba registrada';
  end if;

  if new.estado is distinct from old.estado then
    if old.estado in ('confirmado', 'rechazado') and new.estado = 'reportado'
       and current_setting('tasa.revertir', true) = 'on' then
      new.revisado_en := null;
      new.revisado_por := null;
      new.motivo_rechazo := null;
      new.fecha_en_cuenta := null;
      return new;
    end if;
    if old.estado <> 'reportado' then
      raise exception 'Un pago % ya no cambia de estado', old.estado;
    end if;
    if new.estado = 'retirado' then
      return new;
    end if;
    new.revisado_en := now();
    new.revisado_por := coalesce(mi_persona_id(), new.revisado_por);

    if new.estado = 'confirmado' then
      -- Lo que cobró el comisionista cuenta desde que llegó a la cuenta.
      new.fecha_en_cuenta := case when new.recibio_asesor
        then least(coalesce((new.entregado_en at time zone 'America/Mexico_City')::date, hoy_mx()), hoy_mx()) end;
      select * into s from solicitudes where id = new.solicitud_id for update;
      select coalesce(sum(monto), 0) into v_confirmado
        from pagos where solicitud_id = new.solicitud_id and estado = 'confirmado';
      if v_confirmado + new.monto > s.monto_total then
        raise exception 'Con este pago lo confirmado (%) pasaría del total del trabajo (%)',
          v_confirmado + new.monto, s.monto_total;
      end if;
    end if;
  end if;

  return new;
end;
$$;

-- "Ya lo entregué": el comisionista que lo reportó (con comprobante del depósito) o el staff.
create or replace function marcar_pago_entregado(p_pago uuid, p_ruta text)
returns void language plpgsql security definer set search_path = public as $$
declare
  p pagos%rowtype;
begin
  select * into p from pagos where id = p_pago and organizacion_id = mi_org() for update;
  if not found then
    raise exception 'No existe ese pago';
  end if;
  if p.reportado_por is distinct from mi_persona_id() and not soy_staff() then
    raise exception 'Ese pago no es tuyo';
  end if;
  if not p.recibio_asesor or p.estado <> 'reportado' then
    raise exception 'Este pago no está por entregar';
  end if;
  if p.entregado_en is not null then
    raise exception 'Ya lo habías marcado como entregado';
  end if;
  if nullif(trim(coalesce(p_ruta, '')), '') is null and not soy_staff() then
    raise exception 'Sube el comprobante del depósito a la cuenta';
  end if;
  if p_ruta is not null and p_ruta not like p.organizacion_id || '/' || mi_persona_id() || '/%' then
    raise exception 'Ese comprobante no es tuyo';
  end if;
  update pagos set entregado_en = now(), entrega_ruta = nullif(trim(coalesce(p_ruta, '')), '') where id = p.id;
end;
$$;

-- Al entregar, confirmar, rechazar o retirar, la alerta del trabajo se resuelve si ya no queda nada vencido.
create or replace function resolver_alerta_entrega()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from pagos x
                  where x.solicitud_id = new.solicitud_id and x.recibio_asesor and x.estado = 'reportado'
                    and x.entregado_en is null and x.entregar_antes < hoy_mx()) then
    update alertas set resuelta_en = now(),
                       resolucion = case when new.estado = 'reportado' then 'El comisionista marcó el pago como entregado'
                                         else 'El pago se revisó (' || new.estado || ')' end
     where solicitud_id = new.solicitud_id and tipo = 'pago_por_entregar' and resuelta_en is null;
  end if;
  return null;
end;
$$;
create trigger al_entregar_pago after update of estado, entregado_en on pagos
  for each row when (new.recibio_asesor) execute function resolver_alerta_entrega();

alter table alertas drop constraint alertas_tipo_check;
alter table alertas drop constraint alertas_tipo_completo;
alter table alertas
  add constraint alertas_tipo_check check (tipo in ('cancelado_externo', 'externo_borrado', 'liga_inactiva', 'conector',
                                                    'estimado_sin_final', 'liga_limite', 'pago_por_entregar')),
  add constraint alertas_tipo_completo check (
    (tipo in ('cancelado_externo', 'externo_borrado', 'liga_inactiva', 'estimado_sin_final', 'pago_por_entregar') and solicitud_id is not null)
    or (tipo = 'conector' and conector_id is not null and codigo is not null)
    or (tipo = 'liga_limite' and codigo is not null));

-- Desde el cron: una alerta por trabajo con un pago por entregar ya vencido. DEMO no alerta.
create or replace function alertar_entregas_vencidas()
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_total integer;
begin
  insert into alertas (organizacion_id, tipo, solicitud_id, mensaje)
  select distinct on (p.solicitud_id) p.organizacion_id, 'pago_por_entregar', p.solicitud_id,
         'Pago por entregar vencido: ' || coalesce(nombre_visible(pe), 'el comisionista') || ' recibió '
         || to_char(p.monto, 'FM$999,999,990.00') || ' del cliente el ' || to_char(p.fecha_pago, 'DD/MM/YYYY')
         || ' y debía entregarlo a la cuenta a más tardar el ' || to_char(p.entregar_antes, 'DD/MM/YYYY')
         || ' · ' || coalesce(s.folio || ' · ', '') || s.cliente_nombre
    from pagos p
    join solicitudes s on s.id = p.solicitud_id
    left join personas pe on pe.id = p.reportado_por
   where p.recibio_asesor and p.estado = 'reportado' and p.entregado_en is null and p.entregar_antes < hoy_mx()
     and p.organizacion_id not in (select id from organizaciones where demo)
   order by p.solicitud_id, p.entregar_antes
  on conflict (solicitud_id, tipo) where resuelta_en is null do nothing;
  get diagnostics v_total = row_count;
  return v_total;
end;
$$;

-- El trabajo se paga con la fecha en que el dinero llegó a la cuenta (no con la del cobro al cliente).
create or replace function liquidar_si_completo(p_solicitud uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  s          solicitudes%rowtype;
  p          record;
  v_suma     numeric := 0;
  v_fecha    date;
begin
  select * into s from solicitudes where id = p_solicitud for update;
  if s.pagado_en is not null or coalesce(s.monto_total, 0) <= 0 then
    return;
  end if;

  for p in
    select monto, coalesce(fecha_en_cuenta, fecha_pago) as fecha from pagos
     where solicitud_id = p_solicitud and estado = 'confirmado'
     order by coalesce(fecha_en_cuenta, fecha_pago), revisado_en, id
  loop
    v_suma := v_suma + p.monto;
    if v_suma >= s.monto_total then
      v_fecha := p.fecha;
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

  update solicitudes
     set pagado_en = v_fecha, mes_cierre = mes_abierto_desde(s.organizacion_id, v_fecha), estatus_publico = 'pagado'
   where id = p_solicitud;

  perform devengar_comision(p_solicitud, false, null);
end;
$$;

-- ------------------------------------------------------------
-- 4. LA COMISIÓN DE UN TRABAJO: DEVENGAR Y QUITAR
-- ------------------------------------------------------------

-- Una comisión que ya se anuló con un cargo (anula_id) no cuenta para el tope: el cargo la deja en cero.
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

  select coalesce(sum(c.monto), 0) into v_suma
    from comisiones c
   where c.solicitud_id = new.solicitud_id
     and c.tipo <> 'cargo'
     and c.id <> new.id
     and not exists (select 1 from comisiones x where x.anula_id = c.id);

  if v_suma + new.monto > round(coalesce(v_honorarios, 0) * 0.30, 2) then
    raise exception 'Tope de 30%% rebasado: este trabajo admite % y sumaría %',
      round(coalesce(v_honorarios, 0) * 0.30, 2), v_suma + new.monto
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

-- La comisión de un trabajo pagado para su comisionista de hoy. Al liquidar es la comisión normal
-- (en su mes o el siguiente abierto). Después de asignar o reactivar (p_tarde) entra como ajuste
-- si el mes del pago ya cerró. No hace nada si no corresponde o si ya tiene una viva.
create or replace function devengar_comision(p_solicitud uuid, p_tarde boolean, p_nota text)
returns void language plpgsql security definer set search_path = public as $$
declare
  s       solicitudes%rowtype;
  v_mes   date;
  v_pct   numeric;
  v_tipo  text := 'comision';
begin
  select * into s from solicitudes where id = p_solicitud;
  if s.pagado_en is null or coalesce(s.monto_honorarios, 0) <= 0 or s.comisionista_id is null
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
  values (s.organizacion_id, s.comisionista_id, s.id, v_tipo, s.monto_honorarios, v_pct,
          v_tipo = 'comision' and s.comision_regla <> 'fija'
            and porcentaje_es_provisional(s.organizacion_id, s.comisionista_id, v_mes),
          round(s.monto_honorarios * v_pct / 100, 2), v_mes,
          coalesce(p_nota,
            case when s.comision_regla = 'fija' then 'Devengada al quedar pagado el trabajo (% fijo del convenio)'
                 else 'Devengada al quedar pagado el trabajo' end),
          case when p_tarde then mi_persona_id() end);
end;
$$;

-- Le quita a un comisionista la comisión viva de un trabajo: se borra si su mes sigue abierto;
-- si ya cerró, entra un cargo que la anula en el siguiente cierre.
create or replace function quitar_comision(p_solicitud uuid, p_comisionista uuid, p_nota text)
returns void language plpgsql security definer set search_path = public as $$
declare
  s solicitudes%rowtype;
  c record;
begin
  select * into s from solicitudes where id = p_solicitud;
  for c in
    select * from comisiones x
     where x.solicitud_id = p_solicitud and x.comisionista_id = p_comisionista and x.tipo in ('comision', 'ajuste')
       and x.anula_id is null and not exists (select 1 from comisiones y where y.anula_id = x.id)
  loop
    if mes_aprobado(s.organizacion_id, c.mes) then
      insert into comisiones (organizacion_id, comisionista_id, solicitud_id, tipo, monto, mes, nota, creada_por, anula_id)
      values (s.organizacion_id, c.comisionista_id, p_solicitud, 'cargo', -c.monto,
              mes_abierto_desde(s.organizacion_id, hoy_mx()),
              p_nota || ' (comisión de ' || to_char(c.mes, 'YYYY-MM') || ')', mi_persona_id(), c.id);
    else
      delete from comisiones where id = c.id;
    end if;
  end loop;
end;
$$;

-- ------------------------------------------------------------
-- 5. ASIGNAR O CAMBIAR COMISIONISTA Y "GENERA COMISIÓN"
-- ------------------------------------------------------------

alter table eventos_trabajo drop constraint eventos_trabajo_accion_check;
alter table eventos_trabajo add constraint eventos_trabajo_accion_check check (accion in (
  'revertir_confirmacion', 'revertir_rechazo', 'retirar_pago', 'anular_cotizacion', 'cancelar',
  'asignar_comisionista', 'sin_comision', 'con_comision', 'importar'));

alter table solicitudes
  add column sin_comision_motivo text check (char_length(sin_comision_motivo) <= 300),
  -- La regla que tenía antes de "No genera comisión", para regresarla.
  add column comision_regla_antes text check (comision_regla_antes in ('normal', 'fija')),
  add column comision_pct_antes numeric(5,2);

alter table solicitudes drop constraint solicitudes_origen_check;
alter table solicitudes add constraint solicitudes_origen_check
  check (origen in ('portal', 'tarjeta', 'referido', 'admin', 'liga_cliente', 'importado'));

create or replace function puedo_asignar()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(soy_admin_org(), false)
      or (mi_rol() = 'finanzas'
          and coalesce((select finanzas_asigna from ajustes where organizacion_id = mi_org()), false));
$$;

create or replace function asignar_comisionista(p_solicitud uuid, p_comisionista uuid, p_motivo text)
returns void language plpgsql security definer set search_path = public as $$
declare
  s        solicitudes%rowtype;
  v_antes  text;
  v_nuevo  text;
begin
  if not puedo_asignar() then
    raise exception 'Solo admin_org (o finanzas, si Ajustes lo permite) asigna comisionistas';
  end if;
  if nullif(trim(coalesce(p_motivo, '')), '') is null then
    raise exception 'Hace falta el motivo';
  end if;
  select * into s from solicitudes where id = p_solicitud and organizacion_id = mi_org() for update;
  if not found then
    raise exception 'No existe ese trabajo';
  end if;
  if s.estado = 'cancelada' then
    raise exception 'El trabajo está cancelado';
  end if;
  if s.comisionista_id is not distinct from p_comisionista then
    raise exception 'Ese comisionista ya es el del trabajo';
  end if;
  select nombre_visible(p) into v_nuevo
    from comisionistas c
    join membresias m on m.persona_id = c.persona_id and m.organizacion_id = c.organizacion_id
                     and m.rol = 'comisionista' and m.activa
    join personas p on p.id = c.persona_id and p.activo
   where c.organizacion_id = s.organizacion_id and c.persona_id = p_comisionista;
  if v_nuevo is null then
    raise exception 'Elige un comisionista activo de esta organización';
  end if;
  select nombre_visible(p) into v_antes from personas p where p.id = s.comisionista_id;

  perform set_config('tasa.motivo', trim(p_motivo), true);
  if s.comisionista_id is not null then
    perform quitar_comision(s.id, s.comisionista_id, 'Trabajo reasignado a ' || v_nuevo || ': ' || trim(p_motivo));
  end if;
  update solicitudes set comisionista_id = p_comisionista, liga_sin_dueno = false where id = s.id;
  perform devengar_comision(s.id, true, 'Trabajo asignado' || coalesce(' (antes de ' || v_antes || ')', '') || ': ' || trim(p_motivo));

  insert into eventos_trabajo (organizacion_id, solicitud_id, accion, motivo, detalle, persona_id)
  values (s.organizacion_id, s.id, 'asignar_comisionista', trim(p_motivo),
          coalesce(v_antes, 'Sin comisionista') || ' → ' || v_nuevo, mi_persona_id());
  -- Una liga de alguien inactivo ya tiene dueño.
  update alertas set resuelta_en = now(), resuelta_por = mi_persona_id(), resolucion = 'Asignado a ' || v_nuevo
   where solicitud_id = s.id and tipo = 'liga_inactiva' and resuelta_en is null;
  perform set_config('tasa.motivo', '', true);
end;
$$;

create or replace function marcar_genera_comision(p_solicitud uuid, p_genera boolean, p_motivo text)
returns void language plpgsql security definer set search_path = public as $$
declare
  s solicitudes%rowtype;
begin
  if not puedo_asignar() then
    raise exception 'Solo admin_org (o finanzas, si Ajustes lo permite) decide si un trabajo genera comisión';
  end if;
  if nullif(trim(coalesce(p_motivo, '')), '') is null then
    raise exception 'Hace falta el motivo';
  end if;
  select * into s from solicitudes where id = p_solicitud and organizacion_id = mi_org() for update;
  if not found then
    raise exception 'No existe ese trabajo';
  end if;
  perform set_config('tasa.motivo', trim(p_motivo), true);

  if not p_genera then
    if s.comision_regla = 'ninguna' then
      raise exception 'Este trabajo ya no genera comisión';
    end if;
    update solicitudes
       set comision_regla_antes = s.comision_regla, comision_pct_antes = s.comision_pct,
           comision_regla = 'ninguna', comision_pct = null, sin_comision_motivo = trim(p_motivo)
     where id = s.id;
    if s.comisionista_id is not null then
      perform quitar_comision(s.id, s.comisionista_id, 'No genera comisión: ' || trim(p_motivo));
    end if;
  else
    if s.sin_comision_motivo is null then
      raise exception 'Este trabajo no se marcó como "No genera comisión" (si viene de un convenio, se cambia en el convenio)';
    end if;
    update solicitudes
       set comision_regla = coalesce(s.comision_regla_antes, 'normal'),
           comision_pct = case when s.comision_regla_antes = 'fija' then s.comision_pct_antes end,
           comision_regla_antes = null, comision_pct_antes = null, sin_comision_motivo = null
     where id = s.id;
    perform devengar_comision(s.id, true, 'Vuelve a generar comisión: ' || trim(p_motivo));
  end if;

  insert into eventos_trabajo (organizacion_id, solicitud_id, accion, motivo, persona_id)
  values (s.organizacion_id, s.id, case when p_genera then 'con_comision' else 'sin_comision' end, trim(p_motivo), mi_persona_id());
  perform set_config('tasa.motivo', '', true);
end;
$$;

-- ------------------------------------------------------------
-- 6. TRAER TRÁMITE DE NOTION
-- ------------------------------------------------------------

-- El conector Notion activo de la organización, para leer una página al momento. Solo el servidor.
create or replace function conector_para_importar(p_org uuid)
returns table (id uuid, configuracion jsonb, mapeo_campos jsonb, prefijo_folio text)
language sql stable security definer set search_path = public as $$
  select k.id, k.configuracion, k.mapeo_campos, o.prefijo_folio
    from conectores k join organizaciones o on o.id = k.organizacion_id
   where k.organizacion_id = p_org and k.activo and k.tipo = 'notion' and not o.demo;
$$;

-- ¿Hay trámites traídos de Notion vivos? Sus páginas no son del medio de Tasa y se leen aparte.
create or replace function tiene_importados(p_conector uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from solicitudes s join conectores k on k.organizacion_id = s.organizacion_id
                  where k.id = p_conector and s.origen = 'importado' and s.estado = 'tramite'
                    and s.externo_id is not null and s.externo_baja_en is null);
$$;

-- p_datos: {folio, externo_id, etapa, comisionista, servicio, marca, cuenta, cliente_nombre, cliente_telefono,
--           cliente_correo, direccion, municipio, clave, descripcion, requiere_factura, honorarios, terceros,
--           aceptada (AAAA-MM-DD), motivo, genera_comision, sin_comision_motivo}
-- En DEMO (sin Notion) la pantalla simula la lectura y manda un externo_id "demo-…".
create or replace function importar_tramite(p_datos jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  o          organizaciones%rowtype;
  v_folio    text := upper(trim(coalesce(p_datos->>'folio', '')));
  v_externo  text := nullif(trim(coalesce(p_datos->>'externo_id', '')), '');
  v_motivo   text := nullif(trim(coalesce(p_datos->>'motivo', '')), '');
  v_genera   boolean := coalesce((p_datos->>'genera_comision')::boolean, true);
  v_estatus  text;
  v_id       uuid;
  v_existe   text;
begin
  if not puedo_asignar() then
    raise exception 'Solo admin_org (o finanzas, si Ajustes lo permite) trae trámites de Notion';
  end if;
  select * into o from organizaciones where id = mi_org();
  if v_motivo is null then
    raise exception 'Hace falta el motivo';
  end if;
  if v_folio !~ ('^' || o.prefijo_folio || '-[0-9]{4}-[0-9]{4}$') then
    raise exception 'El folio va así: %-AAAA-NNNN', o.prefijo_folio;
  end if;
  select coalesce(folio, cliente_nombre) into v_existe from solicitudes
   where organizacion_id = o.id and (folio = v_folio or externo_id = v_externo) limit 1;
  if v_existe is not null then
    raise exception 'El folio % ya está en Tasa', v_folio;
  end if;
  if v_externo is null then
    raise exception 'Falta la página de Notion';
  end if;
  if o.demo is distinct from true and v_externo like 'demo-%' then
    raise exception 'Falta la página de Notion';
  end if;
  if not v_genera and nullif(trim(coalesce(p_datos->>'sin_comision_motivo', '')), '') is null then
    raise exception 'Di por qué no genera comisión';
  end if;

  -- La etapa se traduce con el mapeo del conector; lo que decide Tasa (pagado, cancelada…) no se toma de afuera.
  select m.estatus_publico into v_estatus
    from mapeo_estatus m join conectores k on k.id = m.conector_id
   where k.organizacion_id = o.id and k.activo and m.valor_externo = p_datos->>'etapa';
  if v_estatus is null or v_estatus in ('solicitada', 'cotizada', 'vencida', 'pagado', 'cancelada') then
    v_estatus := 'aceptada';
  end if;

  perform set_config('tasa.motivo', 'Traído de Notion: ' || v_motivo, true);
  insert into solicitudes (organizacion_id, comisionista_id, tipo, origen, servicio_id, marca_id, cuenta_receptora_id,
                           cliente_nombre, cliente_telefono, cliente_correo,
                           inmueble_direccion, inmueble_municipio, inmueble_clave_catastral, inmueble_descripcion,
                           requiere_factura, monto_honorarios, monto_terceros, estado, estatus_publico, aceptada_en,
                           folio, externo_id, estatus_externo, externo_leido_en, creado_por)
  values (o.id, (p_datos->>'comisionista')::uuid, 'tramite_directo', 'importado', (p_datos->>'servicio')::uuid,
          (p_datos->>'marca')::uuid, (p_datos->>'cuenta')::uuid,
          trim(p_datos->>'cliente_nombre'), nullif(trim(coalesce(p_datos->>'cliente_telefono', '')), ''),
          nullif(trim(coalesce(p_datos->>'cliente_correo', '')), ''),
          trim(p_datos->>'direccion'), nullif(trim(coalesce(p_datos->>'municipio', '')), ''),
          nullif(trim(coalesce(p_datos->>'clave', '')), ''), nullif(trim(coalesce(p_datos->>'descripcion', '')), ''),
          coalesce((p_datos->>'requiere_factura')::boolean, false), (p_datos->>'honorarios')::numeric,
          coalesce((p_datos->>'terceros')::numeric, 0), 'tramite', v_estatus,
          coalesce((p_datos->>'aceptada')::date::timestamptz + interval '12 hours', now()),
          v_folio, v_externo, p_datos->>'etapa', now(), mi_persona_id())
  returning id into v_id;
  -- Después del insert: al insertar, la regla de convenio la deja en 'normal'.
  if not v_genera then
    update solicitudes
       set comision_regla_antes = 'normal', comision_regla = 'ninguna',
           sin_comision_motivo = trim(p_datos->>'sin_comision_motivo')
     where id = v_id;
  end if;

  insert into eventos_trabajo (organizacion_id, solicitud_id, accion, motivo, detalle, persona_id)
  values (o.id, v_id, 'importar', v_motivo, 'Traído de Notion con el folio ' || v_folio, mi_persona_id());
  perform set_config('tasa.motivo', '', true);
  return v_id;
end;
$$;

-- ------------------------------------------------------------
-- 7. PERMISOS
-- ------------------------------------------------------------

revoke all on function versionar_nota(), con_nombre(text, text), anotar_version_nota(), notas_de_solicitud(uuid),
  es_dia_inhabil(date), sumar_dias_habiles(date, integer), marcar_pago_entregado(uuid, text), resolver_alerta_entrega(),
  alertar_entregas_vencidas(), devengar_comision(uuid, boolean, text), quitar_comision(uuid, uuid, text),
  puedo_asignar(), asignar_comisionista(uuid, uuid, text), marcar_genera_comision(uuid, boolean, text),
  conector_para_importar(uuid), tiene_importados(uuid), importar_tramite(jsonb)
  from public, anon, authenticated;

-- sumar_dias_habiles: la pantalla de reportar pago muestra la fecha límite con la misma regla.
grant execute on function notas_de_solicitud(uuid), marcar_pago_entregado(uuid, text), puedo_asignar(), sumar_dias_habiles(date, integer),
  asignar_comisionista(uuid, uuid, text), marcar_genera_comision(uuid, boolean, text), importar_tramite(jsonb)
  to authenticated;
grant execute on function notas_de_solicitud(uuid), alertar_entregas_vencidas(), conector_para_importar(uuid),
  tiene_importados(uuid)
  to service_role;
-- datos_liga_cliente, datos_tarjeta, reglas_pago, liquidar_si_completo y validar_tope conservan sus permisos.
