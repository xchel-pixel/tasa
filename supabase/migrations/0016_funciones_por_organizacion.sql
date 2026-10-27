-- ============================================================
-- 0016 — MULTI-ORGANIZACIÓN: FUNCIONES
--
-- Toda regla que antes preguntaba "¿qué mes?" ahora pregunta "¿qué mes
-- de qué organización?". Cada organización cierra sus meses, tiene sus
-- niveles y su día límite. La misma persona puede ser comisionista en
-- dos organizaciones: toda consulta por comisionista lleva también la
-- organización.
--
-- Las funciones que reciben la organización (`p_org`) son internas; las
-- que llama la aplicación la toman de la sesión (`mi_org()`).
-- ============================================================

-- ------------------------------------------------------------
-- 1. QUIÉN SOY Y DÓNDE ESTOY
-- ------------------------------------------------------------

create or replace function mi_persona_id()
returns uuid language sql stable security definer set search_path = public as $$
  select id from personas where user_id = auth.uid() and activo;
$$;

create or replace function soy_super_plataforma()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select super_plataforma from personas where user_id = auth.uid() and activo), false);
$$;

-- La organización activa, solo si de verdad puede estar ahí: membresía
-- activa u operador de plataforma, y la organización encendida.
--
-- Sin usuario (semilla, editor SQL, cron con la llave de servicio) la
-- dice `tasa.org`. Desde la aplicación no se puede poner: PostgREST no
-- deja a nadie fijar variables de sesión, y con usuario ni se consulta.
create or replace function mi_org()
returns uuid language sql stable security definer set search_path = public as $$
  select case
    when auth.uid() is null then nullif(current_setting('tasa.org', true), '')::uuid
    else (select p.organizacion_activa
            from personas p
            join organizaciones o on o.id = p.organizacion_activa and o.activa
           where p.user_id = auth.uid() and p.activo
             and (p.super_plataforma
                  or exists (select 1 from membresias m
                              where m.persona_id = p.id and m.organizacion_id = p.organizacion_activa
                                and m.activa)))
  end;
$$;

-- El rol en la organización activa. super_plataforma sin membresía
-- ahí actúa como admin_org.
create or replace function mi_rol()
returns text language sql stable security definer set search_path = public as $$
  select coalesce(
    (select m.rol from membresias m
      where m.persona_id = mi_persona_id() and m.organizacion_id = mi_org() and m.activa),
    case when mi_org() is not null and soy_super_plataforma() then 'admin_org' end
  );
$$;

create or replace function soy_staff()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(mi_rol() in ('admin_org', 'finanzas'), false);
$$;

create or replace function soy_admin_org()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(mi_rol() = 'admin_org', false);
$$;

-- Hasta que 0017 rehaga las políticas que todavía la usan.
create or replace function soy_super_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select soy_admin_org();
$$;

-- Las marcas de un admin_marca (vacío para cualquier otro rol).
create or replace function mis_marcas()
returns uuid[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(mm.marca_id), '{}')
    from membresia_marcas mm
    join membresias m on m.id = mm.membresia_id
   where m.persona_id = mi_persona_id() and m.organizacion_id = mi_org()
     and m.activa and m.rol = 'admin_marca';
$$;

-- Cambiar de organización (el selector de la barra).
create or replace function elegir_organizacion(p_org uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not soy_super_plataforma() and not exists (
    select 1 from membresias m join organizaciones o on o.id = m.organizacion_id and o.activa
     where m.persona_id = mi_persona_id() and m.organizacion_id = p_org and m.activa
  ) then
    raise exception 'No perteneces a esa organización';
  end if;
  update personas set organizacion_activa = p_org where id = mi_persona_id();
end;
$$;

-- Lo nuevo nace en la organización activa de quien lo inserta. Lo que
-- crean el cron o las funciones internas lleva su organización explícita.
do $$
declare
  t text;
begin
  foreach t in array array[
    'marcas', 'cuentas_receptoras', 'servicios', 'niveles', 'comisionistas', 'solicitudes',
    'cotizaciones', 'mapeo_estatus', 'historial_estatus', 'cierres', 'niveles_mensuales',
    'comisiones', 'pagos', 'alertas', 'ajustes', 'origenes_pago', 'pendientes_comision',
    'pagos_comision', 'aplicaciones_pago_comision', 'membresia_marcas', 'conectores'
  ] loop
    execute format('alter table %I alter column organizacion_id set default mi_org()', t);
  end loop;
end;
$$;

-- ------------------------------------------------------------
-- 2. DISPARADORES
-- ------------------------------------------------------------

create or replace function registrar_bitacora()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_antes   jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  v_despues jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  v_fila    jsonb := coalesce(v_despues, v_antes);
begin
  if tg_op = 'UPDATE' and v_antes = v_despues then
    return null;
  end if;

  insert into bitacora (organizacion_id, persona_id, rol, accion, tabla, registro_id, antes, despues, motivo)
  values (
    coalesce((v_fila->>'organizacion_id')::uuid,
             case when tg_table_name = 'organizaciones' then (v_fila->>'id')::uuid end,
             mi_org()),
    mi_persona_id(),
    case when soy_super_plataforma() and mi_rol() = 'admin_org'
          and not exists (select 1 from membresias where persona_id = mi_persona_id() and organizacion_id = mi_org())
         then 'super_plataforma' else mi_rol() end,
    tg_op,
    tg_table_name,
    coalesce(v_fila->>'id', v_fila->>'persona_id', v_fila->>'valor_externo'),
    v_antes,
    v_despues,
    nullif(current_setting('tasa.motivo', true), '')
  );
  return null;
end;
$$;

-- Un perfil de comisionista exige la membresía de comisionista ahí.
create or replace function validar_comisionista()
returns trigger language plpgsql as $$
begin
  if not exists (
    select 1 from membresias
     where persona_id = new.persona_id and organizacion_id = new.organizacion_id and rol = 'comisionista'
  ) then
    raise exception 'La persona % no es comisionista en esta organización', new.persona_id;
  end if;
  return new;
end;
$$;

create or replace function anotar_historial()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' or new.estatus_publico is distinct from old.estatus_publico then
    insert into historial_estatus (organizacion_id, solicitud_id, estatus_publico)
    values (new.organizacion_id, new.id, new.estatus_publico);
  end if;
  return null;
end;
$$;

create or replace function reglas_solicitud()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_confirmados integer;
begin
  new.actualizado_en := now();

  if tg_op = 'UPDATE' then
    if new.organizacion_id is distinct from old.organizacion_id then
      raise exception 'Un trabajo no cambia de organización';
    end if;
    if old.estatus_publico in ('pagado', 'cancelada')
       and new.estatus_publico is distinct from old.estatus_publico
       and new.estado = old.estado
       and new.pagado_en is not distinct from old.pagado_en then
      new.estatus_publico := old.estatus_publico;
    end if;

    if old.pagado_en is not null and (
         new.monto_honorarios is distinct from old.monto_honorarios
      or new.monto_terceros   is distinct from old.monto_terceros
      or new.requiere_factura is distinct from old.requiere_factura
    ) then
      raise exception 'El trabajo ya está pagado: sus montos no se pueden cambiar';
    end if;

    if new.cuenta_receptora_id is distinct from old.cuenta_receptora_id then
      select count(*) into v_confirmados
        from pagos where solicitud_id = new.id and estado = 'confirmado';
      if v_confirmados > 0 and not soy_admin_org() and auth.uid() is not null then
        raise exception 'Este trabajo ya tiene pagos confirmados: solo admin_org puede cambiar la cuenta';
      end if;
    end if;
  end if;

  return new;
end;
$$;

-- Con conector manual, el folio lo pone Tasa al volverse trámite:
-- PREFIJO-AAAA-NNNN. Nunca repite uno que ya exista ese año.
create or replace function asignar_folio()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_tipo    text;
  v_prefijo text;
  v_anio    smallint := extract(year from hoy_mx());
  v_numero  integer;
begin
  if new.estado <> 'tramite' or new.folio is not null
     or (tg_op = 'UPDATE' and old.estado = 'tramite') then
    return new;
  end if;
  select tipo into v_tipo from conectores where organizacion_id = new.organizacion_id and activo;
  if coalesce(v_tipo, 'manual') <> 'manual' then
    return new;
  end if;

  select prefijo_folio into v_prefijo from organizaciones where id = new.organizacion_id;
  insert into folios_contador (organizacion_id, anio, ultimo)
  values (new.organizacion_id, v_anio,
          coalesce((select max(substring(folio from '[0-9]{4}$')::integer) from solicitudes
                     where organizacion_id = new.organizacion_id
                       and folio like v_prefijo || '-' || v_anio || '-%'), 0) + 1)
  on conflict (organizacion_id, anio) do update set ultimo = folios_contador.ultimo + 1
  returning ultimo into v_numero;

  new.folio := v_prefijo || '-' || v_anio || '-' || lpad(v_numero::text, 4, '0');
  return new;
end;
$$;

create trigger folio_manual
  before insert or update of estado on solicitudes
  for each row execute function asignar_folio();

-- Sin conector externo, admin_org o admin_marca (de esa marca) mueven
-- los estatus de en medio. "Pagado" y "Cancelada" siguen siendo de Tasa.
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
  update solicitudes set estatus_publico = p_estatus where id = s.id;
end;
$$;

-- ------------------------------------------------------------
-- 3. MESES, NIVELES Y PORCENTAJES (por organización)
-- ------------------------------------------------------------

drop function if exists mes_aprobado(date) cascade;
drop function if exists mes_abierto_desde(date) cascade;
drop function if exists mes_cerrado_para(date) cascade;
drop function if exists porcentaje_vigente(uuid, date) cascade;
drop function if exists porcentaje_es_provisional(uuid, date) cascade;
drop function if exists calcular_nivel(uuid, date) cascade;
drop function if exists recalcular_comisiones_del_mes(date) cascade;
drop function if exists nivel_vigente(uuid, date) cascade;
drop function if exists resumen_del_mes(date) cascade;
drop function if exists vence_pago_comision(date) cascade;
drop function if exists ejecutar_preparacion_cierre(date, uuid) cascade;
drop function if exists ejecutar_aprobacion_cierre(date, uuid) cascade;
drop function if exists ejecutar_pago_comision(uuid, uuid, date, uuid, text, text, text, text, jsonb) cascade;
drop function if exists registrar_lectura_notion(text, text, text, date) cascade;

create function mes_aprobado(p_org uuid, p_mes date)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from cierres
                  where organizacion_id = p_org and mes = mes_de(p_mes) and estado = 'aprobado');
$$;

create function mes_abierto_desde(p_org uuid, p_fecha date)
returns date language plpgsql stable security definer set search_path = public as $$
declare
  v_mes date := mes_de(p_fecha);
begin
  while mes_aprobado(p_org, v_mes) loop
    v_mes := (v_mes + interval '1 month')::date;
  end loop;
  return v_mes;
end;
$$;

create function mes_cerrado_para(p_org uuid, p_mes date)
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if mes_aprobado(p_org, p_mes) then
    raise exception 'Mes cerrado: corrige con un ajuste en el mes abierto';
  end if;
end;
$$;

create or replace function proteger_mes_cerrado()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if mes_aprobado(new.organizacion_id, new.mes) then
      raise exception 'El mes % ya está cerrado: va en %',
        to_char(new.mes, 'YYYY-MM'), to_char(mes_abierto_desde(new.organizacion_id, new.mes), 'YYYY-MM');
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    if mes_aprobado(old.organizacion_id, old.mes) then
      raise exception 'El mes % ya está cerrado: esto no se borra; registra un cargo',
        to_char(old.mes, 'YYYY-MM');
    end if;
    return old;
  end if;

  if mes_aprobado(old.organizacion_id, old.mes) then
    if (to_jsonb(new) - array['estado', 'pagada_en', 'cierre_id'])
       is distinct from (to_jsonb(old) - array['estado', 'pagada_en', 'cierre_id']) then
      raise exception 'El mes % ya está cerrado: solo se puede marcar como pagada',
        to_char(old.mes, 'YYYY-MM');
    end if;
    if old.cierre_id is not null and new.cierre_id is distinct from old.cierre_id then
      raise exception 'No se cambia el cierre de una comisión ya cerrada';
    end if;
  elsif mes_aprobado(new.organizacion_id, new.mes) then
    raise exception 'No se puede mover una comisión a un mes cerrado';
  end if;

  if new.estado = 'pagada' and not mes_aprobado(new.organizacion_id, new.mes) then
    raise exception 'Solo se marca pagado lo de un cierre aprobado';
  end if;

  return new;
end;
$$;

create function porcentaje_vigente(p_org uuid, p_comisionista uuid, p_mes date)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(
    (select porcentaje_forzado from comisionistas
      where organizacion_id = p_org and persona_id = p_comisionista),
    (select porcentaje from niveles_mensuales
      where organizacion_id = p_org and comisionista_id = p_comisionista and mes = mes_de(p_mes)),
    (select porcentaje from niveles_mensuales
      where organizacion_id = p_org and comisionista_id = p_comisionista and mes < mes_de(p_mes)
      order by mes desc limit 1),
    (select porcentaje from niveles where organizacion_id = p_org and not es_forzado order by orden limit 1)
  );
$$;

create function porcentaje_es_provisional(p_org uuid, p_comisionista uuid, p_mes date)
returns boolean language sql stable security definer set search_path = public as $$
  select not exists (
           select 1 from comisionistas
            where organizacion_id = p_org and persona_id = p_comisionista and porcentaje_forzado is not null)
     and not exists (
           select 1 from niveles_mensuales
            where organizacion_id = p_org and comisionista_id = p_comisionista and mes = mes_de(p_mes));
$$;

create function calcular_nivel(p_org uuid, p_comisionista uuid, p_mes date)
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
    from comisionistas where organizacion_id = p_org and persona_id = p_comisionista;

  v_desde := greatest((mes_de(p_mes) - interval '3 months')::date, v_alta);
  v_meses := case when v_desde > v_hasta then 0
                  else (extract(year from age(v_hasta, v_desde)) * 12
                        + extract(month from age(v_hasta, v_desde)))::integer + 1 end;

  select coalesce(sum(monto_honorarios), 0) into v_suma
    from solicitudes
   where organizacion_id = p_org and comisionista_id = p_comisionista
     and mes_cierre between v_desde and v_hasta;

  promedio := case when v_meses = 0 then 0 else round(v_suma / v_meses, 2) end;
  meses_considerados := v_meses;

  if v_forzado is not null then
    select n.id into nivel_id from niveles n
     where n.organizacion_id = p_org and n.es_forzado order by n.orden limit 1;
    porcentaje := v_forzado;
  else
    select n.id, n.porcentaje into nivel_id, porcentaje
      from niveles n
     where n.organizacion_id = p_org and not n.es_forzado and n.umbral_minimo <= promedio
     order by n.umbral_minimo desc
     limit 1;
  end if;

  return next;
end;
$$;

create function recalcular_comisiones_del_mes(p_org uuid, p_mes date)
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

create function nivel_vigente(p_org uuid, p_comisionista uuid, p_mes date)
returns text language sql stable security definer set search_path = public as $$
  select coalesce(
    (select n.nombre from comisionistas c, niveles n
      where c.organizacion_id = p_org and c.persona_id = p_comisionista and c.porcentaje_forzado is not null
        and n.organizacion_id = p_org and n.es_forzado
      order by n.orden limit 1),
    (select n.nombre from niveles_mensuales nm join niveles n on n.id = nm.nivel_id
      where nm.organizacion_id = p_org and nm.comisionista_id = p_comisionista and nm.mes <= mes_de(p_mes)
      order by nm.mes desc limit 1),
    (select nombre from niveles where organizacion_id = p_org and not es_forzado order by orden limit 1)
  );
$$;

create function vence_pago_comision(p_org uuid, p_mes date)
returns date language sql stable security definer set search_path = public as $$
  select (mes_de(p_mes) + interval '1 month')::date
         + ((select dia_limite_pago_comision from ajustes where organizacion_id = p_org) - 1);
$$;

-- ------------------------------------------------------------
-- 4. PAGOS, DEVENGO Y CANCELACIÓN
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

  v_mes := mes_abierto_desde(s.organizacion_id, v_fecha);

  update solicitudes
     set pagado_en = v_fecha, mes_cierre = v_mes, estatus_publico = 'pagado'
   where id = p_solicitud;

  if coalesce(s.monto_honorarios, 0) > 0 then
    v_pct := porcentaje_vigente(s.organizacion_id, s.comisionista_id, v_mes);
    insert into comisiones (organizacion_id, comisionista_id, solicitud_id, tipo, base, porcentaje,
                            provisional, monto, mes, nota)
    values (s.organizacion_id, s.comisionista_id, s.id, 'comision', s.monto_honorarios, v_pct,
            porcentaje_es_provisional(s.organizacion_id, s.comisionista_id, v_mes),
            round(s.monto_honorarios * v_pct / 100, 2), v_mes,
            'Devengada al quedar pagado el trabajo');
  end if;
end;
$$;

create or replace function cancelar_trabajo(p_solicitud uuid, p_motivo text)
returns void language plpgsql security definer set search_path = public as $$
declare
  s  solicitudes%rowtype;
  c  record;
begin
  select * into s from solicitudes where id = p_solicitud for update;
  if not found or (auth.uid() is not null and s.organizacion_id is distinct from mi_org()) then
    raise exception 'No existe ese trabajo';
  end if;
  if not soy_admin_org() and auth.uid() is not null then
    raise exception 'Solo admin_org cancela trabajos';
  end if;
  if nullif(trim(p_motivo), '') is null then
    raise exception 'Hace falta el motivo de la cancelación';
  end if;
  if s.estado = 'cancelada' then
    raise exception 'Ese trabajo ya estaba cancelado';
  end if;
  perform set_config('tasa.motivo', trim(p_motivo), true);

  for c in
    select * from comisiones
     where solicitud_id = p_solicitud and tipo <> 'cargo'
  loop
    if mes_aprobado(s.organizacion_id, c.mes) then
      insert into comisiones (organizacion_id, comisionista_id, solicitud_id, tipo, monto, mes, nota, creada_por)
      values (s.organizacion_id, c.comisionista_id, p_solicitud, 'cargo', -c.monto,
              mes_abierto_desde(s.organizacion_id, hoy_mx()),
              'Cancelación posterior al cierre de ' || to_char(c.mes, 'YYYY-MM') || ': ' || p_motivo,
              mi_persona_id());
    else
      delete from comisiones where id = c.id;
    end if;
  end loop;

  update cotizaciones set estado = 'vencida', respondida_en = now()
   where solicitud_id = p_solicitud and estado = 'emitida';

  update solicitudes
     set estado = 'cancelada',
         estatus_publico = 'cancelada',
         cancelada_en = now(),
         motivo_cancelacion = p_motivo
   where id = p_solicitud;
  perform set_config('tasa.motivo', '', true);
end;
$$;

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
         cuenta_receptora_id = c.cuenta_receptora_id
   where id = s.id;
end;
$$;

-- ------------------------------------------------------------
-- 5. CIERRE
-- ------------------------------------------------------------

create function resumen_del_mes(p_org uuid, p_mes date)
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
                      where c2.organizacion_id = p_org and c2.mes = mes_de(p_mes)
                        and c2.comisionista_id = c.comisionista_id
                      group by 1
                   ) t
               )
             ) as fila
        from comisiones c
        join personas p on p.id = c.comisionista_id
       where c.organizacion_id = p_org and c.mes = mes_de(p_mes)
       group by c.comisionista_id, p.nombre
    ) x;
$$;

create function ejecutar_preparacion_cierre(p_org uuid, p_mes date, p_persona uuid)
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

create or replace function preparar_cierre(p_mes date)
returns uuid language plpgsql security definer set search_path = public as $$
begin
  if not soy_staff() then
    raise exception 'Solo finanzas o admin_org preparan el cierre';
  end if;
  return ejecutar_preparacion_cierre(mi_org(), p_mes, mi_persona_id());
end;
$$;

create function ejecutar_aprobacion_cierre(p_org uuid, p_mes date, p_persona uuid)
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
      (organizacion_id, comisionista_id, mes, nivel_id, porcentaje, promedio, meses_considerados, cierre_id)
    values
      (p_org, k.persona_id, v_siguiente, n.nivel_id, n.porcentaje, n.promedio, n.meses_considerados, v_cierre.id)
    on conflict (organizacion_id, comisionista_id, mes) do update
       set nivel_id = excluded.nivel_id,
           porcentaje = excluded.porcentaje,
           promedio = excluded.promedio,
           meses_considerados = excluded.meses_considerados,
           cierre_id = excluded.cierre_id;
  end loop;

  if not mes_aprobado(p_org, v_siguiente) then
    perform recalcular_comisiones_del_mes(p_org, v_siguiente);
  end if;

  return v_cierre.id;
end;
$$;

create or replace function aprobar_cierre(p_mes date)
returns uuid language plpgsql security definer set search_path = public as $$
begin
  if not soy_admin_org() then
    raise exception 'Solo admin_org aprueba el cierre';
  end if;
  return ejecutar_aprobacion_cierre(mi_org(), p_mes, mi_persona_id());
end;
$$;

-- ------------------------------------------------------------
-- 6. PAGOS DE COMISIÓN
-- ------------------------------------------------------------

create function ejecutar_pago_comision(
  p_org uuid, p_persona uuid, p_comisionista uuid, p_fecha date, p_origen uuid, p_referencia text,
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
  if not exists (select 1 from origenes_pago where id = p_origen and organizacion_id = p_org and activo) then
    raise exception 'Elige de dónde salió el dinero';
  end if;
  if coalesce(jsonb_array_length(p_aplicaciones), 0) = 0 then
    raise exception 'Elige al menos un pendiente';
  end if;
  if not exists (select 1 from comisionistas where organizacion_id = p_org and persona_id = p_comisionista) then
    raise exception 'Ese comisionista no es de esta organización';
  end if;

  select sum(round((x->>'monto')::numeric, 2)) into v_total from jsonb_array_elements(p_aplicaciones) x;
  if v_total is null or v_total <= 0 then
    raise exception 'El pago tiene que ser mayor que cero';
  end if;

  insert into pagos_comision (organizacion_id, comisionista_id, fecha, monto, origen_id, referencia,
                              comprobante_ruta, documento, nota, registrado_por)
  values (p_org, p_comisionista, p_fecha, v_total, p_origen, nullif(trim(p_referencia), ''), p_comprobante,
          p_documento, nullif(trim(p_nota), ''), p_persona)
  returning id into v_pago;

  for a in
    select (x->>'pendiente_id')::uuid as pendiente_id, round((x->>'monto')::numeric, 2) as monto
      from jsonb_array_elements(p_aplicaciones) x
  loop
    select * into pc from pendientes_comision where id = a.pendiente_id for update;
    if not found or pc.organizacion_id <> p_org or pc.comisionista_id <> p_comisionista then
      raise exception 'Un pendiente no es de este comisionista';
    end if;
    if a.monto is null or a.monto <= 0 then
      raise exception 'Cada monto aplicado tiene que ser mayor que cero';
    end if;
    if pc.pagado + a.monto > pc.monto then
      raise exception 'El pendiente de % solo tiene % por pagar', to_char(pc.mes, 'YYYY-MM'), pc.monto - pc.pagado;
    end if;

    insert into aplicaciones_pago_comision (organizacion_id, pago_id, pendiente_id, monto)
    values (p_org, v_pago, pc.id, a.monto);
    update pendientes_comision
       set pagado = pagado + a.monto,
           pagado_en = case when pagado + a.monto = monto then p_fecha end
     where id = pc.id;
    if pc.pagado + a.monto = pc.monto then
      update comisiones set estado = 'pagada', pagada_en = p_fecha
       where organizacion_id = p_org and comisionista_id = p_comisionista
         and mes = pc.mes and estado = 'devengada';
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
    raise exception 'Solo finanzas o admin_org registran pagos de comisión';
  end if;
  if p_comprobante is not null
     and p_comprobante not like mi_org()::text || '/' || mi_persona_id()::text || '/%' then
    raise exception 'El comprobante no es válido';
  end if;
  return ejecutar_pago_comision(mi_org(), mi_persona_id(), p_comisionista, p_fecha, p_origen, p_referencia,
                                p_comprobante, p_documento, p_nota, p_aplicaciones);
end;
$$;

create or replace function subir_factura_comision(p_pendiente uuid, p_ruta text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_ruta is null or p_ruta not like mi_org()::text || '/' || mi_persona_id()::text || '/%' then
    raise exception 'El archivo no es válido. Súbelo otra vez.';
  end if;
  update pendientes_comision
     set factura_ruta = p_ruta, factura_subida_en = now()
   where id = p_pendiente and organizacion_id = mi_org() and comisionista_id = mi_persona_id();
  if not found then
    raise exception 'Ese pendiente no es tuyo';
  end if;
end;
$$;

create or replace function mis_pagos_comision()
returns table (pendiente_id uuid, fecha date, referencia text, monto numeric)
language sql stable security definer set search_path = public as $$
  select a.pendiente_id, p.fecha, p.referencia, a.monto
    from aplicaciones_pago_comision a
    join pagos_comision p on p.id = a.pago_id
   where p.organizacion_id = mi_org()
     and p.comisionista_id = mi_persona_id()
     and p.estado = 'registrado'
   order by p.fecha, p.registrado_en;
$$;

create or replace function comisiones_por_pagar()
returns table (
  pendiente_id uuid, comisionista_id uuid, comisionista text, mes date,
  monto numeric, pagado numeric, saldo numeric, vence_en date, vencido boolean,
  esperando_factura boolean
) language sql stable security definer set search_path = public as $$
  select pc.id, pc.comisionista_id, p.nombre, pc.mes,
         pc.monto, pc.pagado, pc.monto - pc.pagado,
         vence_pago_comision(pc.organizacion_id, pc.mes),
         hoy_mx() > vence_pago_comision(pc.organizacion_id, pc.mes),
         c.emite_factura and pc.factura_ruta is null
    from pendientes_comision pc
    join comisionistas c on c.organizacion_id = pc.organizacion_id and c.persona_id = pc.comisionista_id
    join personas p on p.id = pc.comisionista_id
   where pc.organizacion_id = mi_org()
     and pc.pagado < pc.monto
     and soy_staff()
   order by vence_pago_comision(pc.organizacion_id, pc.mes), p.nombre;
$$;

-- ------------------------------------------------------------
-- 7. COMISIONISTAS
-- ------------------------------------------------------------
-- admin_marca ve a todos los de la organización, pero la comisión del
-- mes solo de sus marcas y sin el saldo por pagar (mezcla marcas).

create or replace function resumen_comisionistas()
returns table (
  persona_id uuid, nombre text, correo text, activo boolean, nivel text, porcentaje numeric,
  provisional boolean, trabajos_activos bigint, comision_mes numeric, saldo_por_pagar numeric,
  ultimo_acceso timestamptz
) language sql stable security definer set search_path = public as $$
  select p.id, p.nombre, p.correo, m.activa and p.activo,
         nivel_vigente(c.organizacion_id, p.id, hoy_mx()),
         porcentaje_vigente(c.organizacion_id, p.id, hoy_mx()),
         porcentaje_es_provisional(c.organizacion_id, p.id, hoy_mx()),
         (select count(*) from solicitudes s
           where s.organizacion_id = c.organizacion_id and s.comisionista_id = p.id
             and s.estado in ('solicitada', 'cotizada', 'tramite') and s.pagado_en is null
             and (soy_staff() or s.marca_id = any (mis_marcas()))),
         (select coalesce(sum(k.monto), 0) from comisiones k
           where k.organizacion_id = c.organizacion_id and k.comisionista_id = p.id
             and k.mes = mes_abierto_desde(c.organizacion_id, hoy_mx())
             and (soy_staff() or k.cuenta_receptora_id in (
                   select id from cuentas_receptoras where marca_id = any (mis_marcas())))),
         case when soy_staff() then
           (select coalesce(sum(monto - pagado), 0) from pendientes_comision
             where organizacion_id = c.organizacion_id and comisionista_id = p.id)
         end,
         u.last_sign_in_at
    from comisionistas c
    join personas p on p.id = c.persona_id
    join membresias m on m.persona_id = p.id and m.organizacion_id = c.organizacion_id and m.rol = 'comisionista'
    left join auth.users u on u.id = p.user_id
   where c.organizacion_id = mi_org()
     and (soy_staff() or mi_rol() = 'admin_marca')
   order by p.nombre;
$$;

-- Si el correo ya existe (en otra organización), se reutiliza la
-- persona: un correo, una identidad, varias membresías.
create or replace function alta_comisionista(
  p_nombre text, p_correo text, p_telefono text, p_rfc text, p_slug text,
  p_referido_por uuid, p_emite_factura boolean
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

  return v_id;
end;
$$;

create or replace function actualizar_comisionista(
  p_persona uuid, p_nombre text, p_telefono text, p_rfc text, p_emite_factura boolean
) returns void language plpgsql security definer set search_path = public as $$
begin
  if not soy_staff() then
    raise exception 'Solo finanzas o admin_org editan comisionistas';
  end if;
  if nullif(trim(p_nombre), '') is null then
    raise exception 'Falta el nombre';
  end if;
  update comisionistas set rfc = nullif(upper(trim(p_rfc)), ''), emite_factura = coalesce(p_emite_factura, false)
   where organizacion_id = mi_org() and persona_id = p_persona;
  if not found then
    raise exception 'No existe ese comisionista';
  end if;
  update personas set nombre = trim(p_nombre), telefono = nullif(trim(p_telefono), '')
   where id = p_persona;
end;
$$;

-- Inactivo en ESTA organización: no entra a ella ni se le calcula
-- nivel. Lo que se le debe se le sigue pagando.
create or replace function cambiar_activo_comisionista(p_persona uuid, p_activo boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not soy_staff() then
    raise exception 'Solo finanzas o admin_org activan o desactivan comisionistas';
  end if;
  update membresias set activa = p_activo
   where persona_id = p_persona and organizacion_id = mi_org() and rol = 'comisionista';
  if not found then
    raise exception 'No existe ese comisionista';
  end if;
end;
$$;

create or replace function forzar_elite(p_persona uuid, p_porcentaje numeric)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not soy_admin_org() then
    raise exception 'Solo admin_org fuerza el nivel Élite';
  end if;
  update comisionistas set porcentaje_forzado = p_porcentaje
   where organizacion_id = mi_org() and persona_id = p_persona;
  if not found then
    raise exception 'No existe ese comisionista';
  end if;
end;
$$;

create or replace function agregar_movimiento(
  p_comisionista uuid, p_tipo text, p_monto numeric, p_cuenta uuid, p_servicio uuid, p_nota text
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  if not soy_admin_org() then
    raise exception 'Solo admin_org agrega bonos, ajustes o cargos';
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
  insert into comisiones (organizacion_id, comisionista_id, tipo, monto, mes, cuenta_receptora_id,
                          servicio_id, nota, creada_por)
  values (mi_org(), p_comisionista, p_tipo,
          case when p_tipo = 'cargo' then -abs(p_monto) when p_tipo = 'bono' then abs(p_monto) else p_monto end,
          mes_abierto_desde(mi_org(), hoy_mx()), p_cuenta, p_servicio, trim(p_nota), mi_persona_id())
  returning id into v_id;
  return v_id;
end;
$$;

-- ------------------------------------------------------------
-- 8. DESHACER Y ANULAR (0014, ahora por organización)
-- ------------------------------------------------------------

create or replace function retirar_pago(p_pago uuid, p_motivo text)
returns void language plpgsql security definer set search_path = public as $$
declare
  p pagos%rowtype;
begin
  select * into p from pagos where id = p_pago and organizacion_id = mi_org() for update;
  if not found or p.reportado_por is distinct from mi_persona_id() then
    raise exception 'Ese pago no lo reportaste tú';
  end if;
  if p.estado <> 'reportado' then
    raise exception 'El pago ya está %: pídele a Administración que lo revise', p.estado;
  end if;
  perform poner_motivo(p_motivo);
  update pagos set estado = 'retirado', motivo_retiro = trim(p_motivo) where id = p_pago;
  perform set_config('tasa.motivo', '', true);
end;
$$;

create or replace function revertir_pago(p_pago uuid, p_motivo text)
returns void language plpgsql security definer set search_path = public as $$
declare
  p          pagos%rowtype;
  s          solicitudes%rowtype;
  v_anterior text;
begin
  if not soy_staff() then
    raise exception 'Solo finanzas o admin_org revierten pagos';
  end if;
  select * into p from pagos where id = p_pago and organizacion_id = mi_org() for update;
  if not found then
    raise exception 'No existe ese pago';
  end if;
  if p.estado not in ('confirmado', 'rechazado') then
    raise exception 'Solo se revierte un pago confirmado o rechazado (este está %)', p.estado;
  end if;
  perform mes_cerrado_para(p.organizacion_id, p.fecha_pago);
  perform poner_motivo(p_motivo);

  if p.estado = 'confirmado' then
    select * into s from solicitudes where id = p.solicitud_id for update;
    if s.pagado_en is not null then
      if exists (select 1 from comisiones
                  where solicitud_id = s.id and tipo = 'comision' and mes_aprobado(s.organizacion_id, mes)) then
        raise exception 'Mes cerrado: corrige con un ajuste en el mes abierto';
      end if;
      delete from comisiones where solicitud_id = s.id and tipo = 'comision';

      select estatus_publico into v_anterior
        from historial_estatus
       where solicitud_id = s.id and estatus_publico <> 'pagado'
       order by desde desc limit 1;
      update solicitudes
         set pagado_en = null, mes_cierre = null,
             estatus_publico = coalesce(v_anterior, 'entregado')
       where id = s.id;
    end if;
  end if;

  perform set_config('tasa.revertir', 'on', true);
  update pagos set estado = 'reportado' where id = p_pago;
  perform set_config('tasa.revertir', '', true);
  perform set_config('tasa.motivo', '', true);
end;
$$;

create or replace function cancelar_mi_solicitud(p_solicitud uuid, p_motivo text)
returns void language plpgsql security definer set search_path = public as $$
declare
  s solicitudes%rowtype;
begin
  select * into s from solicitudes where id = p_solicitud and organizacion_id = mi_org() for update;
  if not found or s.comisionista_id is distinct from mi_persona_id() then
    raise exception 'Esa solicitud no es tuya';
  end if;
  if s.estado <> 'solicitada' then
    raise exception 'Ya se cotizó: pídele a Administración que la cancele';
  end if;
  perform poner_motivo(p_motivo);
  update solicitudes
     set estado = 'cancelada', estatus_publico = 'cancelada',
         cancelada_en = now(), motivo_cancelacion = trim(p_motivo)
   where id = s.id;
  perform set_config('tasa.motivo', '', true);
end;
$$;

create or replace function anular_cotizacion(p_cotizacion uuid, p_motivo text)
returns void language plpgsql security definer set search_path = public as $$
declare
  c cotizaciones%rowtype;
begin
  if not soy_staff() then
    raise exception 'Solo finanzas o admin_org anulan cotizaciones';
  end if;
  select * into c from cotizaciones where id = p_cotizacion and organizacion_id = mi_org() for update;
  if not found or c.estado <> 'emitida' then
    raise exception 'Solo se anula una cotización emitida que nadie ha aceptado';
  end if;
  perform poner_motivo(p_motivo);
  update cotizaciones
     set estado = 'anulada', respondida_en = now(), motivo_anulacion = trim(p_motivo)
   where id = c.id;
  update solicitudes
     set estado = 'solicitada', estatus_publico = 'solicitada'
   where id = c.solicitud_id and estado = 'cotizada';
  perform set_config('tasa.motivo', '', true);
end;
$$;

create or replace function anular_pago_comision(p_pago uuid, p_motivo text)
returns void language plpgsql security definer set search_path = public as $$
declare
  p  pagos_comision%rowtype;
  a  record;
begin
  if not soy_staff() then
    raise exception 'Solo finanzas o admin_org anulan pagos de comisión';
  end if;
  select * into p from pagos_comision where id = p_pago and organizacion_id = mi_org() for update;
  if not found or p.estado <> 'registrado' then
    raise exception 'Ese pago ya estaba anulado';
  end if;
  perform mes_cerrado_para(p.organizacion_id, p.fecha);
  perform poner_motivo(p_motivo);

  for a in
    select ap.monto, pc.id as pendiente_id, pc.comisionista_id, pc.mes
      from aplicaciones_pago_comision ap
      join pendientes_comision pc on pc.id = ap.pendiente_id
     where ap.pago_id = p.id
  loop
    update pendientes_comision
       set pagado = pagado - a.monto, pagado_en = null
     where id = a.pendiente_id;
    update comisiones set estado = 'devengada', pagada_en = null
     where organizacion_id = p.organizacion_id and comisionista_id = a.comisionista_id
       and mes = a.mes and estado = 'pagada';
  end loop;

  update pagos_comision
     set estado = 'anulado', motivo_anulacion = trim(p_motivo),
         anulado_por = mi_persona_id(), anulado_en = now()
   where id = p.id;
  perform set_config('tasa.motivo', '', true);
end;
$$;

create or replace function anular_movimiento(p_comision uuid, p_motivo text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  c     comisiones%rowtype;
  v_id  uuid;
begin
  if not soy_admin_org() then
    raise exception 'Solo admin_org anula bonos, ajustes o cargos';
  end if;
  select * into c from comisiones where id = p_comision and organizacion_id = mi_org() for update;
  if not found or c.tipo not in ('bono', 'ajuste', 'cargo') or c.solicitud_id is not null or c.anula_id is not null then
    raise exception 'Solo se anula un bono, ajuste o cargo hecho a mano';
  end if;
  if exists (select 1 from comisiones where anula_id = c.id) then
    raise exception 'Ese movimiento ya estaba anulado';
  end if;
  perform mes_cerrado_para(c.organizacion_id, c.mes);
  perform poner_motivo(p_motivo);

  insert into comisiones (organizacion_id, comisionista_id, tipo, monto, mes, cuenta_receptora_id,
                          servicio_id, nota, creada_por, anula_id)
  values (c.organizacion_id, c.comisionista_id, 'ajuste', -c.monto, c.mes, c.cuenta_receptora_id, c.servicio_id,
          'Anulación: ' || trim(p_motivo), mi_persona_id(), c.id)
  returning id into v_id;
  perform set_config('tasa.motivo', '', true);
  return v_id;
end;
$$;

-- ------------------------------------------------------------
-- 9. ALERTAS
-- ------------------------------------------------------------

create or replace function descartar_alerta(p_alerta uuid, p_nota text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not soy_admin_org() then
    raise exception 'Solo admin_org descarta alertas';
  end if;
  if nullif(trim(p_nota), '') is null then
    raise exception 'Hace falta una nota de por qué se descarta';
  end if;
  update alertas
     set resuelta_en = now(), resuelta_por = mi_persona_id(), resolucion = p_nota
   where id = p_alerta and organizacion_id = mi_org() and resuelta_en is null;
end;
$$;

-- ------------------------------------------------------------
-- 10. ACCESO, CONTACTO, ORGANIZACIONES Y EQUIPO
-- ------------------------------------------------------------

-- Antes de mandar el código: ¿este correo puede entrar a algún lado?
create or replace function correo_en_padron(p_correo text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from personas p
     where lower(p.correo) = lower(trim(p_correo)) and p.activo
       and (p.super_plataforma
            or exists (select 1 from membresias m join organizaciones o on o.id = m.organizacion_id
                        where m.persona_id = p.id and m.activa and o.activa))
  );
$$;

-- Con sesión, el de su organización (o el de plataforma si no tiene);
-- sin sesión, el de plataforma.
create or replace function contacto_soporte()
returns text language sql stable security definer set search_path = public as $$
  select coalesce(
    (select nullif(trim(contacto_soporte), '') from ajustes where organizacion_id = mi_org()),
    (select nullif(trim(contacto_soporte), '') from ajustes_plataforma)
  );
$$;

-- Lo mínimo para que una organización nueva funcione: ajustes,
-- conector manual, niveles y orígenes del dinero por omisión, y su
-- primer admin_org. Marcas, cuentas y servicios los pone su admin.
create or replace function crear_organizacion(
  p_nombre text, p_slug text, p_prefijo text, p_admin_nombre text, p_admin_correo text
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_org   uuid;
  v_admin uuid;
  v_corr  text := lower(trim(p_admin_correo));
begin
  if not soy_super_plataforma() then
    raise exception 'Solo la plataforma da de alta organizaciones';
  end if;
  if v_corr !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'El correo del administrador no es válido';
  end if;
  if exists (select 1 from organizaciones where slug = p_slug) then
    raise exception 'Ese slug ya lo usa otra organización';
  end if;

  insert into organizaciones (nombre, slug, prefijo_folio)
  values (trim(p_nombre), p_slug, upper(p_prefijo))
  returning id into v_org;

  insert into ajustes (organizacion_id) values (v_org);
  insert into conectores (organizacion_id, tipo) values (v_org, 'manual');
  insert into niveles (organizacion_id, nombre, orden, umbral_minimo, porcentaje, es_forzado) values
    (v_org, 'Enlace',     1,     0,  5.00, false),
    (v_org, 'Aliado',     2, 10000, 10.00, false),
    (v_org, 'Socio',      3, 30000, 12.50, false),
    (v_org, 'Socio Plus', 4, 60000, 15.00, false),
    (v_org, 'Élite',      5,  null,  null, true);
  insert into origenes_pago (organizacion_id, nombre, orden) values
    (v_org, 'Transferencia', 1), (v_org, 'Efectivo', 2), (v_org, 'Otra', 3);

  select id into v_admin from personas where lower(correo) = v_corr;
  if v_admin is null then
    insert into personas (nombre, correo, organizacion_activa)
    values (trim(p_admin_nombre), v_corr, v_org)
    returning id into v_admin;
  end if;
  insert into membresias (persona_id, organizacion_id, rol) values (v_admin, v_org, 'admin_org');

  return v_org;
end;
$$;

-- El equipo de la organización (no comisionistas): admin_org,
-- finanzas, admin_marca (con sus marcas) y equipo.
create or replace function alta_membresia(
  p_nombre text, p_correo text, p_rol text, p_marcas uuid[]
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_org   uuid := mi_org();
  v_id    uuid;
  v_mem   uuid;
  v_corr  text := lower(trim(p_correo));
begin
  if not soy_admin_org() then
    raise exception 'Solo admin_org da de alta al equipo';
  end if;
  if p_rol not in ('admin_org', 'finanzas', 'admin_marca', 'equipo') then
    raise exception 'Rol no válido (los comisionistas se dan de alta en Comisionistas)';
  end if;
  if p_rol = 'admin_marca' and coalesce(array_length(p_marcas, 1), 0) = 0 then
    raise exception 'Elige al menos una marca';
  end if;
  if v_corr !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'El correo no es válido';
  end if;

  select id into v_id from personas where lower(correo) = v_corr;
  if v_id is null then
    insert into personas (nombre, correo, organizacion_activa)
    values (trim(p_nombre), v_corr, v_org) returning id into v_id;
  elsif exists (select 1 from membresias where persona_id = v_id and organizacion_id = v_org) then
    raise exception 'Ese correo ya es parte de esta organización';
  end if;

  insert into membresias (persona_id, organizacion_id, rol) values (v_id, v_org, p_rol)
  returning id into v_mem;
  if p_rol = 'admin_marca' then
    insert into membresia_marcas (organizacion_id, membresia_id, marca_id)
    select v_org, v_mem, unnest(p_marcas);
  end if;
  return v_mem;
end;
$$;

create or replace function cambiar_activa_membresia(p_membresia uuid, p_activa boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not soy_admin_org() then
    raise exception 'Solo admin_org activa o desactiva al equipo';
  end if;
  if exists (select 1 from membresias where id = p_membresia and persona_id = mi_persona_id()) then
    raise exception 'No puedes desactivarte a ti mismo';
  end if;
  update membresias set activa = p_activa
   where id = p_membresia and organizacion_id = mi_org() and rol <> 'comisionista';
  if not found then
    raise exception 'No existe esa membresía';
  end if;
end;
$$;

-- Para el selector de la barra: dónde puede entrar esta persona.
create or replace function mis_organizaciones()
returns table (id uuid, nombre text, slug text, rol text, es_miembro boolean)
language sql stable security definer set search_path = public as $$
  select o.id, o.nombre, o.slug, coalesce(m.rol, 'admin_org'), m.id is not null
    from organizaciones o
    left join membresias m on m.organizacion_id = o.id and m.persona_id = mi_persona_id() and m.activa
   where o.activa and (m.id is not null or soy_super_plataforma())
   order by m.id is null, o.nombre;
$$;

-- Todo lo que la aplicación necesita saber de la sesión, en una sola
-- llamada: quién es, en qué organización está, con qué rol, si está
-- de visita (plataforma sin membresía) y entre cuántas puede elegir.
create or replace function mi_sesion()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'persona_id',       p.id,
    'nombre',           p.nombre,
    'correo',           p.correo,
    'super_plataforma', p.super_plataforma,
    'rol',              mi_rol(),
    'organizacion',     (select jsonb_build_object('id', o.id, 'nombre', o.nombre, 'slug', o.slug)
                           from organizaciones o where o.id = mi_org()),
    'visitante',        p.super_plataforma and mi_org() is not null and not exists (
                          select 1 from membresias m
                           where m.persona_id = p.id and m.organizacion_id = mi_org() and m.activa),
    'organizaciones',   (select count(*) from mis_organizaciones())
  )
    from personas p
   where p.user_id = auth.uid() and p.activo;
$$;

-- ------------------------------------------------------------
-- 11. PERMISOS DE LAS FUNCIONES
-- ------------------------------------------------------------

revoke all on function
  soy_super_plataforma(), mi_org(), soy_admin_org(), mis_marcas(), elegir_organizacion(uuid),
  asignar_folio(), cambiar_estatus_manual(uuid, text),
  mes_aprobado(uuid, date), mes_abierto_desde(uuid, date), mes_cerrado_para(uuid, date),
  porcentaje_vigente(uuid, uuid, date), porcentaje_es_provisional(uuid, uuid, date),
  calcular_nivel(uuid, uuid, date), recalcular_comisiones_del_mes(uuid, date), nivel_vigente(uuid, uuid, date),
  vence_pago_comision(uuid, date), resumen_del_mes(uuid, date),
  ejecutar_preparacion_cierre(uuid, date, uuid), ejecutar_aprobacion_cierre(uuid, date, uuid),
  ejecutar_pago_comision(uuid, uuid, uuid, date, uuid, text, text, text, text, jsonb),
  crear_organizacion(text, text, text, text, text), alta_membresia(text, text, text, uuid[]),
  cambiar_activa_membresia(uuid, boolean), mis_organizaciones(), mi_sesion()
  from public, anon, authenticated;

grant execute on function
  soy_super_plataforma(), mi_org(), soy_admin_org(), mis_marcas(), elegir_organizacion(uuid),
  cambiar_estatus_manual(uuid, text),
  mes_aprobado(uuid, date), mes_abierto_desde(uuid, date),
  porcentaje_vigente(uuid, uuid, date), porcentaje_es_provisional(uuid, uuid, date),
  calcular_nivel(uuid, uuid, date), nivel_vigente(uuid, uuid, date), vence_pago_comision(uuid, date),
  crear_organizacion(text, text, text, text, text), alta_membresia(text, text, text, uuid[]),
  cambiar_activa_membresia(uuid, boolean), mis_organizaciones(), mi_sesion()
  to authenticated;

grant execute on function mi_org(), soy_super_plataforma(), soy_admin_org(), mis_marcas() to service_role;
