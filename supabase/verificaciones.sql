-- ============================================================
-- VERIFICACIONES — corren sobre la semilla de prueba y no dejan rastro.
--
-- Todo va dentro de begin … rollback: se puede correr las veces que
-- sea en el editor SQL de Supabase. Si algo falla, se detiene con el
-- mensaje de qué regla no se cumplió. Si todo pasa, el último aviso es
-- "Verificaciones correctas".
--
-- Las mismas secciones (`-- @@ Nombre`) las corre vitest, una prueba
-- por sección: `npm test`.
--
-- Las pruebas de RLS se hacen pasar por la persona de verdad
-- (`como()`): el editor corre como `postgres`, y ahí el RLS no aplica.
-- Las secciones dependen de las anteriores: van en orden.
-- ============================================================

begin;

-- Amarra un usuario de autenticación a cada persona de la semilla que
-- todavía no tenga (Xchel ya puede tener el suyo si entró con su correo).
insert into auth.users (id, email)
select gen_random_uuid(), correo from personas
 where (correo like '%@tasa.test' or correo like 'xchel%@arqosuv.com') and user_id is null;

-- Sin usuario, mi_org() lee tasa.org: lo que se inserta como postgres
-- nace en XG.
select set_config('tasa.org', 'a0000000-0000-4000-8000-000000000001', false);

create function pg_temp.xg() returns uuid language sql as $$ select 'a0000000-0000-4000-8000-000000000001'::uuid $$;
create function pg_temp.notion_xg() returns uuid language sql as $$ select 'a0000000-0000-4000-8000-0000000000c2'::uuid $$;

-- De vuelta a postgres, como sistema dentro de XG.
create function pg_temp.sistema() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
  perform set_config('tasa.org', 'a0000000-0000-4000-8000-000000000001', true);
end;
$$;

-- Cambia la sesión a la persona con ese correo (o a anon si es nulo).
create function pg_temp.como(p_correo text) returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  if p_correo is null then
    perform set_config('request.jwt.claims', '', true);
    perform set_config('tasa.org', '', true);
    perform set_config('role', 'anon', true);
  else
    perform set_config('request.jwt.claims',
      json_build_object('sub', (select user_id from personas where correo = p_correo))::text, true);
    perform set_config('role', 'authenticated', true);
  end if;
end;
$$;

-- Corre `p_sql` y exige que truene con un mensaje que contenga `p_fragmento`.
create function pg_temp.debe_fallar(p_sql text, p_fragmento text, p_que text) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if sqlerrm ilike '%' || p_fragmento || '%' then
      raise notice 'ok — %', p_que;
      return;
    end if;
    raise exception 'FALLA — %: tronó, pero con otro error: %', p_que, sqlerrm;
  end;
  raise exception 'FALLA — %: debía rechazarse y pasó', p_que;
end;
$$;

create function pg_temp.igual(p_real anyelement, p_esperado anyelement, p_que text) returns void language plpgsql as $$
begin
  if p_real is distinct from p_esperado then
    raise exception 'FALLA — %: esperaba %, salió %', p_que, p_esperado, p_real;
  end if;
  raise notice 'ok — %', p_que;
end;
$$;

-- Un RFC de prueba con su dígito verificador correcto.
create function pg_temp.rfc(p_base text) returns text language sql as $$ select p_base || rfc_digito(p_base) $$;

grant execute on all functions in schema pg_temp to anon, authenticated;

-- @@ Niveles
do $$
declare
  ana   uuid := (select id from personas where correo = 'xchel+ana@arqosuv.com');
  beto  uuid := (select id from personas where correo = 'xchel+beto@arqosuv.com');
  carla uuid := (select id from personas where correo = 'xchel+carla@arqosuv.com');
begin
  perform pg_temp.igual((select promedio from calcular_nivel(pg_temp.xg(), ana, '2026-07-01')), 36000::numeric,
    'Ana para julio: solo junio cuenta (alta en junio) → 36,000 / 1');
  perform pg_temp.igual((select porcentaje from calcular_nivel(pg_temp.xg(), ana, '2026-07-01')), 12.50::numeric,
    'Ana para julio: 36,000 ≥ 30,000 → Socio 12.5%');
  perform pg_temp.igual((select promedio from calcular_nivel(pg_temp.xg(), ana, '2026-08-01')), 18000::numeric,
    'Ana para agosto: jun + jul (julio en cero cuenta) → 18,000');
  perform pg_temp.igual((select promedio from calcular_nivel(pg_temp.xg(), ana, '2026-09-01')), 12000::numeric,
    'Ana para septiembre: jun-jul-ago → 12,000, Aliado');
  perform pg_temp.igual((select porcentaje from calcular_nivel(pg_temp.xg(), ana, '2026-10-01')), 5.00::numeric,
    'Ana para octubre: junio sale de la ventana → 0, Enlace 5%');
  perform pg_temp.igual((select meses_considerados from calcular_nivel(pg_temp.xg(), ana, '2026-12-01')), 3::smallint,
    'La ventana nunca pasa de 3 meses');
  perform pg_temp.igual((select meses_considerados from calcular_nivel(pg_temp.xg(), beto, '2026-10-01')), 2::smallint,
    'Beto (alta agosto): para octubre cuenta ago y sep');
  perform pg_temp.igual((select meses_considerados from calcular_nivel(pg_temp.xg(), carla, '2026-10-01')), 1::smallint,
    'Carla (alta 15 sep): para octubre cuenta solo sep');
  perform pg_temp.igual((select meses_considerados from calcular_nivel(pg_temp.xg(), beto, '2026-08-01')), 0::smallint,
    'Beto para agosto: todavía no estaba dado de alta en la ventana → 0 meses, Enlace');

  update comisionistas set porcentaje_forzado = 20 where persona_id = carla;
  perform pg_temp.igual((select porcentaje from calcular_nivel(pg_temp.xg(), carla, '2026-10-01')), 20::numeric,
    'Élite: el porcentaje forzado manda en el cálculo');
  perform pg_temp.igual(porcentaje_vigente(pg_temp.xg(), carla, '2026-11-01'), 20::numeric,
    'Élite: también en el porcentaje vigente');
  perform pg_temp.igual(porcentaje_es_provisional(pg_temp.xg(), carla, '2026-11-01'), false,
    'Élite nunca es provisional');
  update comisionistas set porcentaje_forzado = null where persona_id = carla;
end;
$$;

-- @@ Devengo y pagos
do $$
declare
  t5   uuid := (select id from solicitudes where folio = 'MGP-2026-9005');
  t7   uuid := (select id from solicitudes where folio = 'MGP-2026-9007');
  t8   uuid := (select id from solicitudes where folio = 'MGP-2026-9008');
  t9   uuid := (select id from solicitudes where folio = 'MGP-2026-9009');
begin
  -- Trabajo 8 (Beto): 6,000. 3,000 confirmados el 26 sep; falta la otra mitad.
  perform pg_temp.igual((select count(*) from comisiones where solicitud_id = t8), 0::bigint,
    'Sin el 100% no hay comisión');

  -- La otra mitad llega con fecha 28 sep, pero septiembre ya está aprobado.
  insert into pagos (solicitud_id, via, monto, fecha_pago, referencia)
  values (t8, 'directo', 3000, '2026-09-28', 'SPEI tardío');
  update pagos set estado = 'confirmado' where referencia = 'SPEI tardío';

  perform pg_temp.igual((select pagado_en from solicitudes where id = t8), date '2026-09-28',
    'pagado_en es la fecha del pago que completa el 100% (28 sep)');
  perform pg_temp.igual((select mes_cierre from solicitudes where id = t8), date '2026-10-01',
    'Septiembre ya estaba aprobado → el trabajo cae en octubre');
  perform pg_temp.igual((select monto from comisiones where solicitud_id = t8), 300.00::numeric,
    'Beto: 5% (su nivel de octubre) de 6,000');
  perform pg_temp.igual((select provisional from comisiones where solicitud_id = t8), false,
    'El nivel de octubre ya existe: no es provisional');
  perform pg_temp.igual((select estatus_publico from solicitudes where id = t8), 'pagado'::text,
    'El trabajo pasa a "pagado"');
  perform pg_temp.igual((select count(*) from historial_estatus
                          where solicitud_id = t8 and estatus_publico = 'pagado'), 1::bigint,
    'El cambio a "pagado" queda en el historial para avisar por correo');

  -- Orden por fecha de pago, no por orden de confirmación.
  insert into pagos (solicitud_id, via, monto, fecha_pago, referencia)
  values (t7, 'directo', 9000, '2026-10-01', 'anterior');
  update pagos set estado = 'confirmado' where referencia = 'anterior';
  perform pg_temp.igual((select pagado_en from solicitudes where id = t7), date '2026-10-02',
    'Se completa con el pago del 2 oct aunque el del 1 oct se confirmó después');

  perform pg_temp.debe_fallar(
    format($q$insert into pagos (solicitud_id, via, monto, fecha_pago, referencia)
              values (%L, 'directo', 1, '2026-10-01', 'x')$q$, t9),
    'ya está pagado', 'No se reciben pagos de un trabajo pagado');

  -- Trabajo 5: total 13,920 (12,000 + IVA). Confirmar de más se bloquea.
  update pagos set estado = 'confirmado' where solicitud_id = t5 and estado = 'reportado';
  insert into pagos (solicitud_id, via, monto, fecha_pago, referencia)
  values (t5, 'directo', 9000, hoy_mx(), 'de más');
  perform pg_temp.debe_fallar(
    format($q$update pagos set estado = 'confirmado' where solicitud_id = %L and referencia = 'de más'$q$, t5),
    'pasaría del total', 'Lo confirmado no puede pasar del total');
  perform pg_temp.debe_fallar(
    format($q$update pagos set monto = 1 where solicitud_id = %L and referencia = 'de más'$q$, t5),
    'no se edita', 'Un pago reportado no se edita');
  perform pg_temp.debe_fallar(
    format($q$update pagos set estado = 'rechazado' where solicitud_id = %L and referencia = 'de más'$q$, t5),
    'rechazo_con_motivo', 'Rechazar exige motivo');
  perform pg_temp.debe_fallar(
    format($q$update pagos set estado = 'reportado' where solicitud_id = %L and estado = 'confirmado'$q$, t5),
    'ya no cambia', 'Un pago confirmado no regresa');
  perform pg_temp.debe_fallar(
    format($q$update solicitudes set monto_honorarios = 1 where id = %L$q$, t9),
    'ya está pagado', 'Los montos de un trabajo pagado no cambian');
end;
$$;

-- @@ Tope 30%
do $$
declare
  t9  uuid := (select id from solicitudes where folio = 'MGP-2026-9009');
  ana uuid := (select id from personas where correo = 'xchel+ana@arqosuv.com');
begin
  -- Trabajo 9: honorarios 36,000 → tope 10,800. Ya tiene 1,800 (junio).
  insert into comisiones (comisionista_id, solicitud_id, tipo, monto, mes)
  values (ana, t9, 'bono', 9000, '2026-10-01');
  perform pg_temp.igual((select sum(monto) from comisiones where solicitud_id = t9), 10800.00::numeric,
    'Hasta el 30% exacto se permite');
  perform pg_temp.debe_fallar(
    format($q$insert into comisiones (comisionista_id, solicitud_id, tipo, monto, mes)
              values (%L, %L, 'ajuste', 0.01, '2026-10-01')$q$, ana, t9),
    'Tope de 30%', 'Un centavo arriba del 30% se bloquea');
  perform pg_temp.debe_fallar(
    format($q$insert into comisiones (comisionista_id, solicitud_id, tipo, monto, mes)
              values (%L, %L, 'referido', 100, '2026-10-01')$q$, ana, t9),
    'Tope de 30%', 'El referido también cuenta para el tope');
  insert into comisiones (comisionista_id, solicitud_id, tipo, monto, mes, nota)
  values (ana, t9, 'cargo', -500, '2026-10-01', 'prueba');
  raise notice 'ok — los cargos no cuentan para el tope';
  delete from comisiones where solicitud_id = t9 and nota = 'prueba';
end;
$$;

-- @@ Cierre
do $$
declare
  t9    uuid := (select id from solicitudes where folio = 'MGP-2026-9009');
  ana   uuid := (select id from personas where correo = 'xchel+ana@arqosuv.com');
  c_jun uuid := (select id from comisiones where solicitud_id = t9 and tipo = 'comision');
begin
  perform pg_temp.debe_fallar(
    format($q$select ejecutar_preparacion_cierre(pg_temp.xg(), %L, null)$q$, mes_de(hoy_mx())),
    'no ha terminado', 'El mes en curso no se prepara antes del corte');
  perform pg_temp.debe_fallar(
    $q$update cierres set resumen = '{}' where mes = '2026-09-01'$q$,
    'no se reabre', 'Un cierre aprobado no se modifica');
  perform pg_temp.debe_fallar(
    $q$delete from cierres where mes = '2026-09-01'$q$,
    'no se borra', 'Un cierre aprobado no se borra');
  perform pg_temp.debe_fallar(
    format($q$update comisiones set monto = 1 where id = %L$q$, c_jun),
    'solo se puede marcar como pagada', 'La comisión de un mes cerrado no cambia de monto');
  perform pg_temp.debe_fallar(
    format($q$delete from comisiones where id = %L$q$, c_jun),
    'registra un cargo', 'La comisión de un mes cerrado no se borra');
  perform pg_temp.debe_fallar(
    format($q$insert into comisiones (comisionista_id, tipo, monto, mes) values (%L, 'ajuste', 10, '2026-09-01')$q$, ana),
    'ya está cerrado', 'No entra nada nuevo a un mes cerrado');

  update comisiones set estado = 'pagada', pagada_en = '2026-07-05' where id = c_jun;
  raise notice 'ok — lo de un mes cerrado sí se marca pagado';
  perform pg_temp.debe_fallar(
    $q$update comisiones set estado = 'pagada', pagada_en = '2026-10-05' where mes = '2026-10-01' and tipo = 'comision'$q$,
    'cierre aprobado', 'Lo de un mes abierto no se marca pagado');

  -- Cancelar un trabajo cuyo mes ya cerró: entra un cargo, no se borra.
  perform cancelar_trabajo(t9, 'El cliente desistió');
  perform pg_temp.igual(
    (select monto from comisiones where solicitud_id = t9 and tipo = 'cargo'),
    -1800.00::numeric, 'Cancelación posterior al cierre → cargo de -1,800 en el mes abierto');
  perform pg_temp.igual(
    (select count(*) from comisiones where solicitud_id = t9 and tipo = 'bono'), 0::bigint,
    'El bono de un mes abierto se borra al cancelar');
  perform pg_temp.igual(
    (select count(*) from comisiones where id = c_jun), 1::bigint,
    'La comisión de junio sigue intacta');
end;
$$;

-- @@ Lectura de Notion
do $$
declare
  t4  uuid := (select id from solicitudes where externo_id = 'simulado-0004');
  t10 uuid := (select id from solicitudes where organizacion_id = pg_temp.xg() and estatus_publico = 'pagado' and externo_id is not null order by folio limit 1);
begin
  perform pg_temp.igual(
    registrar_lectura(pg_temp.notion_xg(), 'simulado-0004', 'Pendiente de folio – Inmobiliaria Norte', 'Por asignar', null),
    'actualizado'::text, 'Página sin folio: solo se anota la etapa externa');
  perform pg_temp.igual((select folio from solicitudes where id = t4), 'MGP-2026-9011'::text,
    'Un título sin folio no borra el folio que ya tiene');

  perform pg_temp.igual(
    registrar_lectura(pg_temp.notion_xg(), 'simulado-0004', 'MGP-2026-0590 Inmobiliaria Norte', 'Por asignar', '2026-10-30'),
    'actualizado'::text, 'Aparece el folio en el título');
  perform pg_temp.igual((select folio from solicitudes where id = t4), 'MGP-2026-0590'::text,
    'Tasa copia el folio del título');
  perform pg_temp.igual((select estatus_publico from solicitudes where id = t4), 'visita_agendada'::text,
    'Con fecha de visita, "Por asignar" se muestra como visita agendada');

  perform registrar_lectura(pg_temp.notion_xg(), 'simulado-0004', 'MGP-2026-0590 Inmobiliaria Norte', 'En proceso', '2026-10-30');
  perform pg_temp.igual((select estatus_publico from solicitudes where id = t4), 'en_elaboracion'::text,
    '"En proceso" → en elaboración');

  perform registrar_lectura(pg_temp.notion_xg(), 'simulado-0004', 'MGP-2026-0590 Inmobiliaria Norte', 'Etapa nueva', null);
  perform pg_temp.igual((select estatus_publico from solicitudes where id = t4), 'en_elaboracion'::text,
    'Una etapa que no está en el mapeo no mueve el estatus');

  perform registrar_lectura(pg_temp.notion_xg(), 'simulado-0004', 'MGP-2026-0590 Inmobiliaria Norte', 'Cancelado', null);
  perform pg_temp.igual((select estado from solicitudes where id = t4), 'cancelada'::text,
    'Cancelado en Notion cancela el trabajo en Tasa (0034)');
  perform registrar_lectura(pg_temp.notion_xg(), 'simulado-0004', 'MGP-2026-0590 Inmobiliaria Norte', 'Cancelado', null);
  perform pg_temp.igual((select count(*) from alertas where solicitud_id = t4 and resuelta_en is null) <= 1, true,
    'Leer otra vez no duplica nada');

  perform registrar_lectura(pg_temp.notion_xg(), (select externo_id from solicitudes where id = t10), (select folio from solicitudes where id = t10), 'En proceso', null);
  perform pg_temp.igual((select estatus_publico from solicitudes where id = t10), 'pagado'::text,
    'Notion no pisa el "pagado" de Tasa');
  perform pg_temp.igual(registrar_lectura(pg_temp.notion_xg(), 'no-existe', 'x', 'En proceso', null), 'sin_trabajo'::text,
    'Una página que no es de Tasa se ignora');
end;
$$;

-- @@ Permisos explícitos (GRANT)
-- El proyecto no expone tablas automáticamente: todo permiso sale de
-- 0010_permisos.sql. Aquí se comprueba contra el catálogo de la base.
do $$
declare
  v text;
begin
  select string_agg(table_name || ':' || privilege_type, ', ') into v
    from information_schema.role_table_grants
   where table_schema = 'public' and grantee = 'anon';
  perform pg_temp.igual(v, null::text, 'anon no tiene ningún permiso sobre ninguna tabla');

  select string_agg(p.proname, ', ' order by p.proname) into v
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute');
  perform pg_temp.igual(v, 'alta_admite_csf, aviso_privacidad_publico, cliente_admite_adjunto, confirmar_alta, contacto_soporte, correo_en_padron, datos_alta_publica, datos_liga_cliente, invitado_por, pedir_alta, pedir_por_liga'::text,
    'anon solo ejecuta lo de la pantalla de acceso, la solicitud de alta y el aviso de privacidad');

  select string_agg(c.relname, ', ' order by c.relname) into v
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r'
     and not has_table_privilege('authenticated', c.oid, 'select');
  perform pg_temp.igual(v, null::text, 'authenticated puede leer todas las tablas (el RLS filtra las filas)');

  select string_agg(c.relname, ', ' order by c.relname) into v
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;
  perform pg_temp.igual(v, null::text, 'Todas las tablas tienen RLS encendido');

  perform pg_temp.igual(has_table_privilege('authenticated', 'pagos', 'delete'), false,
    'Nadie borra pagos');
  perform pg_temp.igual(has_table_privilege('authenticated', 'bitacora', 'insert'), false,
    'Nadie escribe la bitácora a mano');
  perform pg_temp.igual(has_function_privilege('authenticated', 'ejecutar_aprobacion_cierre(uuid, date, uuid)', 'execute'), false,
    'La aprobación interna del cierre no se alcanza desde la app');
  perform pg_temp.igual(has_function_privilege('authenticated', 'vencer_cotizaciones()', 'execute'), false,
    'Vencer cotizaciones es solo del cron');
  perform pg_temp.igual(has_function_privilege('service_role', 'vencer_cotizaciones()', 'execute'), true,
    'El cron sí vence cotizaciones');
end;
$$;

-- @@ Permisos (RLS)
do $$
declare
  t5 uuid := (select id from solicitudes where folio = 'MGP-2026-9005');
  t6 uuid := (select id from solicitudes where folio = 'MGP-2026-9006');
  t7 uuid := (select id from solicitudes where folio = 'MGP-2026-9007');
  avaluo uuid := (select id from servicios where organizacion_id = pg_temp.xg() and nombre = 'Avalúo Comercial');
  beto uuid := (select id from personas where correo = 'xchel+beto@arqosuv.com');
begin
  perform pg_temp.como('xchel+beto@arqosuv.com');

  perform pg_temp.igual((select count(*) from solicitudes), 3::bigint, 'Beto ve solo sus 3 trabajos');
  perform pg_temp.igual((select count(*) from comisiones where comisionista_id <> beto), 0::bigint,
    'Beto no ve comisiones ajenas');
  perform pg_temp.igual((select count(*) from personas), 1::bigint, 'Beto solo ve su propia persona');
  perform pg_temp.igual((select count(*) from bitacora), 0::bigint, 'Beto no ve la bitácora');
  perform pg_temp.igual((select count(*) from alertas), 0::bigint, 'Beto no ve alertas');
  perform pg_temp.igual((select count(*) from cuentas_receptoras), 2::bigint,
    'Beto ve solo las cuentas de sus trabajos (ROMI y Scotiabank)');

  perform pg_temp.debe_fallar(
    format($q$insert into solicitudes (comisionista_id, tipo, servicio_id, inmueble_direccion, cliente_nombre, monto_honorarios)
              values (%L, 'cotizacion', %L, 'x', 'y', 1000)$q$, beto, avaluo),
    'row-level security', 'El comisionista no pone montos al solicitar');
  execute format($q$insert into solicitudes (comisionista_id, tipo, servicio_id, inmueble_direccion, cliente_nombre)
                    values (%L, 'cotizacion', %L, 'Calle Nueva 1', 'Cliente Nuevo')$q$, beto, avaluo);
  raise notice 'ok — el comisionista sí puede pedir una solicitud limpia';

  perform pg_temp.debe_fallar(
    format($q$insert into pagos (solicitud_id, via, monto, fecha_pago, nota, reportado_por)
              values (%L, 'aviso', 100, current_date, 'x', %L)$q$, t6, beto),
    'row-level security', 'No se reporta pago en un trabajo ajeno');
  perform pg_temp.debe_fallar(
    format($q$insert into pagos (solicitud_id, via, monto, fecha_pago, referencia, reportado_por)
              values (%L, 'directo', 100, current_date, 'x', %L)$q$, t5, beto),
    'row-level security', 'El comisionista no registra pagos directos');
  -- Un UPDATE que el RLS no deja ver no truena: toca cero filas.
  execute format($q$update pagos set estado = 'confirmado' where solicitud_id = %L$q$, t5);
  perform pg_temp.igual((select count(*) from pagos where solicitud_id = t5 and estado = 'reportado'), 1::bigint,
    'El comisionista no confirma pagos (su intento no toca nada)');
  perform pg_temp.debe_fallar(
    $q$select ejecutar_aprobacion_cierre(pg_temp.xg(), '2026-10-01', null)$q$,
    'permission denied', 'La función interna del cierre no se alcanza desde el navegador');
  perform pg_temp.debe_fallar(
    $q$select preparar_cierre('2026-09-01')$q$,
    'Solo finanzas', 'El comisionista no prepara cierres');
  perform pg_temp.debe_fallar(
    $q$select registrar_lectura(pg_temp.notion_xg(), 'simulado-0005', 'x', 'Entregado', null)$q$,
    'Solo admin_org sincroniza', 'El comisionista no escribe estatus del conector');

  perform pg_temp.como('gaby@tasa.test');
  perform pg_temp.debe_fallar(
    $q$select aprobar_cierre('2026-09-01')$q$,
    'Solo admin_org', 'Finanzas no aprueba cierres');
  perform pg_temp.debe_fallar(
    format($q$update solicitudes set cuenta_receptora_id = (select id from cuentas_receptoras where banco = 'Banregio') where id = %L$q$, t7),
    'solo admin_org', 'Finanzas no cambia la cuenta de un trabajo con pagos confirmados');
  perform pg_temp.igual((select count(*) from bitacora), 0::bigint, 'Finanzas no ve la bitácora');
  -- Desde 0034, Cancelado en Notion ya no deja alerta si no hay dinero: se pone una de conector para ver el permiso.
  perform pg_temp.sistema();
  insert into alertas (organizacion_id, tipo, conector_id, codigo, mensaje)
  values (pg_temp.xg(), 'conector', pg_temp.notion_xg(), 'otro', 'Alerta de prueba para el permiso');
  perform pg_temp.como('gaby@tasa.test');
  perform pg_temp.igual((select count(*) > 0 from alertas), true, 'Finanzas sí ve las alertas');
  perform pg_temp.sistema();
  delete from alertas where mensaje = 'Alerta de prueba para el permiso';
  perform pg_temp.como('gaby@tasa.test');

  perform pg_temp.como('xchel@arqosuv.com');
  execute format($q$update solicitudes set cuenta_receptora_id = (select id from cuentas_receptoras where banco = 'Banregio') where id = %L$q$, t7);
  perform pg_temp.igual(
    (select count(*) from bitacora where tabla = 'solicitudes' and registro_id = t7::text
        and antes->>'cuenta_receptora_id' is distinct from despues->>'cuenta_receptora_id'
        and rol = 'admin_org'), 1::bigint,
    'admin_org sí cambia la cuenta, y queda en bitácora con antes y después');

  perform pg_temp.como(null);
  perform pg_temp.debe_fallar($q$select count(*) from solicitudes$q$, 'permission denied',
    'anon no lee solicitudes');
  perform pg_temp.debe_fallar($q$select count(*) from personas$q$, 'permission denied',
    'anon no lee personas');
  perform pg_temp.debe_fallar($q$select count(*) from cuentas_receptoras$q$, 'permission denied',
    'anon no lee cuentas');
  perform pg_temp.debe_fallar($q$select count(*) from alertas$q$, 'permission denied',
    'anon no lee alertas');

  perform pg_temp.sistema();
end;
$$;

-- @@ Ajustes y contacto
do $$
begin
  perform pg_temp.igual(contacto_soporte(), null::text, 'Sin contacto configurado, no hay contacto');
  perform pg_temp.igual((select nombre from marcas where clave = 'XG'), 'XG'::text,
    'La marca XG no muestra el nombre de una persona');

  perform pg_temp.como('xchel+beto@arqosuv.com');
  perform pg_temp.igual((select count(*) from ajustes), 1::bigint, 'El comisionista lee los ajustes');
  update ajustes set contacto_soporte = 'intruso';
  perform pg_temp.igual(contacto_soporte(), null::text, 'El comisionista no cambia el contacto');

  perform pg_temp.como('xchel@arqosuv.com');
  update ajustes set contacto_soporte = '  soporte@tasa.test ';
  perform pg_temp.igual(contacto_soporte(), 'soporte@tasa.test'::text, 'admin_org configura el contacto de su organización');
  perform pg_temp.igual((select contacto_soporte from ajustes where organizacion_id <> pg_temp.xg()), null::text,
    'Y no toca el de otra organización (ni lo ve)');
  update ajustes_plataforma set contacto_soporte = 'plataforma@tasa.test';

  perform pg_temp.como('xchel+demo@arqosuv.com');
  perform pg_temp.igual(contacto_soporte(), 'soporte@demo.test'::text, 'Cada organización ve su propio contacto');

  perform pg_temp.como(null);
  perform pg_temp.igual(contacto_soporte(), 'plataforma@tasa.test'::text,
    'Sin sesión se ve el contacto de plataforma (no se sabe de qué organización es)');
  perform pg_temp.debe_fallar($q$select * from ajustes$q$, 'permission denied',
    'Sin sesión no se lee la tabla de ajustes');

  perform pg_temp.sistema();
  update ajustes set contacto_soporte = null where organizacion_id = pg_temp.xg();
  update ajustes_plataforma set contacto_soporte = null;
end;
$$;

-- @@ Alias de cuenta
-- La cuenta se nombra por su alias en todo lo que es etiqueta; el
-- titular legal solo acompaña a la CLABE.
do $$
begin
  perform pg_temp.igual(
    (select string_agg(alias, ', ' order by alias) from cuentas_receptoras where organizacion_id = pg_temp.xg()),
    'Banregio AP73, ROMI, Scotiabank XG'::text, 'Cada cuenta tiene su alias');
  perform pg_temp.igual(
    (select titular from cuentas_receptoras where alias = 'Scotiabank XG'), 'Xchel Guerrero'::text,
    'El titular real se conserva para los datos bancarios');
  perform pg_temp.igual(resumen_del_mes(pg_temp.xg(), '2026-10-01')::text like '%Scotiabank XG%', true,
    'El resumen del cierre agrupa por alias');
  perform pg_temp.igual(resumen_del_mes(pg_temp.xg(), '2026-10-01')::text like '%Xchel Guerrero%', false,
    'El resumen del cierre no muestra el titular');
  perform pg_temp.debe_fallar($q$update cuentas_receptoras set alias = '' where alias = 'ROMI'$q$,
    'cuentas_alias_corto', 'El alias no puede quedar vacío');
end;
$$;

-- @@ Porcentaje provisional
-- Va al final porque cierra octubre: simula que hoy es 5 de noviembre.
do $$
declare
  t5   uuid := (select id from solicitudes where folio = 'MGP-2026-9005');
  t10  uuid := (select id from solicitudes where folio = 'MGP-2026-9010');
  ana  uuid := (select id from personas where correo = 'xchel+ana@arqosuv.com');
  beto uuid := (select id from personas where correo = 'xchel+beto@arqosuv.com');
begin
  -- Hacia abajo (lo dejó la semilla): Ana nació provisional al 10% y su
  -- nivel real de octubre es 5%. Se respeta el 10%.
  perform pg_temp.igual(porcentaje_vigente(pg_temp.xg(), ana, '2026-10-01'), 5.00::numeric,
    'El nivel real de Ana en octubre es 5%');
  perform pg_temp.igual((select porcentaje from comisiones where solicitud_id = t10), 10.00::numeric,
    'Si el real es menor, se respeta el provisional (10%)');
  perform pg_temp.igual((select monto from comisiones where solicitud_id = t10), 800.00::numeric,
    'Y el monto no baja (800)');

  -- Trabajo 5 (Beto): faltan 6,920 y llegan el 3 de noviembre, con
  -- octubre todavía sin aprobar.
  insert into pagos (solicitud_id, via, monto, fecha_pago, referencia)
  values (t5, 'directo', 6920, '2026-11-03', 'finiquito nov');
  update pagos set estado = 'confirmado' where referencia = 'finiquito nov';

  perform pg_temp.igual((select porcentaje from comisiones where solicitud_id = t5), 5.00::numeric,
    'Nace con el nivel vigente de Beto (octubre, 5%)');
  perform pg_temp.igual((select provisional from comisiones where solicitud_id = t5), true,
    'Y marcada como provisional');

  -- Con un umbral más bajo, el cierre de octubre sube a Beto a Aliado:
  -- sus 6,000 de octubre / 3 meses = 2,000.
  update niveles set umbral_minimo = 1000 where nombre = 'Aliado';
  create or replace function hoy_mx() returns date language sql stable as $f$ select date '2026-11-05' $f$;

  perform ejecutar_preparacion_cierre(pg_temp.xg(), '2026-10-01', null);
  perform ejecutar_aprobacion_cierre(pg_temp.xg(), '2026-10-01', null);

  perform pg_temp.igual(porcentaje_vigente(pg_temp.xg(), beto, '2026-11-01'), 10.00::numeric,
    'Al aprobar octubre, Beto queda en Aliado para noviembre');
  perform pg_temp.igual((select monto from comisiones where solicitud_id = t5), 1200.00::numeric,
    'Si el real es mayor, la provisional sube: 10% de 12,000');
  perform pg_temp.igual((select provisional from comisiones where solicitud_id = t5), false,
    'Y deja de ser provisional');
  perform pg_temp.igual((select count(*) from comisiones where organizacion_id = pg_temp.xg() and mes = '2026-10-01' and provisional), 0::bigint,
    'Nada de un mes aprobado queda provisional');
end;
$$;

-- @@ Efectivo
-- Un pago en efectivo no lleva archivo; sí quién lo recibió. El trabajo 6
-- (Carla) sigue abierto; el efectivo de la semilla (trabajo 7) sigue por confirmar.
do $$
declare
  t6    uuid := (select id from solicitudes where folio = 'MGP-2026-9006');
  carla uuid := (select id from personas where correo = 'xchel+carla@arqosuv.com');
  gaby uuid := (select id from personas where correo = 'gaby@tasa.test');
begin
  perform pg_temp.como('xchel+carla@arqosuv.com');
  execute format($q$insert into pagos (solicitud_id, via, monto, fecha_pago, recibido_por, reportado_por)
                    values (%L, 'efectivo', 500, '2026-11-04', 'Recepción', %L)$q$, t6, carla);
  raise notice 'ok — el comisionista reporta efectivo sin comprobante';
  perform pg_temp.debe_fallar(
    format($q$insert into pagos (solicitud_id, via, monto, fecha_pago, reportado_por)
              values (%L, 'efectivo', 500, '2026-11-04', %L)$q$, t6, carla),
    'pagos_efectivo_con_quien', 'El efectivo exige quién lo recibió');
  perform pg_temp.debe_fallar(
    format($q$insert into pagos (solicitud_id, via, monto, fecha_pago, reportado_por)
              values (%L, 'comprobante', 500, '2026-11-04', %L)$q$, t6, carla),
    'check', 'Con comprobante sigue exigiendo el archivo');

  perform pg_temp.como('gaby@tasa.test');
  execute format($q$insert into pagos (solicitud_id, via, monto, fecha_pago, recibido_por, reportado_por)
                    values (%L, 'efectivo', 100, '2026-11-04', 'Gaby', %L)$q$, t6, gaby);
  perform pg_temp.igual((select count(*) from pagos where via = 'efectivo' and estado = 'reportado'), 3::bigint,
    'Finanzas también registra efectivo, y todo entra por confirmar');
  perform pg_temp.sistema();
end;
$$;

-- @@ Comisionistas
do $$
declare
  diego uuid;
begin
  perform pg_temp.como('gaby@tasa.test');
  perform pg_temp.debe_fallar(
    $q$select alta_comisionista('Diego Prueba', 'xchel+diego@arqosuv.com', '4420000004', 'GUXD800101AB3', 'diego-prueba', null, true)$q$,
    'Solo admin_org', 'Finanzas ya no da altas directas (captura una solicitud)');
  perform pg_temp.como('xchel@arqosuv.com');
  diego := alta_comisionista('Diego Prueba', ' Xchel+Diego@arqosuv.com ', '4420000004', 'guxd800101ab3',
                             'diego-prueba', null, true);
  perform pg_temp.igual((select rol from membresias where persona_id = diego and organizacion_id = pg_temp.xg()), 'comisionista'::text,
    'admin_org da de alta un comisionista');
  perform pg_temp.igual((select correo from personas where id = diego), 'xchel+diego@arqosuv.com'::text,
    'El correo se guarda limpio y en minúsculas');
  perform pg_temp.igual((select rfc || '/' || emite_factura from comisionistas where persona_id = diego),
    'GUXD800101AB3/true'::text, 'RFC en mayúsculas y "emite factura"');
  perform pg_temp.igual((select csf_ruta is null from comisionistas where persona_id = diego), true,
    'Sin CSF, el alta directa queda con "CSF pendiente"');
  perform pg_temp.debe_fallar(
    $q$select alta_comisionista('Otro', 'otro2@tasa.test', null, 'GUXD800101AB1', 'otro2', null, false)$q$,
    'dígito verificador', 'La base no acepta un RFC con el dígito verificador mal');
  perform pg_temp.debe_fallar(
    $q$select alta_comisionista('Otro', 'otro2@tasa.test', null, null, 'otro2', null, false)$q$,
    'RFC es obligatorio', 'El RFC es obligatorio en el alta directa');
  perform pg_temp.debe_fallar(
    $q$select alta_comisionista('Otro', 'otro2@tasa.test', null, 'GUXD800101AB1', 'otro2', null, false, false, null, null, true)$q$,
    'hace falta la CSF', 'RFC revisado a mano sin CSF no pasa');
  perform pg_temp.debe_fallar(
    $q$select alta_comisionista('Otro', 'xchel+diego@arqosuv.com', null, 'GUXD800101AB3', 'otro', null, false)$q$,
    'ya está dado de alta', 'No se repite un correo');
  perform pg_temp.debe_fallar(
    $q$select alta_comisionista('Otro', 'otro@tasa.test', null, 'GUXD800101AB3', 'diego-prueba', null, false)$q$,
    'slug', 'No se repite la liga');
  perform pg_temp.como('gaby@tasa.test');
  perform pg_temp.igual((select count(*) from resumen_comisionistas()), 4::bigint,
    'El staff ve a los 4 comisionistas en la lista');
  perform pg_temp.debe_fallar(format('select forzar_elite(%L, 20)', diego),
    'Solo admin_org', 'Finanzas no fuerza Élite');
  perform cambiar_activo_comisionista(diego, false);
  perform pg_temp.igual((select activo from resumen_comisionistas() where persona_id = diego), false,
    'Finanzas desactiva a un comisionista');

  perform pg_temp.como('xchel@arqosuv.com');
  perform forzar_elite(diego, 20);
  perform pg_temp.igual((select nivel || ' ' || porcentaje from resumen_comisionistas() where persona_id = diego),
    'Élite 20.00'::text, 'super_admin fuerza Élite al 20%');

  perform pg_temp.como('xchel+beto@arqosuv.com');
  perform pg_temp.igual((select count(*) from resumen_comisionistas()), 0::bigint,
    'Un comisionista no ve la lista de comisionistas');
  perform pg_temp.debe_fallar(
    $q$select alta_comisionista('X', 'x@tasa.test', null, 'GUXD800101AB3', 'x', null, false)$q$,
    'Solo admin_org', 'Un comisionista no da de alta a nadie');
  perform pg_temp.sistema();
end;
$$;

-- @@ Pendientes de comisión
-- Sigue en el 5 de noviembre (sección anterior): octubre ya está
-- aprobado. Con los cargos de las secciones previas, Ana cerró octubre
-- en −500 y Beto en +300.
do $$
declare
  ana   uuid := (select id from personas where correo = 'xchel+ana@arqosuv.com');
  beto  uuid := (select id from personas where correo = 'xchel+beto@arqosuv.com');
  carla uuid := (select id from personas where correo = 'xchel+carla@arqosuv.com');
  romi  uuid := (select id from cuentas_receptoras where alias = 'ROMI');
  t10   uuid := (select id from solicitudes where folio = 'MGP-2026-9010');
begin
  perform pg_temp.igual((select monto from pendientes_comision where comisionista_id = beto and mes = '2026-10-01'),
    300.00::numeric, 'Aprobar octubre dejó el pendiente de Beto (300)');
  perform pg_temp.igual((select count(*) from pendientes_comision where comisionista_id = ana and mes = '2026-10-01'),
    0::bigint, 'Ana, con octubre en negativo, no tiene pendiente de octubre');
  perform pg_temp.igual((select sum(monto) from comisiones where comisionista_id = ana and mes = '2026-10-01'),
    0.00::numeric, 'Su octubre queda en cero');
  perform pg_temp.igual((select monto from comisiones where comisionista_id = ana and mes = '2026-11-01' and tipo = 'arrastre'),
    -500.00::numeric, 'Y el negativo entra a noviembre como arrastre');
  perform pg_temp.igual((select a.alias from comisiones c join cuentas_receptoras a on a.id = c.cuenta_receptora_id
                          where c.solicitud_id = t10 and c.tipo = 'comision'), 'Scotiabank XG'::text,
    'La comisión de un trabajo se asigna a la cuenta de ese trabajo');
  perform pg_temp.igual(vence_pago_comision(pg_temp.xg(), '2026-09-01'), date '2026-10-10',
    'Lo de septiembre vence el 10 de octubre');

  perform pg_temp.como('gaby@tasa.test');
  perform pg_temp.igual((select vencido from comisiones_por_pagar() where mes = '2026-06-01'), true,
    'Junio (vencía el 10 de julio) sale vencido');
  perform pg_temp.igual((select vencido from comisiones_por_pagar() where mes = '2026-10-01'), false,
    'Octubre (vence el 10 de noviembre) todavía no');
  perform pg_temp.igual((select esperando_factura from comisiones_por_pagar() where comisionista_id = ana), true,
    'Ana emite factura y no la ha subido: espera factura');
  perform pg_temp.igual((select esperando_factura from comisiones_por_pagar() where comisionista_id = beto), false,
    'Beto no emite factura: no se le espera');
  perform pg_temp.sistema();
  update ajustes set dia_limite_pago_comision = 3;
  perform pg_temp.como('gaby@tasa.test');
  perform pg_temp.igual((select vencido from comisiones_por_pagar() where mes = '2026-10-01'), true,
    'Con el día límite en 3, octubre ya venció (el parámetro aplica a todos)');
  perform pg_temp.como('xchel+ana@arqosuv.com');
  perform pg_temp.igual((select count(*) from comisiones_por_pagar()), 0::bigint,
    'Un comisionista no lee la bandeja de comisiones por pagar');
  perform pg_temp.sistema();
  update ajustes set dia_limite_pago_comision = 10;

  -- Movimientos manuales: siempre con empresa.
  perform pg_temp.como('xchel@arqosuv.com');
  perform pg_temp.debe_fallar(format($q$select agregar_movimiento(%L, 'cargo', 500, null, null, 'x')$q$, carla),
    'Elige la empresa', 'Un cargo manual exige empresa');
  perform agregar_movimiento(carla, 'cargo', 500, romi, null, 'Descuento por papelería');
  perform pg_temp.igual((select monto from comisiones where comisionista_id = carla and tipo = 'cargo' and mes = '2026-11-01'),
    -500.00::numeric, 'El cargo manual cae en el mes abierto, en negativo');
  perform pg_temp.como('gaby@tasa.test');
  perform pg_temp.debe_fallar(format($q$select agregar_movimiento(%L, 'bono', 500, %L, null, 'x')$q$, carla, romi),
    'Solo admin_org', 'Finanzas no agrega movimientos');
  perform pg_temp.sistema();

  -- Noviembre: Beto +1,200 (trabajo 5), Carla −500, Ana −500 (arrastre).
  create or replace function hoy_mx() returns date language sql stable as $f$ select date '2026-12-05' $f$;
  perform ejecutar_preparacion_cierre(pg_temp.xg(), '2026-11-01', null);
  perform ejecutar_aprobacion_cierre(pg_temp.xg(), '2026-11-01', null);

  perform pg_temp.igual((select monto from pendientes_comision where comisionista_id = beto and mes = '2026-11-01'),
    1200.00::numeric, 'Beto tiene su pendiente de noviembre');
  perform pg_temp.igual((select count(*) from pendientes_comision where comisionista_id = carla), 0::bigint,
    'Carla, en negativo, no tiene pendiente');
  perform pg_temp.igual((select monto from comisiones where comisionista_id = carla and mes = '2026-12-01' and tipo = 'arrastre'),
    -500.00::numeric, 'Su negativo pasa a diciembre');
  perform pg_temp.igual((select monto from comisiones where comisionista_id = ana and mes = '2026-12-01' and tipo = 'arrastre'),
    -500.00::numeric, 'Un arrastre que sigue en negativo vuelve a pasar');
end;
$$;

-- @@ Pagos de comisión
-- Hoy: 5 de diciembre (lo dejó la sección anterior).
do $$
declare
  ana  uuid := (select id from personas where correo = 'xchel+ana@arqosuv.com');
  beto uuid := (select id from personas where correo = 'xchel+beto@arqosuv.com');
  jun  uuid := (select id from pendientes_comision where comisionista_id = ana and mes = '2026-06-01');
  oct  uuid := (select id from pendientes_comision where comisionista_id = beto and mes = '2026-10-01');
  nov  uuid := (select id from pendientes_comision where comisionista_id = beto and mes = '2026-11-01');
  efectivo uuid := (select id from origenes_pago where organizacion_id = pg_temp.xg() and nombre = 'Efectivo');
begin
  perform pg_temp.como('gaby@tasa.test');
  -- Un pago cubre todo octubre y una parte de noviembre.
  perform registrar_pago_comision(beto, '2026-12-04', efectivo, 'Recibo 7', null, 'ninguno', null,
    jsonb_build_array(jsonb_build_object('pendiente_id', oct, 'monto', 300),
                      jsonb_build_object('pendiente_id', nov, 'monto', 500)));
  perform pg_temp.igual((select pagado_en from pendientes_comision where id = oct), date '2026-12-04',
    'Octubre queda pagado con la fecha del pago que lo completó');
  perform pg_temp.igual((select bool_and(estado = 'pagada') from comisiones where comisionista_id = beto and mes = '2026-10-01'),
    true, 'Y sus comisiones quedan "pagada"');
  perform pg_temp.igual((select pagado from pendientes_comision where id = nov), 500.00::numeric,
    'Noviembre queda con un pago parcial de 500');
  perform pg_temp.igual((select monto from pagos_comision where referencia = 'Recibo 7'), 800.00::numeric,
    'El pago vale la suma de lo que cubre');
  perform pg_temp.debe_fallar(
    format($q$select registrar_pago_comision(%L, '2026-12-04', %L, null, null, 'ninguno', null,
              jsonb_build_array(jsonb_build_object('pendiente_id', %L, 'monto', 800)))$q$, beto, efectivo, nov),
    'solo tiene', 'No se paga más de lo pendiente');
  perform pg_temp.debe_fallar(
    format($q$select registrar_pago_comision(%L, '2026-12-04', %L, null, null, 'ninguno', null,
              jsonb_build_array(jsonb_build_object('pendiente_id', %L, 'monto', 100)))$q$, beto, efectivo, jun),
    'no es de este comisionista', 'Un pago no cubre pendientes de otro');
  perform pg_temp.debe_fallar(
    format($q$select registrar_pago_comision(%L, '2026-12-31', %L, null, null, 'ninguno', null,
              jsonb_build_array(jsonb_build_object('pendiente_id', %L, 'monto', 100)))$q$, beto, efectivo, nov),
    'futura', 'La fecha del pago no puede ser futura');

  perform pg_temp.como('xchel+beto@arqosuv.com');
  perform pg_temp.igual((select count(*) from pendientes_comision), 2::bigint, 'Beto ve solo sus 2 pendientes');
  perform pg_temp.igual((select count(*) from pagos_comision), 0::bigint,
    'Beto no lee la tabla de pagos de comisión (ahí está el origen)');
  perform pg_temp.igual((select count(*) from mis_pagos_comision()), 2::bigint,
    'Beto ve sus 2 aplicaciones de pago');
  perform pg_temp.igual(pg_get_function_result('mis_pagos_comision()'::regprocedure) like '%origen%', false,
    'Lo que el comisionista ve de un pago no trae el origen del dinero');
  perform pg_temp.debe_fallar(
    format($q$select registrar_pago_comision(%L, '2026-12-04', %L, null, null, 'ninguno', null, '[]')$q$, beto, efectivo),
    'Solo finanzas', 'Un comisionista no registra pagos de comisión');
  perform pg_temp.debe_fallar(format('select subir_factura_comision(%L, %L)', jun, pg_temp.xg() || '/' || beto || '/x.pdf'),
    'no es tuyo', 'Beto no sube factura a un pendiente ajeno');

  perform pg_temp.como('xchel+ana@arqosuv.com');
  perform pg_temp.igual((select count(*) from pendientes_comision), 1::bigint, 'Ana ve solo su pendiente');
  perform pg_temp.igual((select count(*) from mis_pagos_comision()), 1::bigint, 'Ana ve solo su pago (el de la semilla)');
  perform subir_factura_comision(jun, pg_temp.xg() || '/' || ana || '/factura-jun.pdf');
  perform pg_temp.igual((select factura_ruta from pendientes_comision where id = jun), pg_temp.xg() || '/' || ana || '/factura-jun.pdf',
    'Ana sube su factura del pendiente de junio');

  perform pg_temp.como('gaby@tasa.test');
  perform pg_temp.igual((select esperando_factura from comisiones_por_pagar() where pendiente_id = jun), false,
    'Con la factura subida, ya no espera factura');
  perform pg_temp.sistema();
end;
$$;

-- @@ Deshacer
-- Hoy: 5 de diciembre. Octubre y noviembre cerrados; diciembre abierto.
do $$
declare
  ana   uuid := (select id from personas where correo = 'xchel+ana@arqosuv.com');
  beto  uuid := (select id from personas where correo = 'xchel+beto@arqosuv.com');
  carla uuid := (select id from personas where correo = 'xchel+carla@arqosuv.com');
  romi  uuid := (select id from cuentas_receptoras where alias = 'ROMI');
  avaluo uuid := (select id from servicios where organizacion_id = pg_temp.xg() and nombre = 'Avalúo Comercial');
  t9    uuid := (select id from solicitudes where folio = 'MGP-2026-9009');
  t2    uuid := (select id from solicitudes where cliente_nombre = 'Jorge Salinas');
  t1    uuid := (select id from solicitudes where cliente_nombre = 'Laura Méndez');
  t7    uuid := (select id from solicitudes where folio = 'MGP-2026-9007');
  s     uuid;
  p     uuid;
  mov   uuid;
  recibo uuid := (select id from pagos_comision where referencia = 'Recibo 7');
  oct   uuid := (select id from pendientes_comision where comisionista_id = beto and mes = '2026-10-01');
begin
  -- Un trabajo de Carla que se paga completo el 3 de diciembre.
  insert into solicitudes (comisionista_id, tipo, origen, servicio_id, inmueble_direccion, cliente_nombre,
                           marca_id, cuenta_receptora_id, monto_honorarios, estado, estatus_publico, aceptada_en)
  values (carla, 'tramite_directo', 'admin', avaluo, 'Calle Prueba 1', 'Cliente Deshacer',
          (select id from marcas where clave = 'MGP'), romi, 10000, 'tramite', 'entregado', now())
  returning id into s;
  insert into pagos (solicitud_id, via, monto, fecha_pago, comprobante_ruta, reportado_por)
  values (s, 'comprobante', 10000, '2026-12-03', carla || '/x.pdf', carla) returning id into p;
  update pagos set estado = 'confirmado' where id = p;
  perform pg_temp.igual((select count(*) from comisiones where solicitud_id = s and tipo = 'comision'), 1::bigint,
    'Al confirmar el 100% se devenga la comisión');

  perform pg_temp.como('xchel+carla@arqosuv.com');
  perform pg_temp.debe_fallar(format('select retirar_pago(%L, %L)', p, 'me equivoqué'),
    'ya está confirmado', 'El comisionista no retira un pago ya confirmado');
  perform pg_temp.debe_fallar(format('select revertir_pago(%L, %L)', p, 'x'),
    'No existe ese pago', 'El comisionista no revierte confirmaciones');

  perform pg_temp.como('gaby@tasa.test');
  perform pg_temp.debe_fallar(format('select revertir_pago(%L, %L)', p, '  '),
    'Escribe el motivo', 'Revertir pide motivo');
  perform revertir_pago(p, 'Se confirmó el pago equivocado');
  perform pg_temp.sistema();
  perform pg_temp.igual((select estado from pagos where id = p), 'reportado'::text,
    'Revertir la confirmación regresa el pago a "reportado"');
  perform pg_temp.igual((select count(*) from comisiones where solicitud_id = s and tipo = 'comision'), 0::bigint,
    'Y quita la comisión que había devengado');
  perform pg_temp.igual((select pagado_en is null and estatus_publico = 'entregado' from solicitudes where id = s), true,
    'El trabajo deja de estar pagado y regresa a su estatus anterior');
  perform pg_temp.igual(
    (select count(*) from bitacora where motivo = 'Se confirmó el pago equivocado'
        and ((tabla = 'pagos' and antes->>'estado' = 'confirmado' and despues->>'estado' = 'reportado')
          or (tabla = 'comisiones' and accion = 'DELETE'))), 2::bigint,
    'La bitácora guarda el motivo con el antes y el después (pago y comisión)');

  -- Revertir un rechazo.
  update pagos set estado = 'rechazado', motivo_rechazo = 'No se ve la cuenta' where id = p;
  perform pg_temp.como('gaby@tasa.test');
  perform revertir_pago(p, 'Sí se veía la cuenta');
  perform pg_temp.sistema();
  perform pg_temp.igual((select estado || '/' || coalesce(motivo_rechazo, '-') from pagos where id = p), 'reportado/-'::text,
    'Revertir un rechazo lo regresa a "reportado" sin motivo de rechazo');
  perform pg_temp.debe_fallar(format($q$update pagos set estado = 'reportado' where id = %L$q$,
      (select id from pagos where estado = 'confirmado' limit 1)),
    'ya no cambia', 'Fuera de revertir_pago nadie regresa un pago a "reportado"');

  -- Retirar un pago reportado.
  perform pg_temp.como('xchel+carla@arqosuv.com');
  perform retirar_pago(p, 'Lo reporté dos veces');
  perform pg_temp.igual((select estado from pagos where id = p), 'retirado'::text, 'El comisionista retira su pago reportado');
  perform pg_temp.debe_fallar(format('select retirar_pago(%L, %L)', p, 'otra vez'),
    'retirado', 'Un pago retirado no se vuelve a retirar');
  perform pg_temp.como('xchel+ana@arqosuv.com');
  perform pg_temp.debe_fallar(
    format('select retirar_pago(%L, %L)', (select id from pagos where estado = 'reportado' and reportado_por <> ana limit 1), 'x'),
    'no lo reportaste', 'Nadie retira un pago que no reportó');

  -- Mes cerrado: no se deshace nada.
  perform pg_temp.como('xchel@arqosuv.com');
  perform pg_temp.debe_fallar(
    format('select revertir_pago(%L, %L)', (select id from pagos where solicitud_id = t9 and estado = 'confirmado' limit 1), 'x'),
    'Mes cerrado', 'No se revierte un pago de un mes cerrado');
  perform pg_temp.debe_fallar(
    format('select anular_pago_comision(%L, %L)', (select id from pagos_comision where referencia = 'SPEI 1001'), 'x'),
    'Mes cerrado', 'No se anula un pago de comisión de un mes cerrado');
  perform pg_temp.debe_fallar(
    format('select anular_movimiento(%L, %L)', (select id from comisiones where nota = 'Descuento por papelería'), 'x'),
    'Mes cerrado', 'No se anula un cargo de un mes cerrado');

  -- Anular un pago de comisión (diciembre, abierto).
  perform pg_temp.como('gaby@tasa.test');
  perform anular_pago_comision(recibo, 'Se registró al comisionista equivocado');
  perform pg_temp.sistema();
  perform pg_temp.igual((select pagado || '/' || coalesce(pagado_en::text, '-') from pendientes_comision where id = oct),
    '0.00/-'::text, 'Anular el pago le devuelve al pendiente su saldo');
  perform pg_temp.igual((select bool_and(estado = 'devengada') from comisiones where comisionista_id = beto and mes = '2026-10-01'),
    true, 'Y sus comisiones vuelven a "devengada"');
  perform pg_temp.igual((select estado from pagos_comision where id = recibo), 'anulado'::text,
    'El pago no se borra: queda anulado');
  perform pg_temp.como('xchel+beto@arqosuv.com');
  perform pg_temp.igual((select count(*) from mis_pagos_comision()), 0::bigint, 'El comisionista ya no ve el pago anulado');

  -- Cotizaciones y solicitudes.
  perform pg_temp.debe_fallar(
    format('select anular_cotizacion(%L, %L)', (select id from cotizaciones where solicitud_id = t2 and estado = 'emitida'), 'x'),
    'No existe esa cotización', 'El comisionista no anula cotizaciones');
  perform pg_temp.como('gaby@tasa.test');
  perform anular_cotizacion((select id from cotizaciones where solicitud_id = t2 and estado = 'emitida'), 'Precio equivocado');
  perform pg_temp.sistema();
  perform pg_temp.igual((select estado || '/' || estatus_publico from solicitudes where id = t2), 'solicitada/solicitada'::text,
    'Anular la cotización regresa la solicitud a "por cotizar"');

  perform pg_temp.como('xchel+ana@arqosuv.com');
  perform pg_temp.debe_fallar(format('select cancelar_mi_solicitud(%L, %L)', t1, 'x'),
    'no es tuya', 'Nadie cancela la solicitud de otro');
  perform pg_temp.debe_fallar(format('select cancelar_mi_solicitud(%L, %L)', t7, 'x'),
    'Ya se cotizó', 'Lo que ya pasó de "solicitada" no lo cancela el comisionista');
  perform pg_temp.como('xchel+beto@arqosuv.com');
  perform cancelar_mi_solicitud(t1, 'El cliente ya no lo necesita');
  perform pg_temp.igual((select estado from solicitudes where id = t1), 'cancelada'::text,
    'El comisionista cancela su solicitud mientras esté "solicitada"');

  -- Bono manual en diciembre: se anula con el contrario.
  perform pg_temp.como('xchel@arqosuv.com');
  mov := agregar_movimiento(ana, 'bono', 700, romi, null, 'Bono de diciembre');
  perform pg_temp.como('gaby@tasa.test');
  perform pg_temp.debe_fallar(format('select anular_movimiento(%L, %L)', mov, 'x'),
    'Solo admin_org', 'Finanzas no anula movimientos');
  perform pg_temp.como('xchel@arqosuv.com');
  perform anular_movimiento(mov, 'Era para otra persona');
  perform pg_temp.igual((select sum(monto) from comisiones where id = mov or anula_id = mov), 0.00::numeric,
    'Anular un bono mete su contrario: los dos suman cero y ninguno se borra');
  perform pg_temp.debe_fallar(format('select anular_movimiento(%L, %L)', mov, 'x'),
    'ya estaba anulado', 'No se anula dos veces');
  perform pg_temp.sistema();
end;
$$;

-- @@ Aislamiento entre organizaciones
-- Demo Valuadores no ve ni toca nada de XG, y al revés.
do $$
declare
  demo   uuid := (select id from organizaciones where slug = 'demo');
  t_xg   uuid := (select id from solicitudes where folio = 'MGP-2026-9006');
  p_xg   uuid := (select id from pagos where estado = 'confirmado' and organizacion_id = pg_temp.xg() limit 1);
  c_xg   uuid := (select id from cotizaciones where organizacion_id = pg_temp.xg() and estado = 'aceptada' limit 1);
  pend_xg uuid := (select id from pendientes_comision where organizacion_id = pg_temp.xg() limit 1);
  ana    uuid := (select id from personas where correo = 'xchel+ana@arqosuv.com');
  v_demo_com uuid := (select id from personas where correo = 'xchel+demo@arqosuv.com');
  orig_demo uuid := (select id from origenes_pago where organizacion_id = (select id from organizaciones where slug = 'demo') limit 1);
begin
  perform pg_temp.como('xchel+demo-admin@arqosuv.com');
  perform pg_temp.igual((select count(*) from solicitudes), 2::bigint, 'Demo ve solo sus 2 trabajos');
  perform pg_temp.igual((select count(*) from solicitudes where organizacion_id <> demo), 0::bigint, 'Ningún trabajo de XG');
  perform pg_temp.igual((select count(*) from pagos where organizacion_id <> demo), 0::bigint, 'Ningún pago de XG');
  perform pg_temp.igual((select count(*) from comisiones where organizacion_id <> demo), 0::bigint, 'Ninguna comisión de XG');
  perform pg_temp.igual((select count(*) from cierres), 0::bigint, 'Ningún cierre de XG');
  perform pg_temp.igual((select count(*) from pendientes_comision), 0::bigint, 'Ningún pendiente de XG');
  perform pg_temp.igual((select count(*) from cuentas_receptoras), 1::bigint, 'Solo su cuenta (no ve CLABEs de XG)');
  perform pg_temp.igual((select string_agg(clave, ',') from marcas), 'DV'::text, 'Solo su marca');
  perform pg_temp.igual((select count(*) from personas), 2::bigint, 'Solo las personas de su organización');
  perform pg_temp.igual((select count(*) from alertas), 0::bigint, 'Ninguna alerta de XG');
  perform pg_temp.igual((select count(*) from bitacora where organizacion_id is distinct from demo), 0::bigint,
    'Su bitácora, no la de XG');
  perform pg_temp.igual((select string_agg(slug, ',') from organizaciones), 'demo'::text, 'Solo ve su organización');
  perform pg_temp.igual((select count(*) from resumen_comisionistas()), 1::bigint, 'Su único comisionista');
  perform pg_temp.igual((select count(*) from comisiones_por_pagar()), 0::bigint, 'Ningún pendiente ajeno por pagar');

  -- Escribir sobre XG: no pasa nada o truena.
  execute format($q$update solicitudes set cliente_nombre = 'hackeado' where id = %L$q$, t_xg);
  perform pg_temp.sistema();
  perform pg_temp.igual((select cliente_nombre from solicitudes where id = t_xg), 'Sofía Lara'::text,
    'Un update a un trabajo de XG no toca nada');
  perform pg_temp.como('xchel+demo-admin@arqosuv.com');
  perform pg_temp.debe_fallar(
    format($q$insert into pagos (solicitud_id, organizacion_id, via, monto, fecha_pago, referencia, reportado_por)
              values (%L, %L, 'directo', 1, '2026-10-01', 'x', (select id from personas where correo = 'xchel+demo-admin@arqosuv.com'))$q$,
           t_xg, pg_temp.xg()),
    'row-level security', 'No registra pagos en un trabajo de XG');
  perform pg_temp.debe_fallar(
    format($q$insert into solicitudes (organizacion_id, comisionista_id, tipo, servicio_id, inmueble_direccion, cliente_nombre)
              values (%L, %L, 'cotizacion', (select id from servicios where organizacion_id = %L limit 1), 'x', 'y')$q$,
           pg_temp.xg(), ana, pg_temp.xg()),
    'row-level security', 'No crea trabajos dentro de XG');
  perform pg_temp.debe_fallar(format('select cancelar_trabajo(%L, %L)', t_xg, 'x'), 'No existe', 'No cancela trabajos de XG');
  perform pg_temp.debe_fallar(format('select revertir_pago(%L, %L)', p_xg, 'x'), 'No existe', 'No revierte pagos de XG');
  perform pg_temp.debe_fallar(format('select aceptar_cotizacion(%L)', c_xg), 'No existe', 'No acepta cotizaciones de XG');
  perform pg_temp.debe_fallar(
    format($q$select registrar_pago_comision(%L, '2026-10-01', %L, null, null, 'ninguno', null,
              jsonb_build_array(jsonb_build_object('pendiente_id', %L, 'monto', 1)))$q$, ana, orig_demo, pend_xg),
    'no es de esta organización', 'No paga pendientes de XG');

  -- Storage: solo su carpeta dentro de su organización.
  perform pg_temp.debe_fallar(
    format($q$insert into storage.objects (bucket_id, name) values ('comprobantes', %L)$q$,
           pg_temp.xg() || '/' || (select id from personas where correo = 'xchel+demo-admin@arqosuv.com') || '/x.jpg'),
    'row-level security', 'No sube archivos a la carpeta de XG');
  execute format($q$insert into storage.objects (bucket_id, name) values ('comprobantes', %L)$q$,
                 demo || '/' || (select id from personas where correo = 'xchel+demo-admin@arqosuv.com') || '/ok.jpg');
  raise notice 'ok — sube a su propia carpeta';

  perform pg_temp.como('xchel+ana@arqosuv.com');
  perform pg_temp.igual((select count(*) from storage.objects where name like demo || '/%'), 0::bigint,
    'Ana no ve archivos de Demo');
  perform pg_temp.igual((select count(*) from solicitudes where organizacion_id = demo), 0::bigint, 'Ana no ve trabajos de Demo');

  -- Las llaves compuestas: ni siquiera postgres mezcla organizaciones.
  perform pg_temp.sistema();
  perform pg_temp.debe_fallar(
    format($q$insert into solicitudes (organizacion_id, comisionista_id, tipo, servicio_id, inmueble_direccion, cliente_nombre)
              values (%L, %L, 'cotizacion', (select id from servicios where organizacion_id = %L limit 1), 'x', 'y')$q$,
           demo, v_demo_com, pg_temp.xg()),
    'foreign key', 'Un trabajo de Demo no puede usar un servicio de XG');
end;
$$;

-- @@ Una persona en dos organizaciones
do $$
declare
  demo uuid := (select id from organizaciones where slug = 'demo');
  ana  uuid := (select id from personas where correo = 'xchel+ana@arqosuv.com');
begin
  perform pg_temp.como('xchel+demo-admin@arqosuv.com');
  perform pg_temp.igual(alta_comisionista('Otra Ana', 'XCHEL+ANA@arqosuv.com', null, 'PUAA900101AB4', 'ana', null, false), ana,
    'Dar de alta un correo que ya existe reutiliza a la persona');
  perform pg_temp.como('xchel+ana@arqosuv.com');
  perform pg_temp.igual((select count(*) from mis_organizaciones()), 2::bigint, 'Ana ahora elige entre dos organizaciones');
  perform elegir_organizacion(demo);
  perform pg_temp.igual(mi_org(), demo, 'Ana cambia a Demo');
  perform pg_temp.igual((select count(*) from comisiones), 0::bigint, 'En Demo no ve sus comisiones de XG');
  perform pg_temp.igual(porcentaje_vigente(demo, ana, hoy_mx()), 12.00::numeric,
    'En Demo arranca con el piso de arranque de Demo (su segundo nivel, 12%), no con el de XG');
  perform elegir_organizacion(pg_temp.xg());
  perform pg_temp.igual((select count(*) > 0 from comisiones), true, 'De vuelta en XG ve lo suyo');

  perform pg_temp.como('xchel+demo@arqosuv.com');
  perform pg_temp.debe_fallar(format('select elegir_organizacion(%L)', pg_temp.xg()),
    'No perteneces', 'Nadie entra a una organización donde no tiene membresía');
  perform pg_temp.sistema();
end;
$$;

-- @@ Plataforma, equipo y admin de marca
do $$
declare
  demo uuid := (select id from organizaciones where slug = 'demo');
  ap73 uuid := (select id from marcas where organizacion_id = pg_temp.xg() and clave = 'AP73');
  t_mgp  uuid := (select id from solicitudes where cliente_nombre = 'Cliente Deshacer');
  nueva uuid;
begin
  -- super_plataforma entra a Demo sin ser miembro: actúa como admin_org
  -- y la bitácora lo dice.
  perform pg_temp.como('xchel@arqosuv.com');
  perform pg_temp.igual((select count(*) = (select count(*) from organizaciones where activa) from mis_organizaciones()), true,
    'La plataforma ve todas las organizaciones');
  perform elegir_organizacion(demo);
  perform pg_temp.igual(mi_rol(), 'admin_org'::text, 'En Demo actúa como admin_org');
  update ajustes set dia_limite_pago_comision = 12;
  perform pg_temp.igual(
    (select rol from bitacora where tabla = 'ajustes' and organizacion_id = demo order by id desc limit 1),
    'super_plataforma'::text, 'La bitácora registra que fue la plataforma');
  nueva := crear_organizacion('Otra Org', 'otra-org', 'OTR', 'Admin Otra', 'admin@otra.test');
  perform pg_temp.igual((select count(*) from niveles where organizacion_id = nueva), 0::bigint,
    'Desde Demo no ve los niveles de la organización nueva');
  perform elegir_organizacion(pg_temp.xg());

  perform pg_temp.como('xchel+demo-admin@arqosuv.com');
  perform pg_temp.debe_fallar($q$select crear_organizacion('X', 'x', 'XX', 'x', 'x@x.test')$q$,
    'Solo la plataforma', 'Un admin_org no da de alta organizaciones');
  perform pg_temp.sistema();
  perform pg_temp.igual((select count(*) from niveles where organizacion_id = nueva), 5::bigint,
    'La organización nueva nace con sus niveles, ajustes y conector manual');

  -- admin_marca de AP73 en XG.
  perform pg_temp.como('xchel@arqosuv.com');
  perform alta_membresia('Admin AP73', 'verifica-ap73@tasa.test', 'admin_marca', array[ap73]);
  perform pg_temp.debe_fallar($q$select alta_membresia('X', 'x@x.test', 'admin_marca', '{}')$q$,
    'al menos una marca', 'admin_marca sin marca no se puede');
  perform pg_temp.sistema();
  insert into auth.users (id, email) values (gen_random_uuid(), 'verifica-ap73@tasa.test');

  perform pg_temp.como('verifica-ap73@tasa.test');
  perform pg_temp.igual((select bool_and(marca_id = ap73) from solicitudes), true, 'admin_marca ve solo trabajos de su marca');
  perform pg_temp.igual((select count(*) > 0 from solicitudes), true, 'Y sí los ve');
  perform pg_temp.igual((select count(*) from cierres), 0::bigint, 'Sin cierres');
  perform pg_temp.igual((select count(*) from pendientes_comision), 0::bigint, 'Sin pendientes de comisión');
  perform pg_temp.igual((select count(*) from pagos_comision), 0::bigint, 'Sin pagos de comisión');
  perform pg_temp.igual((select count(*) from bitacora), 0::bigint, 'Sin bitácora');
  perform pg_temp.igual(
    (select coalesce(bool_and(c.cuenta_receptora_id in (select id from cuentas_receptoras where marca_id = ap73)), true)
       from comisiones c),
    true, 'Comisiones solo de su marca');
  perform pg_temp.igual((select count(*) > 0 and bool_and(saldo_por_pagar is null) from resumen_comisionistas()), true,
    'Ve a los comisionistas, sin el saldo por pagar (mezcla marcas)');
  perform pg_temp.debe_fallar(format('select cambiar_estatus_manual(%L, %L)', t_mgp, 'en_revision'),
    'el admin de la marca', 'No cambia el estatus de un trabajo de otra marca');

  -- Estatus a mano (conector manual).
  perform pg_temp.como('xchel@arqosuv.com');
  perform cambiar_estatus_manual(t_mgp, 'en_revision');
  perform pg_temp.igual((select estatus_publico from solicitudes where id = t_mgp), 'en_revision'::text,
    'admin_org mueve el estatus a mano');
  perform pg_temp.igual((select count(*) from historial_estatus where solicitud_id = t_mgp and estatus_publico = 'en_revision'),
    1::bigint, 'El historial lo anota');
  perform pg_temp.debe_fallar(format('select cambiar_estatus_manual(%L, %L)', t_mgp, 'pagado'),
    'no se pone a mano', '"Pagado" no se pone a mano');
  perform activar_conector('notion');
  perform pg_temp.debe_fallar(format('select cambiar_estatus_manual(%L, %L)', t_mgp, 'entregado'),
    'lo lee el conector', 'Con conector externo el estatus no se mueve a mano');
  perform activar_conector('manual');
  perform pg_temp.sistema();
end;
$$;

-- @@ Conectores y credenciales
do $$
declare
  manual uuid := 'a0000000-0000-4000-8000-0000000000c1';
  notion uuid := 'a0000000-0000-4000-8000-0000000000c2';
begin
  perform pg_temp.como('xchel@arqosuv.com');
  perform pg_temp.debe_fallar(format('select guardar_credencial_conector(%L, %L)', manual, 'x'),
    'no usa credencial', 'El conector manual no lleva credencial');
  perform guardar_credencial_conector(notion, 'secret_abc');
  perform pg_temp.igual((select credencial_guardada_en is not null from conectores where id = notion), true,
    'admin_org guarda la credencial');
  perform pg_temp.debe_fallar($q$select decrypted_secret from vault.decrypted_secrets$q$, 'permission denied',
    'Nadie con sesión lee Vault');
  perform pg_temp.debe_fallar(format('select credencial_conector(%L)', notion), 'permission denied',
    'Nadie con sesión descifra la credencial');
  perform pg_temp.debe_fallar(format($q$update conectores set credencial_id = null where id = %L$q$, notion),
    'permission denied', 'La credencial no se toca por la tabla');
  update conectores set configuracion = '{"base_de_datos": "abc", "valor_cancelado": "Cancelado"}' where id = notion;
  perform pg_temp.igual((select configuracion->>'base_de_datos' from conectores where id = notion), 'abc'::text,
    'admin_org edita la configuración');
  perform guardar_credencial_conector(notion, 'secret_nuevo');

  perform pg_temp.sistema();
  perform pg_temp.igual(credencial_conector(notion), 'secret_nuevo'::text, 'Solo el sistema la descifra, y se reemplaza');

  perform pg_temp.como('xchel+demo-admin@arqosuv.com');
  perform pg_temp.debe_fallar(format('select guardar_credencial_conector(%L, %L)', notion, 'x'),
    'No existe', 'Otra organización no toca el conector de XG');
  perform pg_temp.debe_fallar(format('select registrar_error_conector(%L, %L, %L)', notion, 'otro', 'x'),
    'Solo admin_org', 'Ni registra errores en él');

  -- Un error nunca es silencioso: estado "error" y una alerta.
  perform pg_temp.como('xchel@arqosuv.com');
  perform registrar_error_conector(notion, 'propiedad_no_encontrada', 'No existe la propiedad "Etapa"');
  perform registrar_error_conector(notion, 'propiedad_no_encontrada', 'No existe la propiedad "Etapa"');
  perform pg_temp.igual((select estado from conectores where id = notion), 'error'::text, 'El conector queda en error');
  perform pg_temp.igual((select count(*) from alertas where conector_id = notion and resuelta_en is null), 1::bigint,
    'Una alerta para admin_org, sin duplicarse');
  perform registrar_sync_ok(notion);
  perform pg_temp.igual((select estado || '/' || (select count(*) from alertas where conector_id = notion and resuelta_en is null)
                           from conectores where id = notion), 'activo/0'::text,
    'El siguiente sync bueno lo deja activo y cierra la alerta');
  perform pg_temp.sistema();
end;
$$;

-- @@ Deshacer por rol y eventos del trabajo
-- Hoy: 5 de diciembre. Un trabajo de AP73 y uno de MGP pagados en diciembre.
do $$
declare
  carla uuid := (select id from personas where correo = 'xchel+carla@arqosuv.com');
  ap73  uuid := (select id from marcas where organizacion_id = pg_temp.xg() and clave = 'AP73');
  mgp   uuid := (select id from marcas where organizacion_id = pg_temp.xg() and clave = 'MGP');
  banregio uuid := (select id from cuentas_receptoras where organizacion_id = pg_temp.xg() and alias = 'Banregio AP73');
  romi  uuid := (select id from cuentas_receptoras where organizacion_id = pg_temp.xg() and alias = 'ROMI');
  serv  uuid := (select id from servicios where organizacion_id = pg_temp.xg() and nombre = 'Avalúo Comercial');
  s_ap73 uuid; s_mgp uuid; p_ap73 uuid; p_mgp uuid;
begin
  insert into solicitudes (comisionista_id, tipo, origen, servicio_id, inmueble_direccion, cliente_nombre,
                           marca_id, cuenta_receptora_id, monto_honorarios, estado, estatus_publico, aceptada_en)
  values (carla, 'tramite_directo', 'admin', serv, 'Calle AP73', 'Cliente AP73', ap73, banregio, 5000,
          'tramite', 'entregado', now()) returning id into s_ap73;
  insert into solicitudes (comisionista_id, tipo, origen, servicio_id, inmueble_direccion, cliente_nombre,
                           marca_id, cuenta_receptora_id, monto_honorarios, estado, estatus_publico, aceptada_en)
  values (carla, 'tramite_directo', 'admin', serv, 'Calle MGP', 'Cliente MGP', mgp, romi, 5000,
          'tramite', 'entregado', now()) returning id into s_mgp;
  insert into pagos (solicitud_id, via, monto, fecha_pago, referencia) values (s_ap73, 'directo', 5000, '2026-12-02', 'ap73')
  returning id into p_ap73;
  insert into pagos (solicitud_id, via, monto, fecha_pago, referencia, reportado_por) values (s_mgp, 'directo', 5000, '2026-12-02', 'mgp', carla)
  returning id into p_mgp;
  update pagos set estado = 'confirmado' where id in (p_ap73, p_mgp);

  perform pg_temp.como('verifica-ap73@tasa.test');
  perform pg_temp.igual((select count(*) > 0 from meses_cerrados()), true, 'admin_marca sabe qué meses están cerrados');
  perform pg_temp.debe_fallar(format('select revertir_pago(%L, %L)', p_mgp, 'x'),
    'No existe', 'admin_marca no revierte pagos de otra marca');
  perform revertir_pago(p_ap73, 'Era de otro cliente');
  perform pg_temp.igual((select estado from pagos where id = p_ap73), 'reportado'::text,
    'admin_marca revierte la confirmación de un pago de su marca');
  perform pg_temp.igual((select count(*) from comisiones where solicitud_id = s_ap73), 0::bigint,
    'Y la comisión que había devengado se revierte');
  perform pg_temp.igual(
    (select accion || ': ' || motivo from eventos_trabajo where solicitud_id = s_ap73),
    'revertir_confirmacion: Era de otro cliente'::text, 'El historial del trabajo anota la reversión con su motivo');
  update pagos set estado = 'confirmado' where id = p_ap73;
  perform pg_temp.igual((select count(*) from comisiones where solicitud_id = s_ap73), 1::bigint,
    'Desde "por confirmar" se vuelve a confirmar y la comisión se devenga otra vez');

  perform pg_temp.como('gaby@tasa.test');
  perform revertir_pago(p_mgp, 'Confirmado por error');
  perform pg_temp.igual((select estado from pagos where id = p_mgp), 'reportado'::text, 'Finanzas revierte pagos de clientes');
  perform pg_temp.igual((select count(*) from eventos_trabajo where solicitud_id = s_mgp), 1::bigint,
    'Finanzas ve el historial del trabajo');

  perform pg_temp.como('xchel+carla@arqosuv.com');
  perform pg_temp.igual((select count(*) from eventos_trabajo), 0::bigint,
    'El comisionista no ve el historial interno de deshacer');
  perform retirar_pago(p_mgp, 'Lo reporté mal');
  perform pg_temp.sistema();
  perform pg_temp.igual((select accion from eventos_trabajo where solicitud_id = s_mgp order by creado_en desc limit 1),
    'retirar_pago'::text, 'Retirar un pago también queda en el historial del trabajo');
end;
$$;

-- @@ Cron: qué se crea en el conector externo
-- Solo lo aceptado después de activar el conector, y nunca dos veces.
do $$
declare
  notion uuid := 'a0000000-0000-4000-8000-0000000000c2';
  carla  uuid := (select id from personas where correo = 'xchel+carla@arqosuv.com');
  mgp    uuid := (select id from marcas where organizacion_id = pg_temp.xg() and clave = 'MGP');
  romi   uuid := (select id from cuentas_receptoras where organizacion_id = pg_temp.xg() and alias = 'ROMI');
  serv   uuid := (select id from servicios where organizacion_id = pg_temp.xg() and nombre = 'Avalúo Comercial');
  s      uuid;
begin
  perform pg_temp.como('xchel@arqosuv.com');
  perform activar_conector('notion');
  perform pg_temp.debe_fallar(format('select * from reclamar_por_crear(%L)', notion), 'permission denied',
    'Con sesión nadie reclama trámites del cron');
  perform pg_temp.sistema();

  perform pg_temp.igual((select count(*) from conectores_para_sincronizar() where id = notion), 1::bigint,
    'Notion activo y con credencial entra al cron');
  perform pg_temp.igual((select mapeo_campos->>'titulo' from conectores where id = notion), 'Projects'::text,
    'El título de la base de Trámites se llama "Projects"');

  insert into solicitudes (comisionista_id, tipo, origen, servicio_id, inmueble_direccion, cliente_nombre,
                           marca_id, cuenta_receptora_id, monto_honorarios, monto_terceros, estado, estatus_publico, aceptada_en)
  values (carla, 'tramite_directo', 'admin', serv, 'Calle Notion 1', 'Cliente Notion', mgp, romi, 9000, 1200,
          'tramite', 'aceptada', now()) returning id into s;
  perform pg_temp.igual((select folio from solicitudes where id = s), null::text,
    'Con conector externo Tasa ya no pone folio');

  perform pg_temp.igual((select string_agg(cliente_nombre, ',') from reclamar_por_crear(notion)), 'Cliente Notion'::text,
    'Solo se reclama lo aceptado después de activar (los trabajos de prueba viejos no suben)');
  perform pg_temp.igual((select count(*) from reclamar_por_crear(notion)), 0::bigint,
    'Lo reclamado no se vuelve a reclamar mientras se crea (sin duplicados)');
  perform liberar_por_crear(notion, s);
  perform pg_temp.igual((select coalesce(servicio, '(sin tipo)') from reclamar_por_crear(notion)), '(sin tipo)'::text,
    'Sin nombre en Notion, el servicio no manda Tipo de Trámite (no crea opciones nuevas)');
  perform liberar_por_crear(notion, s);
  update servicios set nombre_notion = 'Avalúo Comercial' where id = serv;
  perform pg_temp.igual((select monto_honorarios || '/' || monto_terceros || '/' || servicio from reclamar_por_crear(notion)),
    '9000.00/1200.00/Avalúo Comercial'::text, 'Si falló, se libera y trae los datos, con el nombre en Notion del servicio');
  perform registrar_registro_externo(notion, s, 'pagina-notion-1');
  perform liberar_por_crear(notion, s);
  perform pg_temp.igual((select count(*) from reclamar_por_crear(notion)), 0::bigint,
    'Con su registro externo ya no se vuelve a crear');
  perform pg_temp.igual(registrar_lectura(notion, 'pagina-notion-1', 'MGP-2026-0700 Cliente Notion', 'En proceso', null),
    'actualizado'::text, 'Y desde ahí se lee: folio y etapa');
  perform pg_temp.igual((select folio || '/' || estatus_publico from solicitudes where id = s), 'MGP-2026-0700/en_elaboracion'::text,
    'Folio del título y etapa traducida');

  perform pg_temp.como('xchel@arqosuv.com');
  perform activar_conector('manual');
  perform pg_temp.sistema();
  perform pg_temp.igual((select count(*) from conectores_para_sincronizar() where id = notion), 0::bigint,
    'Apagado, el cron ya no lo corre');
end;
$$;

-- @@ CLABE, términos y número de cotización
do $$
declare
  mgp  uuid := (select id from marcas where organizacion_id = pg_temp.xg() and clave = 'MGP');
  t2   uuid := (select id from solicitudes where cliente_nombre = 'Laura Méndez');
  romi uuid := (select id from cuentas_receptoras where organizacion_id = pg_temp.xg() and alias = 'ROMI');
  v    integer;
begin
  -- CLABE: el dígito de control lo revisa la base.
  perform pg_temp.igual(clabe_valida('699180600008088771'), true, 'Una CLABE real pasa el dígito de control');
  perform pg_temp.igual(clabe_valida('699180600008088772'), false, 'Con el último dígito mal, no pasa');
  perform pg_temp.como('xchel@arqosuv.com');
  perform pg_temp.debe_fallar(
    format($q$insert into cuentas_receptoras (titular, clabe, marca_id, alias) values ('X', '000000000000000001', %L, 'Mala')$q$, mgp),
    'cuentas_clabe_valida', 'La base no acepta una CLABE con el dígito de control mal');
  perform pg_temp.igual((select count(*) from cuentas_receptoras where clabe = '000000000000000001'), 0::bigint,
    'Las cuentas de relleno sin uso ya no existen');

  -- Términos.
  update ajustes set terminos = 'Tu cuenta es personal e intransferible.';
  select terminos_version into v from ajustes;
  perform pg_temp.igual(v, 1, 'Publicar términos crea la versión 1');
  perform pg_temp.igual(debo_aceptar_terminos(), false, 'El staff no los acepta');
  perform pg_temp.como('xchel+ana@arqosuv.com');
  perform pg_temp.igual(debo_aceptar_terminos(), true, 'El comisionista tiene que aceptarlos');
  perform pg_temp.igual((mi_sesion()->>'debe_aceptar_terminos')::boolean, true, 'La sesión lo dice (la app lo manda a aceptar)');
  perform pg_temp.debe_fallar('select aceptar_terminos(7)', 'cambiaron', 'No se acepta una versión que no es la vigente');
  perform aceptar_terminos(1);
  perform pg_temp.igual(debo_aceptar_terminos(), false, 'Aceptados, ya no se le piden');
  perform pg_temp.como('xchel@arqosuv.com');
  update ajustes set terminos = 'Tu cuenta es personal e intransferible. Nueva cláusula.';
  perform pg_temp.igual((select count(*) from aceptaciones_terminos where version = 1), 1::bigint,
    'El staff ve quién aceptó y cuándo');
  perform pg_temp.como('xchel+ana@arqosuv.com');
  perform pg_temp.igual(debo_aceptar_terminos(), true, 'Si el texto cambia, hay que volver a aceptar');
  perform pg_temp.debe_fallar($q$insert into aceptaciones_terminos (persona_id, version) values (mi_persona_id(), 2)$q$,
    'permission denied', 'Nadie se marca como aceptado por la tabla');

  -- Número de cotización: AAMMDD-T#, consecutivo del día.
  perform pg_temp.sistema();
  update solicitudes set estado = 'solicitada', estatus_publico = 'solicitada' where id = t2;
  insert into cotizaciones (solicitud_id, monto_honorarios, cuenta_receptora_id, vigente_hasta)
  values (t2, 5000, romi, hoy_mx() + 30);
  perform pg_temp.igual(
    (select numero ~ ('^' || to_char(hoy_mx(), 'YYMMDD') || '-T[0-9]+$') from cotizaciones where solicitud_id = t2 and estado = 'emitida'),
    true, 'La cotización nace con número AAMMDD-T#');
  perform pg_temp.igual((select count(*) = count(distinct numero) from cotizaciones where organizacion_id = pg_temp.xg()), true,
    'Ningún número se repite');
end;
$$;

-- @@ Tasa de bienvenida, arranque y Élite que vence
-- Cada "cierre" se simula guardando el nivel que calcula la base para
-- ese mes, en orden, como lo hace la aprobación del cierre.
create function pg_temp.cerrar_nivel(p_com uuid, p_mes date) returns text language plpgsql as $$
declare
  n record;
begin
  select * into n from calcular_nivel(pg_temp.xg(), p_com, p_mes);
  insert into niveles_mensuales (organizacion_id, comisionista_id, mes, nivel_id, porcentaje, promedio, meses_considerados, motivo)
  values (pg_temp.xg(), p_com, p_mes, n.nivel_id, n.porcentaje, n.promedio, n.meses_considerados, n.motivo)
  on conflict (organizacion_id, comisionista_id, mes) do update
     set nivel_id = excluded.nivel_id, porcentaje = excluded.porcentaje, promedio = excluded.promedio,
         meses_considerados = excluded.meses_considerados, motivo = excluded.motivo;
  return to_char(p_mes, 'MM') || '=' || n.porcentaje || ' ' || n.motivo;
end;
$$;

do $$
declare
  nora  uuid;
  nico  uuid;
  ana   uuid := (select id from personas where correo = 'xchel+ana@arqosuv.com');
  carla uuid := (select id from personas where correo = 'xchel+carla@arqosuv.com');
  plus  uuid := (select id from niveles where organizacion_id = pg_temp.xg() and nombre = 'Socio Plus');
  serie text;
begin
  -- Alta con bienvenida: 3 meses desde el mes del alta, en Socio Plus.
  perform pg_temp.como('xchel@arqosuv.com');
  perform elegir_organizacion(pg_temp.xg());
  nora := alta_comisionista('Nora Bienvenida', 'nora@tasa.test', null, pg_temp.rfc('NOBI900101AB'), 'nora-bienvenida', null, false, true, 3);
  perform pg_temp.igual((select trato_inicial || ' ' || trato_desde || '→' || trato_hasta from comisionistas where persona_id = nora),
    'bienvenida ' || mes_de(hoy_mx()) || '→' || ((mes_de(hoy_mx()) + interval '3 months')::date - 1),
    'El alta con bienvenida guarda inicio y fin (último día del tercer mes)');
  perform pg_temp.igual((select trato_nivel_id from comisionistas where persona_id = nora), plus, 'La bienvenida es Socio Plus');
  perform pg_temp.igual(porcentaje_vigente(pg_temp.xg(), nora, hoy_mx()), 15.00::numeric,
    'Desde el primer día cobra 15% (provisional, sin esperar cierre)');

  -- Alta sin bienvenida: arranque.
  nico := alta_comisionista('Nico Nuevo', 'nico@tasa.test', null, pg_temp.rfc('NINU900101AB'), 'nico-nuevo', null, false);
  perform pg_temp.igual((select trato_inicial from comisionistas where persona_id = nico), 'arranque',
    'Sin bienvenida, el alta nace con arranque');
  perform pg_temp.igual(porcentaje_vigente(pg_temp.xg(), nico, hoy_mx()), 10.00::numeric,
    'El nuevo arranca en Aliado 10%, no en Enlace 5%');

  -- Finanzas no cambia la cantidad de meses: usa la de la organización.
  perform pg_temp.como('gaby@tasa.test');
  perform poner_trato_inicial(nico, 'bienvenida', 9, hoy_mx());
  perform pg_temp.igual((select trato_hasta from comisionistas where persona_id = nico),
    ((mes_de(hoy_mx()) + interval '3 months')::date - 1), 'Finanzas pide 9 meses y quedan los 3 de la organización');
  perform pg_temp.como('xchel@arqosuv.com');
  perform poner_trato_inicial(nico, 'arranque', null, hoy_mx());

  -- Las fechas se fijan para que la serie no dependa de hoy.
  perform pg_temp.sistema();
  update comisionistas set fecha_alta = '2026-06-01', trato_desde = '2026-06-01', trato_hasta = '2026-08-31'
   where persona_id = nora;
  update comisionistas set fecha_alta = '2026-09-01', trato_desde = '2026-09-01', trato_hasta = '2026-10-31'
   where persona_id = nico;

  -- 1. Bienvenida 3 meses, sin volumen: baja de a un nivel por cierre.
  select string_agg(pg_temp.cerrar_nivel(nora, m::date), ' ' order by m) into serie
    from generate_series('2026-06-01'::date, '2026-12-01', interval '1 month') m;
  perform pg_temp.igual(serie,
    '06=15.00 bienvenida 07=15.00 bienvenida 08=15.00 bienvenida 09=12.50 escalon 10=10.00 escalon 11=5.00 promedio 12=5.00 promedio',
    'Bienvenida jun–ago; luego 12.5 → 10 → su nivel real (5%), un escalón por cierre');

  -- 3. Nuevo sin bienvenida: Aliado sus 2 primeros meses, luego la escalera normal (sin escalones).
  select string_agg(pg_temp.cerrar_nivel(nico, m::date), ' ' order by m) into serie
    from generate_series('2026-09-01'::date, '2026-11-01', interval '1 month') m;
  perform pg_temp.igual(serie, '09=10.00 arranque 10=10.00 arranque 11=5.00 promedio',
    'Arranque sep–oct en 10%; en noviembre baja directo a su nivel real');

  -- 2. Volumen alto durante la bienvenida: sube de inmediato. Para que
  -- haya algo arriba de 15% se agrega un nivel de 18%.
  insert into niveles (organizacion_id, nombre, orden, umbral_minimo, porcentaje)
  values (pg_temp.xg(), 'Diamante', 9, 35000, 18.00);
  update comisionistas set trato_inicial = 'bienvenida', trato_nivel_id = plus,
         trato_desde = '2026-06-01', trato_hasta = '2026-08-31'
   where persona_id = ana and organizacion_id = pg_temp.xg();
  select string_agg(pg_temp.cerrar_nivel(ana, m::date), ' ' order by m) into serie
    from generate_series('2026-07-01'::date, '2026-10-01', interval '1 month') m;
  perform pg_temp.igual(serie, '07=18.00 promedio 08=15.00 bienvenida 09=12.50 escalon 10=10.00 escalon',
    'Ana: en julio su promedio (36,000) la sube a 18% antes de terminar la bienvenida; agosto vuelve al piso; luego escalones');
  perform pg_temp.igual(porcentaje_es_provisional(pg_temp.xg(), ana, '2026-10-15'), false, 'Con nivel del mes ya no es provisional');

  -- 4. Élite con vencimiento: manda hasta el mes del vencimiento, después vuelve el promedio.
  update comisionistas set porcentaje_forzado = 20, elite_vence = '2026-11-30'
   where persona_id = carla and organizacion_id = pg_temp.xg();
  perform pg_temp.igual((select porcentaje || ' ' || motivo from calcular_nivel(pg_temp.xg(), carla, '2026-11-01')),
    '20.00 elite', 'Élite vigente en noviembre (vence el 30)');
  perform pg_temp.igual((select motivo from calcular_nivel(pg_temp.xg(), carla, '2026-12-01')), 'promedio',
    'En diciembre el Élite ya venció: nivel por promedio');
  perform pg_temp.igual(porcentaje_vigente(pg_temp.xg(), carla, '2026-11-20') = 20, true, 'Noviembre se paga al 20%');
  perform pg_temp.igual(porcentaje_vigente(pg_temp.xg(), carla, '2026-12-05') < 20, true, 'Diciembre ya no');
  perform pg_temp.igual(porcentaje_es_provisional(pg_temp.xg(), carla, '2027-03-05'), true,
    'Vencido el Élite, en un mes sin cierre la comisión vuelve a nacer provisional');

  perform pg_temp.como('xchel@arqosuv.com');
  perform pg_temp.debe_fallar(format('select forzar_elite(%L, 20, %L)', carla, '2020-01-01'), 'anterior a hoy',
    'El Élite no se pone ya vencido');
  perform pg_temp.debe_fallar(format('select forzar_elite(%L, 31)', carla), 'check',
    'El Élite tampoco pasa del tope de 30%');
  perform forzar_elite(carla, null);
  perform pg_temp.igual((select elite_vence from comisionistas where persona_id = carla), null::date,
    'Quitar el Élite borra también su vencimiento');

  perform pg_temp.como('xchel+ana@arqosuv.com');
  perform pg_temp.igual(mi_trato()->>'trato', 'bienvenida', 'El comisionista ve su propio trato');
  perform pg_temp.debe_fallar(format('select poner_trato_inicial(%L, %L, 3, null)', ana, 'bienvenida'), 'Solo finanzas',
    'Un comisionista no se pone la bienvenida solo');
end;
$$;

-- @@ Alta por solicitud
do $$
declare
  xg      uuid := pg_temp.xg();
  ana     uuid := (select id from personas where correo = 'xchel+ana@arqosuv.com');
  gaby    uuid := (select id from personas where correo = 'gaby@tasa.test');
  xchel   uuid := (select id from personas where correo = 'xchel@arqosuv.com');
  v_aviso integer;
  sol     uuid;
  sol2    uuid;
  sol3    uuid;
  cap     uuid;
  nueva   uuid;
  sin_csf uuid;
  solo_curp uuid;
  n_personas bigint;
  cod_ana text := (select codigo_referido from comisionistas where persona_id = (select id from personas where correo = 'xchel+ana@arqosuv.com') and organizacion_id = 'a0000000-0000-4000-8000-000000000001');
  i       integer;
begin
  perform pg_temp.sistema();
  -- RFC: los tres de las cuentas receptoras de producción pasan.
  perform pg_temp.igual(rfc_valido('CHC2206204P2') and rfc_valido('PUSA8705253C3') and rfc_valido('GUSM840104GU9'), true,
    'RFC reales (empresa y persona) pasan el dígito verificador');
  perform pg_temp.igual(rfc_valido('GUSM840104GU8'), false, 'Con el último carácter mal, no pasa');

  update ajustes set aviso_privacidad = 'Aviso de prueba.', contacto_soporte = 'soporte@xgplataform.com' where organizacion_id = xg;
  select aviso_version into v_aviso from ajustes where organizacion_id = xg;
  perform pg_temp.igual(v_aviso > 0, true, 'Publicar el aviso le da versión');

  -- Sin sesión ----------------------------------------------------------
  perform pg_temp.como(null);
  perform pg_temp.igual((datos_alta_publica('xg')->>'aviso_version')::integer, v_aviso, 'La pantalla pública sabe qué aviso mostrar');
  perform pg_temp.igual(aviso_privacidad_publico()->>'slug', 'xg'::text, '/privacidad sin organización muestra el aviso de XG');
  perform pg_temp.debe_fallar(
    format($q$select pedir_alta('xg', 'Rita', 'rita@tasa.test', '4421112233', 'GUXD800101AB1', null, null, %s, 'ip1', true)$q$, v_aviso),
    'Revisa tu RFC. Si está bien escrito, escríbenos a soporte@xgplataform.com', 'Un RFC con el dígito mal se rechaza con mensaje claro');
  perform pg_temp.debe_fallar(
    format($q$select pedir_alta('xg', 'Rita', 'rita@tasa.test', '4421112233', 'GUX800101', null, null, %s, 'ip1', true)$q$, v_aviso),
    'formato', 'Un RFC con el formato mal se rechaza');
  perform pg_temp.debe_fallar(
    $q$select pedir_alta('xg', 'Rita', 'rita@tasa.test', '4421112233', 'GUXD800101AB3', null, null, 999, 'ip1', true)$q$,
    'aviso de privacidad cambió', 'Sin aceptar el aviso vigente no hay solicitud');

  sol := pedir_alta('xg', 'Rita Solicitud', 'Rita@tasa.test', '(442) 111-22-33', 'guxd 800101 ab3', null, cod_ana, v_aviso, 'ip1', true);
  perform pg_temp.debe_fallar('select count(*) from solicitudes_alta', 'permission denied', 'anon no lee solicitudes');
  perform pg_temp.debe_fallar(format('select aprobar_alta(%L, %L, false, false, null, false)', sol, 'x'),
    'permission denied', 'anon no aprueba');
  insert into storage.objects (bucket_id, name) values ('altas', xg || '/' || sol || '/csf.pdf');
  perform pg_temp.debe_fallar(
    format($q$insert into storage.objects (bucket_id, name) values ('altas', %L)$q$, xg || '/' || gen_random_uuid() || '/csf.pdf'),
    'row-level security', 'anon no sube una CSF a una solicitud que no existe');
  perform confirmar_alta(sol);
  perform pg_temp.debe_fallar(
    format($q$insert into storage.objects (bucket_id, name) values ('altas', %L)$q$, xg || '/' || sol || '/csf.pdf'),
    'row-level security', 'Ni a una que ya no está subiendo');

  sol2 := pedir_alta('xg', 'Ana Repetida', 'otra.ana@tasa.test', '4421112234', 'PUAA900101AB4', null, null, v_aviso, 'ip2', true);
  insert into storage.objects (bucket_id, name) values ('altas', xg || '/' || sol2 || '/csf.pdf');
  perform confirmar_alta(sol2);

  for i in 1..5 loop
    perform pedir_alta('xg', 'Bot ' || i, 'bot' || i || '@tasa.test', '4421112299', 'GUXD800101AB3', null, null, v_aviso, 'ip3', true);
  end loop;
  perform pg_temp.debe_fallar(
    format($q$select pedir_alta('xg', 'Bot 6', 'bot6@tasa.test', '4421112299', 'GUXD800101AB3', null, null, %s, 'ip3', true)$q$, v_aviso),
    'demasiadas solicitudes', 'Más de 5 solicitudes desde la misma IP en un día no pasan');

  perform pg_temp.sistema();
  perform pg_temp.igual(
    (select estado || ' ' || correo || ' ' || telefono || ' ' || rfc || ' ' || (referidor_id = ana) || ' ' || (aviso_version = v_aviso)
       from solicitudes_alta where id = sol),
    'pendiente rita@tasa.test 4421112233 GUXD800101AB3 true true'::text,
    'La solicitud queda pendiente, con datos limpios, su referidor y el aviso que aceptó');
  perform pg_temp.igual((select csf_ruta from solicitudes_alta where id = sol), xg || '/' || sol || '/csf.pdf',
    'Queda con su CSF');
  perform pg_temp.igual((select posible_duplicado and coincidencias[1] like 'RFC de Ana Prueba%' from solicitudes_alta where id = sol2), true,
    'El RFC de un comisionista activo la marca "posible duplicado"');

  -- Finanzas captura, no decide ----------------------------------------------
  perform pg_temp.como('gaby@tasa.test');
  cap := capturar_alta('Toño Captura', 'tono@tasa.test', '4421112235', 'GUXD800101AB1', null, null, true);
  insert into storage.objects (bucket_id, name) values ('altas', xg || '/' || cap || '/csf.pdf');
  perform confirmar_alta(cap);
  perform pg_temp.igual(
    (select estado || ' ' || rfc_por_revisar || ' ' || (capturada_por = gaby) || ' ' || (aviso_version is null)
       from solicitudes_alta where id = cap),
    'pendiente true true true'::text, 'Finanzas captura: pendiente, "capturada por", "RFC por revisar" y sin aviso');
  perform pg_temp.igual((select count(*) from solicitudes_alta where estado = 'pendiente'), 3::bigint,
    'Finanzas ve la bandeja');
  perform pg_temp.igual((select count(*) from storage.objects where bucket_id = 'altas') > 0, true, 'Finanzas ve las CSF');
  perform pg_temp.debe_fallar(format('select aprobar_alta(%L, %L, false, false, null, true)', cap, 'tono'),
    'Solo admin_org', 'Finanzas no aprueba');
  perform pg_temp.debe_fallar(format('select rechazar_alta(%L, null)', cap), 'Solo admin_org', 'Finanzas no rechaza');

  perform pg_temp.como('xchel+ana@arqosuv.com');
  perform pg_temp.igual((select count(*) from solicitudes_alta), 0::bigint, 'Un comisionista no ve solicitudes');
  perform pg_temp.igual((select count(*) from storage.objects where bucket_id = 'altas'), 0::bigint, 'Ni las CSF');
  insert into storage.objects (bucket_id, name) values ('altas', xg || '/' || ana || '/csf-ana.pdf');
  perform subir_mi_csf(xg || '/' || ana || '/csf-ana.pdf');
  perform pg_temp.debe_fallar(format('select subir_mi_csf(%L)', xg || '/' || gaby || '/otra.pdf'),
    'No llegó', 'Solo registra una CSF suya que sí subió');

  -- admin_org decide ------------------------------------------------------------
  perform pg_temp.como('xchel@arqosuv.com');
  perform elegir_organizacion(xg);
  perform pg_temp.debe_fallar(format('select aprobar_alta(%L, %L, false, false, null, false)', cap, 'tono-captura'),
    'RFC revisado a mano', 'Con el dígito mal no se aprueba sin "RFC revisado a mano"');
  perform aprobar_alta(cap, 'tono-captura', false, false, null, true);
  perform pg_temp.igual(
    (select c.rfc_revisado_a_mano and c.csf_ruta is not null from comisionistas c join personas p on p.id = c.persona_id
      where p.correo = 'tono@tasa.test' and c.organizacion_id = xg),
    true, 'admin_org lo aprueba con "RFC revisado a mano" y su CSF');
  perform pg_temp.igual(
    (select count(*) from bitacora where tabla = 'solicitudes_alta' and accion = 'UPDATE' and persona_id = xchel
        and (despues->>'rfc_revisado_a_mano')::boolean and despues->>'rfc' = 'GUXD800101AB1'),
    1::bigint, 'Queda en bitácora quién, cuándo y qué RFC');

  nueva := aprobar_alta(sol, 'rita-solicitud', true, false, null, false);
  perform pg_temp.igual(
    (select m.rol || ' ' || (c.referido_por = ana) || ' ' || c.trato_inicial || ' ' || c.emite_factura
       from comisionistas c join membresias m on m.persona_id = c.persona_id and m.organizacion_id = c.organizacion_id
      where c.persona_id = nueva and c.organizacion_id = xg),
    'comisionista true arranque true'::text, 'Aprobar crea persona, membresía y comisionista con su referidor y su trato');
  perform pg_temp.igual((select estado || ' ' || (persona_id = nueva) || ' ' || (decidida_por = xchel) from solicitudes_alta where id = sol),
    'aprobada true true'::text, 'La solicitud queda aprobada, con quién decidió');

  select count(*) into n_personas from personas;
  perform rechazar_alta(sol2, 'Ya está dado de alta con otro correo.');
  perform pg_temp.igual((select count(*) from personas), n_personas, 'Rechazar no crea a nadie');
  perform pg_temp.igual((select estado || ' ' || motivo from solicitudes_alta where id = sol2),
    'rechazada Ya está dado de alta con otro correo.'::text, 'Queda rechazada con su motivo');
  perform pg_temp.debe_fallar(format('select aprobar_alta(%L, %L, false, false, null, false)', sol2, 'ana-repetida'),
    'ya no está pendiente', 'Una rechazada ya no se aprueba');

  -- CSF opcional y RFC o CURP (0025) ----------------------------------------------
  perform pg_temp.como(null);
  sin_csf := pedir_alta('xg', 'Sin Constancia', 'sincsf@tasa.test', '4421112240', 'GUXD800101AB3', null, null, v_aviso, 'ip4', false);
  solo_curp := pedir_alta('xg', 'Solo Curp', 'solocurp@tasa.test', '4421112241', null, 'prcu 900101 hqtrrr01', null, v_aviso, 'ip4', false);
  perform pg_temp.debe_fallar(
    format($q$select pedir_alta('xg', 'Nadie', 'nadie@tasa.test', '4421112242', null, null, null, %s, 'ip4', false)$q$, v_aviso),
    'RFC o tu CURP', 'Sin RFC ni CURP la solicitud se rechaza');
  perform pg_temp.debe_fallar(
    format($q$select pedir_alta('xg', 'Mala', 'mala@tasa.test', '4421112243', null, 'ABC123', null, %s, 'ip4', false)$q$, v_aviso),
    'CURP no tiene el formato', 'Una CURP con el formato mal se rechaza');
  perform pg_temp.sistema();
  perform pg_temp.igual((select estado || ' ' || (csf_ruta is null) from solicitudes_alta where id = sin_csf),
    'pendiente true'::text, 'Una solicitud sin CSF se acepta y queda pendiente ("CSF pendiente")');
  perform pg_temp.igual((select estado || ' ' || (rfc is null) || ' ' || curp from solicitudes_alta where id = solo_curp),
    'pendiente true PRCU900101HQTRRR01'::text, 'Con solo CURP se acepta');

  perform pg_temp.como('xchel@arqosuv.com');
  perform elegir_organizacion(xg);
  nueva := aprobar_alta(sin_csf, 'sin-constancia', false, false, null, false);
  perform pg_temp.igual((select csf_ruta is null from comisionistas where persona_id = nueva and organizacion_id = xg), true,
    'admin_org aprueba sin CSF: el comisionista queda con "CSF pendiente"');
  nueva := aprobar_alta(solo_curp, 'solo-curp', false, false, null, false);
  perform pg_temp.igual((select (rfc is null) || ' ' || curp from comisionistas where persona_id = nueva and organizacion_id = xg),
    'true PRCU900101HQTRRR01'::text, 'El aprobado con solo CURP queda sin RFC y con su CURP');

  -- El comisionista reemplaza su CSF desde su perfil y queda en bitácora.
  perform pg_temp.como('xchel+ana@arqosuv.com');
  insert into storage.objects (bucket_id, name) values ('altas', xg || '/' || ana || '/csf-ana-2.pdf');
  perform subir_mi_csf(xg || '/' || ana || '/csf-ana-2.pdf');
  perform pg_temp.sistema();
  perform pg_temp.igual((select csf_ruta from comisionistas where persona_id = ana and organizacion_id = xg),
    xg || '/' || ana || '/csf-ana-2.pdf', 'El comisionista reemplaza su CSF');
  perform pg_temp.igual(
    (select count(*) from bitacora where tabla = 'comisionistas' and accion = 'UPDATE' and persona_id = ana
        and despues->>'csf_ruta' = xg || '/' || ana || '/csf-ana-2.pdf' and antes->>'csf_ruta' = xg || '/' || ana || '/csf-ana.pdf'),
    1::bigint, 'El reemplazo queda en bitácora (antes y después)');

  -- Limpieza del cron -------------------------------------------------------------
  perform pg_temp.sistema();
  insert into solicitudes_alta (organizacion_id, nombre, correo, telefono, rfc, estado, csf_ruta, decidida_en)
  values (xg, 'Rechazada Reciente', 'reciente@tasa.test', '4421112236', 'GUXD800101AB3', 'rechazada',
          xg || '/x/csf.pdf', now() - interval '89 days')
  returning id into sol3;
  update solicitudes_alta set decidida_en = now() - interval '90 days 1 minute' where id = sol2;
  perform pg_temp.igual((select count(*) from csf_por_limpiar() where tipo = 'rechazada' and ref = sol2), 1::bigint, 'La CSF rechazada hace 90 días se borra');
  perform pg_temp.igual((select count(*) from csf_por_limpiar() where tipo = 'rechazada' and ref = sol3), 0::bigint, 'La de 89 días no');
  perform cerrar_limpieza_csf('rechazada', sol2, (select csf_ruta from solicitudes_alta where id = sol2));
  perform pg_temp.igual((select csf_ruta is null and csf_borrada_en is not null from solicitudes_alta where id = sol2), true,
    'La solicitud se queda, sin el archivo');
  update solicitudes_alta set creada_en = now() - interval '2 days' where ip_resumen = 'ip3';
  perform pg_temp.igual((select count(*) from csf_por_limpiar() where tipo = 'abandonada'), 5::bigint,
    'Las que nunca subieron su CSF entran a la limpieza al día');
  perform cerrar_limpieza_csf(l.tipo, l.ref, l.ruta) from csf_por_limpiar() l where l.tipo = 'abandonada';
  perform pg_temp.igual((select count(*) from solicitudes_alta where ip_resumen = 'ip3'), 0::bigint, 'Y se borran');
end;
$$;

-- @@ Referidos: atribución
do $$
declare
  xg       uuid := pg_temp.xg();
  ana      uuid := (select id from personas where correo = 'xchel+ana@arqosuv.com');
  beto     uuid := (select id from personas where correo = 'xchel+beto@arqosuv.com');
  carla    uuid := (select id from personas where correo = 'xchel+carla@arqosuv.com');
  cod_ana  text;
  cod_demo text;
  v_aviso  integer;
  valida   uuid;
  invalida uuid;
  otra_org uuid;
  propia   uuid;
  nueva    uuid;
begin
  perform pg_temp.sistema();
  select codigo_referido into cod_ana from comisionistas where persona_id = ana and organizacion_id = xg;
  select c.codigo_referido into cod_demo from comisionistas c join organizaciones o on o.id = c.organizacion_id where o.slug = 'demo' limit 1;
  select aviso_version into v_aviso from ajustes where organizacion_id = xg;
  perform pg_temp.igual((select count(*) = count(distinct codigo_referido) and bool_and(codigo_referido ~ '^[A-HJ-KM-NP-Z2-9]{6}$') from comisionistas),
    true, 'Cada comisionista tiene un código de 6 caracteres, único y sin letras que se confunden');

  perform pg_temp.como(null);
  perform pg_temp.igual(invitado_por('xg', cod_ana), 'Ana Prueba'::text, 'Con un código válido, la solicitud dice quién invitó');
  perform pg_temp.igual(invitado_por('xg', 'ZZZZZZ'), null::text, 'Un código inválido no muestra a nadie');
  perform pg_temp.igual(invitado_por('xg', 'ana-prueba'), 'Ana Prueba'::text, 'La liga vieja (?ref=<slug>) sigue funcionando');
  perform pg_temp.igual(invitado_por('xg', cod_demo), null::text, 'Un código de otra organización no muestra a nadie');
  valida   := pedir_alta('xg', 'Referida Valida', 'refvalida@tasa.test', '4421112250', 'GUXD800101AB3', null, lower(cod_ana), v_aviso, 'ip5', false);
  invalida := pedir_alta('xg', 'Ref Invalido', 'refinvalido@tasa.test', '4421112251', 'GUXD800101AB3', null, 'ZZZZZZ', v_aviso, 'ip5', false);
  otra_org := pedir_alta('xg', 'Ref Otra Org', 'refotra@tasa.test', '4421112252', 'GUXD800101AB3', null, cod_demo, v_aviso, 'ip5', false);
  propia   := pedir_alta('xg', 'Ana Otra Vez', 'XCHEL+ANA@arqosuv.com', '4421112253', null, 'PRCU900101HQTRRR01', cod_ana, v_aviso, 'ip5', false);

  perform pg_temp.sistema();
  perform pg_temp.igual((select referidor_id from solicitudes_alta where id = valida), ana, 'Ref válido: guarda quién lo refirió');
  perform pg_temp.igual((select referidor_id is null and estado = 'pendiente' from solicitudes_alta where id = invalida), true,
    'Ref inválido: se ignora sin error');
  perform pg_temp.igual((select referidor_id is null and estado = 'pendiente' from solicitudes_alta where id = otra_org), true,
    'Ref de otra organización: se ignora sin error');
  perform pg_temp.igual((select referidor_id is null from solicitudes_alta where id = propia), true,
    'Auto-referido (mismo correo que el referidor): se ignora');

  perform pg_temp.como('xchel@arqosuv.com');
  perform elegir_organizacion(xg);
  nueva := aprobar_alta(valida, 'referida-valida', false, false, null, false);
  perform pg_temp.igual((select (referido_por = ana) || ' ' || (referido_desde = hoy_mx()) from comisionistas where persona_id = nueva and organizacion_id = xg),
    'true true'::text, 'Al aprobar, el referidor pasa al comisionista con su fecha de inicio');

  -- Corrección a mano.
  perform asignar_referidor(beto, carla, 'Llegó por WhatsApp, lo invitó Carla');
  perform pg_temp.igual((select referido_por from comisionistas where persona_id = beto and organizacion_id = xg), carla,
    'admin_org asigna "Referido por" a mano');
  perform pg_temp.igual(
    (select count(*) from bitacora where tabla = 'comisionistas' and accion = 'UPDATE' and motivo = 'Llegó por WhatsApp, lo invitó Carla'
        and (despues->>'referido_por')::uuid = carla),
    1::bigint, 'La corrección queda en bitácora con su motivo');
  perform pg_temp.debe_fallar(format('select asignar_referidor(%L, %L, %L)', carla, beto, 'al revés'), 'ciclo',
    'No hay ciclos: si Carla refirió a Beto, Beto no refiere a Carla');
  perform pg_temp.debe_fallar(format('select asignar_referidor(%L, %L, %L)', beto, beto, 'yo mismo'), 'sí mismo',
    'Nadie se refiere a sí mismo');
  perform pg_temp.debe_fallar(format('select asignar_referidor(%L, %L, %L)', beto, ana, ''), 'motivo', 'Sin motivo no se corrige');
  perform asignar_referidor(beto, null, 'Se equivocaron');
  perform pg_temp.igual((select referido_por is null and referido_desde is null from comisionistas where persona_id = beto and organizacion_id = xg),
    true, 'Quitar el referidor borra también su fecha');

  perform pg_temp.como('gaby@tasa.test');
  perform pg_temp.debe_fallar(format('select asignar_referidor(%L, %L, %L)', beto, carla, 'x'), 'Solo admin_org',
    'Finanzas no corrige "Referido por"');
  perform pg_temp.sistema();
end;
$$;

-- @@ Referidos del equipo (solo seguimiento)
do $$
declare
  xg       uuid := pg_temp.xg();
  gaby     uuid := (select id from personas where correo = 'gaby@tasa.test');
  xchel    uuid := (select id from personas where correo = 'xchel@arqosuv.com');
  cod_gaby text;
  cod_xchel text;
  v_aviso  integer;
  sol      uuid;
  propia   uuid;
  otra     uuid;
  nueva    uuid;
begin
  perform pg_temp.sistema();
  select codigo_referido into cod_gaby from membresias where persona_id = gaby and organizacion_id = xg;
  select codigo_referido into cod_xchel from membresias where persona_id = xchel and organizacion_id = xg;
  select aviso_version into v_aviso from ajustes where organizacion_id = xg;
  perform pg_temp.igual(cod_gaby ~ '^[A-HJ-KM-NP-Z2-9]{6}$', true, 'Finanzas (equipo) tiene su código de referido');
  perform pg_temp.igual((select codigo_referido ~ '^[A-HJ-KM-NP-Z2-9]{6}$' from membresias where persona_id = xchel and organizacion_id = xg), true,
    'admin_org también tiene código (solo seguimiento)');
  perform pg_temp.igual((select count(*) from membresias m join comisionistas c on c.codigo_referido = m.codigo_referido), 0::bigint,
    'Ningún código se repite entre equipo y comisionistas');

  perform pg_temp.como(null);
  perform pg_temp.igual(invitado_por('xg', cod_gaby), 'Gaby'::text, 'La liga del equipo dice quién invitó');
  sol    := pedir_alta('xg', 'Invitada Equipo', 'invequipo@tasa.test', '4421112260', 'GUXD800101AB3', null, cod_gaby, v_aviso, 'ip6', false);
  propia := pedir_alta('xg', 'Gaby Otra', 'gaby@tasa.test', '4421112261', 'GUXD800101AB3', null, cod_gaby, v_aviso, 'ip6', false);

  perform pg_temp.sistema();
  perform pg_temp.igual((select (referidor_id is null) || ' ' || (referidor_miembro_id = gaby) from solicitudes_alta where id = sol),
    'true true'::text, 'El referido de equipo se guarda aparte (nunca como referidor de comisionista)');
  perform pg_temp.igual((select referidor_miembro_id is null from solicitudes_alta where id = propia), true,
    'Nadie del equipo se refiere a sí mismo');

  perform pg_temp.como('gaby@tasa.test');
  perform pg_temp.debe_fallar(format('select aprobar_alta(%L, %L, false, false, null, false)', sol, 'invitada-equipo'),
    'Solo admin_org', 'Quien refirió (finanzas) no aprueba su solicitud');

  perform pg_temp.como('xchel@arqosuv.com');
  perform elegir_organizacion(xg);
  nueva := aprobar_alta(sol, 'invitada-equipo', false, false, null, false);
  perform pg_temp.igual(
    (select (referido_por is null) || ' ' || (referido_por_miembro = gaby) || ' ' || (referido_por_miembro_desde = hoy_mx())
       from comisionistas where persona_id = nueva and organizacion_id = xg),
    'true true true'::text, 'Al aprobar: referido_por queda vacío (sin bono) y el del equipo con su fecha');
  perform pg_temp.igual((select decidida_por_referidor from solicitudes_alta where id = sol), false,
    'admin_org que no refirió: no queda marcado');
  perform pg_temp.igual(miembro_cobra_bono(xg, gaby), false, 'Con los interruptores apagados no hay bono para el equipo');

  -- Solo con los dos interruptores (organización y persona) cobraría.
  perform pg_temp.sistema();
  update ajustes set bono_referido_equipo = true where organizacion_id = xg;
  perform pg_temp.igual(miembro_cobra_bono(xg, gaby), false, 'Encendido solo en la organización: todavía no');
  perform pg_temp.como('xchel@arqosuv.com');
  perform poner_bono_referido_miembro((select id from membresias where persona_id = gaby and organizacion_id = xg), true, 3);
  perform pg_temp.igual(miembro_cobra_bono(xg, gaby), true, 'Con los dos encendidos, sí');
  perform poner_bono_referido_miembro((select id from membresias where persona_id = gaby and organizacion_id = xg), false);
  perform pg_temp.sistema();
  update ajustes set bono_referido_equipo = false where organizacion_id = xg;

  -- admin_org que refirió: puede decidir, pero queda marcado.
  perform pg_temp.como(null);
  otra := pedir_alta('xg', 'Invitada Admin', 'invadmin@tasa.test', '4421112262', 'GUXD800101AB3', null,
                     cod_xchel, v_aviso, 'ip6', false);
  perform pg_temp.sistema();
  perform pg_temp.igual((select (referidor_miembro_id = xchel) and referidor_id is null from solicitudes_alta where id = otra), true,
    'Lo que invita admin_org se guarda como referido de equipo, nunca como de comisionista');
  perform pg_temp.como('xchel@arqosuv.com');
  perform rechazar_alta(otra, null);
  perform pg_temp.igual((select decidida_por_referidor from solicitudes_alta where id = otra), true,
    'admin_org que refirió puede decidir, pero queda marcado');

  -- Para admin_org el bono nunca aplica, aunque se enciendan los interruptores.
  perform pg_temp.sistema();
  update ajustes set bono_referido_equipo = true where organizacion_id = xg;
  update membresias set bono_referido = true, bono_referido_pct = 3 where persona_id = xchel and organizacion_id = xg;
  perform pg_temp.igual(miembro_cobra_bono(xg, xchel), false, 'admin_org nunca cobra bono de referido, con todo encendido');
  update membresias set bono_referido = false, bono_referido_pct = null where persona_id = xchel and organizacion_id = xg;
  update ajustes set bono_referido_equipo = false where organizacion_id = xg;
  perform pg_temp.como('xchel@arqosuv.com');
  perform pg_temp.debe_fallar(format('select poner_bono_referido_miembro(%L, true, 3)',
                                     (select id from membresias where persona_id = xchel and organizacion_id = xg)),
    'no lleva bono', 'No se le puede encender el bono a admin_org');
  perform pg_temp.igual(
    (select count(*) from bitacora where tabla = 'solicitudes_alta' and accion = 'UPDATE' and registro_id = otra::text
        and (despues->>'decidida_por_referidor')::boolean),
    1::bigint, 'La marca queda en bitácora');

  -- Reporte.
  perform pg_temp.como('gaby@tasa.test');
  perform pg_temp.igual((select referidos || '/' || con_trabajo_pagado || ' ' || tipo from reporte_referidos() where persona_id = gaby),
    '1/0 equipo'::text, 'El reporte cuenta los referidos del equipo y cuántos ya tienen trabajo pagado');
  perform pg_temp.igual((select count(*) > 0 from reporte_referidos() where tipo = 'comisionista'), true,
    'El reporte incluye a los comisionistas que refieren');
  perform pg_temp.como('xchel+ana@arqosuv.com');
  perform pg_temp.igual((select count(*) from reporte_referidos()), 0::bigint, 'Un comisionista no ve el reporte');
  perform pg_temp.sistema();
end;
$$;

-- @@ Limpieza de CSF: reemplazadas, abandonadas y huérfanas
do $$
declare
  xg      uuid := pg_temp.xg();
  ana     uuid := (select id from personas where correo = 'xchel+ana@arqosuv.com');
  vigente text;
  vieja   uuid;
  aband   uuid;
  v_aviso integer;
begin
  perform pg_temp.sistema();
  select csf_ruta into vigente from comisionistas where persona_id = ana and organizacion_id = xg;
  select id into vieja from csf_reemplazadas where persona_id = ana and ruta = xg || '/' || ana || '/csf-ana.pdf';
  perform pg_temp.igual(vieja is not null, true, 'Al reemplazar su CSF, la anterior queda registrada');

  update csf_reemplazadas set reemplazada_en = now() - interval '29 days' where id = vieja;
  perform pg_temp.igual((select count(*) from csf_por_limpiar() where tipo = 'reemplazada' and ref = vieja), 0::bigint,
    'Reemplazada hace 29 días: se conserva');
  update csf_reemplazadas set reemplazada_en = now() - interval '30 days 1 minute' where id = vieja;
  perform pg_temp.igual((select count(*) from csf_por_limpiar() where tipo = 'reemplazada' and ref = vieja), 1::bigint,
    'Reemplazada hace 30 días: se borra');
  perform cerrar_limpieza_csf('reemplazada', vieja, xg || '/' || ana || '/csf-ana.pdf');
  perform pg_temp.igual(
    (select count(*) from bitacora where tabla = 'csf_reemplazadas' and registro_id = vieja::text
        and motivo = 'Limpieza: CSF reemplazada hace 30 días'),
    1::bigint, 'El borrado de la reemplazada queda en bitácora con su motivo');

  -- La vigente nunca, aunque su archivo sea viejo.
  update storage.objects set created_at = now() - interval '400 days' where bucket_id = 'altas';
  perform pg_temp.igual((select count(*) from csf_por_limpiar() where ruta = vigente), 0::bigint,
    'La CSF vigente del comisionista nunca entra a la limpieza');
  perform pg_temp.igual((select count(*) from csf_por_limpiar() l join comisionistas c on c.csf_ruta = l.ruta), 0::bigint,
    'Ninguna CSF vigente de ningún comisionista');
  perform pg_temp.igual((select count(*) from csf_por_limpiar() l join solicitudes_alta s on s.csf_ruta = l.ruta and s.estado = 'pendiente'), 0::bigint,
    'Ninguna CSF de una solicitud pendiente');

  -- Abandonada con su archivo.
  select aviso_version into v_aviso from ajustes where organizacion_id = xg;
  perform pg_temp.como(null);
  aband := pedir_alta('xg', 'Abandonada', 'abandonada@tasa.test', '4421112270', 'GUXD800101AB3', null, null, v_aviso, 'ip7', true);
  insert into storage.objects (bucket_id, name) values ('altas', xg || '/' || aband || '/csf.pdf');
  perform pg_temp.sistema();
  perform pg_temp.igual((select count(*) from csf_por_limpiar() where ref = aband), 0::bigint, 'Una subida de hoy no se toca');
  update solicitudes_alta set creada_en = now() - interval '2 days' where id = aband;
  perform pg_temp.igual((select ruta from csf_por_limpiar() where tipo = 'abandonada' and ref = aband), xg || '/' || aband || '/csf.pdf',
    'La abandonada entra con su archivo');
  perform cerrar_limpieza_csf('abandonada', aband, xg || '/' || aband || '/csf.pdf');
  perform pg_temp.igual(
    (select count(*) from bitacora where tabla = 'solicitudes_alta' and accion = 'DELETE' and registro_id = aband::text
        and motivo like 'Limpieza: solicitud abandonada%'),
    1::bigint, 'La abandonada se borra con su entrada en bitácora');

  -- Huérfanas: un archivo viejo sin dueño sí; uno de hoy no.
  insert into storage.objects (bucket_id, name, created_at) values ('altas', xg || '/directa/sin-dueno.pdf', now() - interval '2 days');
  insert into storage.objects (bucket_id, name) values ('altas', xg || '/directa/subiendo-ahora.pdf');
  perform pg_temp.igual((select count(*) from csf_por_limpiar() where tipo = 'huerfana' and ruta = xg || '/directa/sin-dueno.pdf'), 1::bigint,
    'Un archivo sin solicitud ni comisionista entra a la limpieza');
  perform pg_temp.igual((select count(*) from csf_por_limpiar() where ruta = xg || '/directa/subiendo-ahora.pdf'), 0::bigint,
    'Uno de hoy no (puede ser una subida en curso)');
  perform cerrar_limpieza_csf('huerfana', null, xg || '/directa/sin-dueno.pdf');
  perform pg_temp.igual(
    (select count(*) from bitacora where tabla = 'storage.altas' and registro_id = xg || '/directa/sin-dueno.pdf' and organizacion_id = xg),
    1::bigint, 'El borrado de la huérfana queda en bitácora');
end;
$$;

-- @@ Credencial de conector: crear o actualizar
do $$
declare
  notion uuid := (select id from conectores where organizacion_id = pg_temp.xg() and tipo = 'notion');
begin
  -- Lo que dejó el reset: un secreto con el nombre del conector, sin amarrar.
  perform pg_temp.sistema();
  update conectores set credencial_id = null where id = notion;
  delete from vault.secrets where name = 'conector_' || notion;
  perform vault.create_secret('secreto_viejo_de_pruebas', 'conector_' || notion, 'quedó del reset');

  perform pg_temp.como('xchel@arqosuv.com');
  perform elegir_organizacion(pg_temp.xg());
  perform guardar_credencial_conector(notion, 'ntn_primero');
  perform guardar_credencial_conector(notion, 'ntn_segundo');
  perform pg_temp.sistema();
  perform pg_temp.igual(credencial_conector(notion), 'ntn_segundo'::text,
    'Guardar dos veces el secreto del mismo conector no da error y queda el último');
  perform pg_temp.igual((select count(*) from vault.secrets where name = 'conector_' || notion), 1::bigint,
    'Sigue habiendo un solo secreto con su nombre (reusó el que quedó del reset)');
end;
$$;

-- @@ Nombre para mostrar y candado de folios
do $$
declare
  xg    uuid := pg_temp.xg();
  v_demo  uuid := (select id from organizaciones where slug = 'demo');
  gaby  uuid := (select id from personas where correo = 'gaby@tasa.test');
  v_anio smallint := extract(year from hoy_mx());
  cod   text;
  nuevo uuid;
begin
  -- Nombre para mostrar.
  perform pg_temp.sistema();
  select codigo_referido into cod from membresias where persona_id = gaby and organizacion_id = xg;
  perform pg_temp.como('gaby@tasa.test');
  perform pg_temp.debe_fallar(format('select poner_nombre_para_mostrar(%L, %L)', gaby, 'Otra'), 'Solo admin_org',
    'Finanzas no cambia nombres para mostrar');
  perform pg_temp.como('xchel@arqosuv.com');
  perform elegir_organizacion(xg);
  perform poner_nombre_para_mostrar(gaby, 'Finanzas XG');
  perform pg_temp.debe_fallar(format('select poner_nombre_para_mostrar(%L, %L)', (select id from personas where correo = 'xchel+ana@arqosuv.com'), 'X'),
    'no es del equipo', 'Un comisionista no lleva nombre para mostrar');
  perform pg_temp.como(null);
  perform pg_temp.igual(invitado_por('xg', cod), 'Finanzas XG'::text, 'La liga pública dice el nombre para mostrar, no el real');
  perform pg_temp.como('gaby@tasa.test');
  perform pg_temp.igual(mi_sesion()->>'nombre', 'Finanzas XG'::text, 'La sesión saluda con el nombre para mostrar');
  perform pg_temp.igual((select nombre from reporte_referidos() where persona_id = gaby), 'Finanzas XG'::text,
    'El reporte de referidos usa el nombre para mostrar');
  perform pg_temp.como('xchel@arqosuv.com');
  perform poner_nombre_para_mostrar(gaby, '');
  perform pg_temp.como(null);
  perform pg_temp.igual(invitado_por('xg', cod), 'Gaby'::text, 'Vacío: vuelve al nombre de siempre');

  -- Candado de folios (conector manual): Demo con un prefijo que todavía no tiene folios este año.
  perform pg_temp.sistema();
  update organizaciones set prefijo_folio = 'NUEVO' where id = v_demo;
  delete from folios_contador where organizacion_id = v_demo and anio = v_anio;
  perform set_config('tasa.org', v_demo::text, true);
  insert into solicitudes (comisionista_id, tipo, origen, servicio_id, inmueble_direccion, cliente_nombre, marca_id,
                           cuenta_receptora_id, monto_honorarios, estado, estatus_publico, creado_por)
  select comisionista_id, tipo, origen, servicio_id, 'Calle Candado 1', 'Cliente Candado', marca_id,
         cuenta_receptora_id, 1000, 'solicitada', 'solicitada', creado_por
    from solicitudes where organizacion_id = v_demo limit 1
  returning id into nuevo;
  perform pg_temp.debe_fallar(format($q$update solicitudes set estado = 'tramite', estatus_publico = 'aceptada', aceptada_en = now() where id = %L$q$, nuevo),
    'captura en Ajustes', 'Con el contador en cero y sin el último folio real, no se acepta un trabajo');

  perform pg_temp.como('xchel+demo-admin@arqosuv.com');
  perform pg_temp.debe_fallar(format('select fijar_ultimo_folio(%s::smallint, -1)', v_anio), 'de 0 a 9999', 'El último folio no puede ser negativo');
  perform fijar_ultimo_folio(v_anio, 41);
  perform pg_temp.igual(ultimo_folio(v_anio), 41, 'admin_org captura el último folio real');
  perform pg_temp.sistema();
  perform set_config('tasa.org', v_demo::text, true);
  update solicitudes set estado = 'tramite', estatus_publico = 'aceptada', aceptada_en = now() where id = nuevo;
  perform pg_temp.igual((select folio from solicitudes where id = nuevo), 'NUEVO-' || v_anio || '-0042',
    'Con el último folio capturado, el siguiente continúa el consecutivo real');
  perform pg_temp.sistema();
  update organizaciones set prefijo_folio = 'DEMO' where id = v_demo;
end;
$$;

-- @@ Notion: cada Etapa, cancelar y páginas borradas
do $$
declare
  notion  uuid := pg_temp.notion_xg();
  base    solicitudes%rowtype;
  t       uuid;
  e       record;
  dinero  uuid;
  tasa    uuid;
  borrada uuid;
begin
  perform pg_temp.sistema();
  select * into base from solicitudes where organizacion_id = pg_temp.xg() and comisionista_id is not null limit 1;

  -- Cada Etapa real de Notion contra su estatus público.
  insert into solicitudes (comisionista_id, tipo, origen, servicio_id, inmueble_direccion, cliente_nombre, marca_id,
                           cuenta_receptora_id, monto_honorarios, estado, estatus_publico, folio, externo_id, aceptada_en, creado_por)
  values (base.comisionista_id, 'tramite_directo', 'admin', base.servicio_id, 'Calle Etapas 1', 'Cliente Etapas', base.marca_id,
          base.cuenta_receptora_id, 1000, 'tramite', 'aceptada', 'MGP-2026-7001', 'prueba-etapas', now(), base.creado_por)
  returning id into t;
  for e in select * from (values
      ('Por asignar', 'aceptada'), ('En espera de cliente', 'aceptada'), ('En proceso', 'en_elaboracion'),
      ('En revisión', 'en_revision'), ('Listo para entregar', 'en_revision'), ('Entregado', 'entregado'),
      ('Cerrado', 'entregado')) as v(etapa, estatus)
  loop
    perform registrar_lectura(notion, 'prueba-etapas', 'MGP-2026-7001 Cliente Etapas', e.etapa, null);
    perform pg_temp.igual((select estatus_publico from solicitudes where id = t), e.estatus,
      'Etapa "' || e.etapa || '" → ' || e.estatus);
  end loop;

  -- Regla 1: "Cancelado" sin dinero cancela, con bitácora.
  perform registrar_lectura(notion, 'prueba-etapas', 'MGP-2026-7001 Cliente Etapas', 'Cancelado', null);
  perform pg_temp.igual((select estado || ' ' || estatus_publico || ' ' || motivo_cancelacion from solicitudes where id = t),
    'cancelada cancelada Cancelado desde Notion'::text, 'Etapa "Cancelado" → Tasa cancela el trabajo para todos');
  perform pg_temp.igual(
    (select count(*) from bitacora where tabla = 'solicitudes' and registro_id = t::text and motivo = 'Cancelado desde Notion'
        and despues->>'estado' = 'cancelada'),
    1::bigint, 'Con bitácora "Cancelado desde Notion"');
  perform registrar_lectura(notion, 'prueba-etapas', 'MGP-2026-7001 Cliente Etapas', 'En proceso', null);
  perform pg_temp.igual((select estado || ' ' || estatus_publico from solicitudes where id = t), 'cancelada cancelada'::text,
    'Una lectura posterior nunca revive un trabajo cancelado');

  -- Regla 1 con dinero: se cancela, no se borra nada y alerta a admin_org.
  insert into solicitudes (comisionista_id, tipo, origen, servicio_id, inmueble_direccion, cliente_nombre, marca_id,
                           cuenta_receptora_id, monto_honorarios, estado, estatus_publico, folio, externo_id, aceptada_en, creado_por)
  values (base.comisionista_id, 'tramite_directo', 'admin', base.servicio_id, 'Calle Dinero 1', 'Cliente Dinero', base.marca_id,
          base.cuenta_receptora_id, 1000, 'tramite', 'en_elaboracion', 'MGP-2026-7002', 'prueba-dinero', now(), base.creado_por)
  returning id into dinero;
  insert into pagos (solicitud_id, via, monto, fecha_pago, comprobante_ruta, reportado_por)
  values (dinero, 'comprobante', 500, hoy_mx(), pg_temp.xg() || '/x/dinero.pdf', base.comisionista_id);
  perform pg_temp.igual(registrar_lectura(notion, 'prueba-dinero', 'MGP-2026-7002 Cliente Dinero', 'Cancelado', null), 'alerta'::text,
    'Con pagos: se cancela y queda alerta');
  perform pg_temp.igual((select estado from solicitudes where id = dinero), 'cancelada'::text, 'El trabajo con pagos también se cancela');
  perform pg_temp.igual((select count(*) from pagos where solicitud_id = dinero), 1::bigint, 'No se borra ningún pago');
  perform pg_temp.igual((select count(*) from alertas where solicitud_id = dinero and tipo = 'cancelado_externo' and resuelta_en is null
                            and mensaje like '%con pagos o comisión%'), 1::bigint, 'La alerta le dice a admin_org que revise los ajustes');

  -- Regla 2: cancelar en Tasa → escribir "Cancelado" en Notion.
  insert into solicitudes (comisionista_id, tipo, origen, servicio_id, inmueble_direccion, cliente_nombre, marca_id,
                           cuenta_receptora_id, monto_honorarios, estado, estatus_publico, folio, externo_id, estatus_externo, aceptada_en, creado_por)
  values (base.comisionista_id, 'tramite_directo', 'admin', base.servicio_id, 'Calle Tasa 1', 'Cliente Tasa', base.marca_id,
          base.cuenta_receptora_id, 1000, 'tramite', 'en_elaboracion', 'MGP-2026-7003', 'prueba-tasa', 'En proceso', now(), base.creado_por)
  returning id into tasa;
  perform pg_temp.igual((select count(*) from por_cancelar_afuera(notion) where solicitud_id = tasa), 0::bigint,
    'Un trabajo vivo no se manda a cancelar afuera');
  perform cancelar_trabajo(tasa, 'El cliente ya no quiere');
  perform pg_temp.igual((select etapa from por_cancelar_afuera(notion) where solicitud_id = tasa), 'Cancelado'::text,
    'Cancelado en Tasa → el cron escribe Etapa "Cancelado" en Notion');
  perform registrar_cancelado_afuera(notion, tasa);
  perform pg_temp.igual((select count(*) from por_cancelar_afuera(notion) where solicitud_id = tasa), 0::bigint,
    'Ya escrito, no se vuelve a mandar');
  perform registrar_lectura(notion, 'prueba-tasa', 'MGP-2026-7003 Cliente Tasa', 'En proceso', null);
  perform pg_temp.igual((select estado from solicitudes where id = tasa), 'cancelada'::text,
    'La sincronización nunca lo revive');

  -- Regla 3: página borrada o archivada.
  insert into solicitudes (comisionista_id, tipo, origen, servicio_id, inmueble_direccion, cliente_nombre, marca_id,
                           cuenta_receptora_id, monto_honorarios, estado, estatus_publico, folio, externo_id, estatus_externo, aceptada_en, creado_por)
  values (base.comisionista_id, 'tramite_directo', 'admin', base.servicio_id, 'Calle Borrada 1', 'Cliente Borrada', base.marca_id,
          base.cuenta_receptora_id, 1000, 'tramite', 'en_revision', 'MGP-2026-7004', 'prueba-borrada', 'En revisión', now(), base.creado_por)
  returning id into borrada;
  perform pg_temp.igual((select count(*) from por_revisar_afuera(notion) where solicitud_id = borrada), 1::bigint,
    'Un trabajo vivo con página entra a la revisión de existencia');
  perform registrar_revision_externa(notion, borrada, true);
  perform pg_temp.igual((select count(*) from por_revisar_afuera(notion) where solicitud_id = borrada), 0::bigint,
    'Revisado, no se vuelve a revisar en una hora');
  update solicitudes set externo_revisado_en = now() - interval '2 hours' where id = borrada;
  perform registrar_revision_externa(notion, borrada, false);
  perform pg_temp.igual((select estado || ' ' || estatus_publico || ' ' || (externo_baja_en is not null) from solicitudes where id = borrada),
    'tramite en_revision true'::text, 'Página borrada: Tasa no cambia el estatus y deja de sincronizar');
  perform pg_temp.igual((select count(*) from alertas where solicitud_id = borrada and tipo = 'externo_borrado' and resuelta_en is null
                            and mensaje like 'La página de Notion ya no existe%'), 1::bigint, 'Alerta a admin_org: "la página ya no existe"');
  perform pg_temp.igual(registrar_lectura(notion, 'prueba-borrada', 'MGP-2026-7004 Cliente Borrada', 'Entregado', null), 'sin_cambios'::text,
    'Una lectura de esa página ya no se aplica');
  perform pg_temp.igual((select count(*) from por_revisar_afuera(notion) where solicitud_id = borrada)
                        + (select count(*) from por_cancelar_afuera(notion) where solicitud_id = borrada), 0::bigint,
    'Y ya no entra a ninguna revisión');
end;
$$;

-- @@ Bono de equipo: % y vigencia
do $$
declare
  xg    uuid := pg_temp.xg();
  gaby  uuid := (select id from personas where correo = 'gaby@tasa.test');
  xchel uuid := (select id from personas where correo = 'xchel@arqosuv.com');
  m     uuid;
  r     record;
  previos bigint;
begin
  perform pg_temp.sistema();
  select id into m from membresias where persona_id = gaby and organizacion_id = xg;
  update ajustes set bono_referido_equipo = true where organizacion_id = xg;
  select count(*) into previos from bitacora where tabla = 'membresias' and registro_id = m::text and motivo = 'Bono de referido del equipo';

  perform pg_temp.como('xchel@arqosuv.com');
  perform elegir_organizacion(xg);
  perform poner_bono_referido_miembro(m, true, 3.25, hoy_mx() + 30);
  perform pg_temp.igual((select bono_referido || ' ' || bono_referido_pct || ' ' || (bono_referido_hasta = hoy_mx() + 30) from membresias where id = m),
    'true 3.25 true'::text, 'admin_org da bono con % fijo (dos decimales) y "vigente hasta"');
  perform pg_temp.igual(miembro_cobra_bono(xg, gaby), true, 'Vigente: cobra');
  perform pg_temp.igual(
    (select count(*) from bitacora where tabla = 'membresias' and registro_id = m::text and persona_id = xchel
        and motivo = 'Bono de referido del equipo' and antes->>'bono_referido_pct' is null
        and despues->>'bono_referido_pct' is not null
        and (despues->>'bono_referido_pct')::numeric = 3.25 and (despues->>'bono_referido')::boolean),
    1::bigint, 'Bitácora con antes/después y quién lo hizo');

  perform pg_temp.debe_fallar(format('select poner_bono_referido_miembro(%L, true, 5.01, null)', m), 'de 0 a 5', 'Más de 5% no');
  perform pg_temp.debe_fallar(format('select poner_bono_referido_miembro(%L, true, -1, null)', m), 'de 0 a 5', 'Negativo no');
  perform pg_temp.debe_fallar(format('select poner_bono_referido_miembro(%L, true, 2.555, null)', m), 'de 0 a 5', 'Más de dos decimales no');
  perform pg_temp.debe_fallar(format('select poner_bono_referido_miembro(%L, true, 2, %L)', m, hoy_mx() - 1), 'ya pasó',
    'Una fecha nueva en el pasado no');

  perform pg_temp.debe_fallar(format('select poner_bono_referido_miembro(%L, true, null, null)', m), 'para activarlo',
    'Para el equipo el % es obligatorio: sin % no se guarda (no hay escala)');
  perform pg_temp.sistema();
  perform pg_temp.debe_fallar(format('update membresias set bono_referido_pct = null where id = %L', m), 'membresias_bono_con_porcentaje',
    'Ni por fuera de la función');
  perform pg_temp.como('xchel@arqosuv.com');
  perform elegir_organizacion(xg);
  perform poner_bono_referido_miembro(m, true, 3.25, null);
  perform pg_temp.igual((select bono_referido_hasta is null from membresias where id = m), true, 'Sin fecha = sin vencimiento');
  perform pg_temp.igual(
    (select count(*) from bitacora where tabla = 'membresias' and registro_id = m::text and motivo = 'Bono de referido del equipo'),
    previos + 2, 'Cada cambio deja su renglón');

  -- Lo que ve el miembro en su tarjeta.
  perform poner_bono_referido_miembro(m, true, 4, null);
  perform pg_temp.como('gaby@tasa.test');
  select * into r from mi_bono_referido();
  perform pg_temp.igual(r.cobra || ' ' || r.pct, 'true 4.00'::text, 'El miembro ve su propio %');
  perform pg_temp.debe_fallar(format('select poner_bono_referido_miembro(%L, true, 5, null)', m), 'Solo admin_org',
    'Finanzas no lo cambia');
  perform pg_temp.igual((select bono_referido_pct from membresias where id = m), 4.00::numeric(4,2), 'Finanzas sí lo lee');

  -- Vencido: ya no cobra, y se puede editar el % sin tocar la fecha vieja.
  perform pg_temp.sistema();
  update membresias set bono_referido_hasta = hoy_mx() - 1 where id = m;
  perform pg_temp.igual(miembro_cobra_bono(xg, gaby), false, 'Pasada la fecha ya no cobra');
  perform pg_temp.como('gaby@tasa.test');
  perform pg_temp.igual((select cobra from mi_bono_referido()), false, 'Y su tarjeta ya no muestra el bono');
  perform pg_temp.como('xchel@arqosuv.com');
  perform elegir_organizacion(xg);
  perform poner_bono_referido_miembro(m, true, 2.5, hoy_mx() - 1);
  perform pg_temp.igual((select bono_referido_pct from membresias where id = m), 2.50::numeric(4,2),
    'Cambiar el % con la fecha vencida que ya tenía sí se puede');

  perform pg_temp.sistema();
  update membresias set bono_referido = false, bono_referido_pct = null, bono_referido_hasta = null where id = m;
  update ajustes set bono_referido_equipo = false where organizacion_id = xg;
end;
$$;

-- @@ Liga de clientes
do $$
declare
  xg      uuid := pg_temp.xg();
  ana     uuid := (select id from personas where correo = 'xchel+ana@arqosuv.com');
  gaby    uuid := (select id from personas where correo = 'gaby@tasa.test');
  xchel   uuid := (select id from personas where correo = 'xchel@arqosuv.com');
  cod_ana text;  cod_gaby text;  cod_xchel text;
  serv    uuid;
  v_aviso integer;
  datos   jsonb;
  r       record;
  s_ana   uuid;  s_gaby uuid;  s_xchel uuid;  s_inac uuid;  tok uuid;
  i       integer;
begin
  perform pg_temp.sistema();
  select codigo_referido into cod_ana from comisionistas where persona_id = ana and organizacion_id = xg;
  select codigo_referido into cod_gaby from membresias where persona_id = gaby and organizacion_id = xg;
  select codigo_referido into cod_xchel from membresias where persona_id = xchel and organizacion_id = xg;
  select id into serv from servicios where organizacion_id = xg and activo order by nombre limit 1;
  select aviso_version into v_aviso from ajustes where organizacion_id = xg;
  if coalesce(v_aviso, 0) = 0 then
    update ajustes set aviso_privacidad = 'Aviso de prueba' where organizacion_id = xg;
    select aviso_version into v_aviso from ajustes where organizacion_id = xg;
  end if;

  -- La página pública: solo el nombre para mostrar, nunca correo ni teléfono.
  perform pg_temp.como(null);
  datos := datos_liga_cliente('xg', lower(cod_ana));
  perform pg_temp.igual(datos->>'con', 'Ana Prueba'::text, 'Liga válida: "Solicitud con <nombre para mostrar>"');
  perform pg_temp.igual(datos::text like '%@%' or datos::text like '%4420000001%', false, 'Sin correo ni teléfono del dueño en la página');
  perform pg_temp.igual(jsonb_array_length(datos->'servicios') > 0, true, 'Trae los servicios de Catálogos');
  perform pg_temp.igual(datos_liga_cliente('xg', 'ZZZZZZ'), null::jsonb, 'Código inválido: liga no válida');
  perform pg_temp.igual(datos_liga_cliente('no-existe', cod_ana), null::jsonb, 'Organización inválida: liga no válida');
  perform pg_temp.debe_fallar(format($q$select * from pedir_por_liga('xg', 'ZZZZZZ', 'Cliente', '4421234567', null, %L, false,
    'Calle 1', 'casa', null, null, %s, 'ipx', 0)$q$, serv, v_aviso), 'no es válida', 'Pedir con un código inválido no entra');

  -- Liga de comisionista: suya, con comisión normal.
  select solicitud into s_ana from pedir_por_liga('xg', cod_ana, 'Cliente Ana', '+52 442 123 4567', 'cliente@correo.test', serv, false,
    'Calle Liga 1, Querétaro', 'casa', '14 01 001', 'Urge', v_aviso, 'ip-liga-1', 0);
  perform pg_temp.sistema();
  perform pg_temp.igual(
    (select (comisionista_id = ana) || ' ' || (liga_de = ana) || ' ' || origen || ' ' || estado || ' ' || tipo || ' ' || cliente_telefono
            || ' ' || (inmueble_descripcion = E'Tipo: Casa\nUrge') || ' ' || liga_sin_dueno
       from solicitudes where id = s_ana),
    'true true liga_cliente solicitada cotizacion 4421234567 true false'::text,
    'Liga de comisionista: entra a por cotizar, atribuida a él, con teléfono normalizado');
  perform pg_temp.igual((select count(*) from bitacora where tabla = 'solicitudes' and registro_id = s_ana::text and motivo = 'Liga de cliente'),
    1::bigint, 'Con bitácora "Liga de cliente"');

  -- Liga del equipo y de admin_org: solo seguimiento, sin comisionista.
  perform pg_temp.como(null);
  select solicitud into s_gaby from pedir_por_liga('xg', cod_gaby, 'Cliente Gaby', '4421234568', null, serv, true,
    'Calle Liga 2', 'terreno', null, null, v_aviso, 'ip-liga-2', 0);
  select solicitud into s_xchel from pedir_por_liga('xg', cod_xchel, 'Cliente Xchel', '4421234569', null, serv, false,
    'Calle Liga 3', 'departamento', null, null, v_aviso, 'ip-liga-3', 0);
  perform pg_temp.sistema();
  perform pg_temp.igual((select (comisionista_id is null) || ' ' || (liga_de = gaby) || ' ' || tipo || ' ' || estado || ' ' || quiere_tramite
                           from solicitudes where id = s_gaby),
    'true true cotizacion solicitada true'::text,
    'Liga del equipo: sin comisionista (solo seguimiento); "Quiero el trámite" entra como cotización marcada');
  perform pg_temp.igual((select count(*) from reclamar_por_crear(pg_temp.notion_xg(), 100) where solicitud_id in (s_gaby, s_ana, s_xchel)),
    0::bigint, 'Nada de la liga crea páginas en Notion antes de aceptarse la cotización');
  perform pg_temp.debe_fallar(format($q$update solicitudes set quiere_tramite = true where id = (select id from solicitudes where origen = 'portal' limit 1)$q$),
    'solicitudes_quiere_tramite_de_liga', 'La marca solo existe en solicitudes de liga');
  perform pg_temp.igual((select (comisionista_id is null) and liga_de = xchel from solicitudes where id = s_xchel), true,
    'Liga de admin_org: sin comisionista');

  -- Al pagarse: comisión solo si hay comisionista.
  update solicitudes set monto_honorarios = 1000, estado = 'tramite', estatus_publico = 'aceptada', aceptada_en = now()
   where id in (s_ana, s_gaby);
  insert into pagos (solicitud_id, via, monto, fecha_pago, comprobante_ruta, reportado_por)
  values (s_ana, 'comprobante', 1000, hoy_mx(), xg || '/x/liga1.pdf', ana),
         (s_gaby, 'comprobante', 1000, hoy_mx(), xg || '/x/liga2.pdf', xchel);
  update pagos set estado = 'confirmado' where solicitud_id in (s_ana, s_gaby);
  perform liquidar_si_completo(s_ana);
  perform liquidar_si_completo(s_gaby);
  perform pg_temp.igual((select count(*) from comisiones where solicitud_id = s_ana), 1::bigint, 'Comisionista: genera comisión normal');
  perform pg_temp.igual((select (pagado_en is not null) || ' ' || (select count(*) from comisiones where solicitud_id = s_gaby)
                           from solicitudes where id = s_gaby), 'true 0'::text, 'Equipo: se paga el trabajo, sin comisión');

  -- Nadie fuera de liga queda sin comisionista.
  perform pg_temp.debe_fallar(format($q$update solicitudes set comisionista_id = null where id = %L$q$,
    (select id from solicitudes where origen = 'portal' limit 1)), 'solicitudes_con_dueno', 'Una solicitud del portal sigue exigiendo comisionista');

  -- Liga de alguien inactivo: llega igual, a la organización, con alerta.
  update membresias set activa = false where persona_id = ana and organizacion_id = xg;
  select to_jsonb(nombre) into datos from organizaciones where id = xg;
  perform pg_temp.como(null);
  perform pg_temp.igual(datos_liga_cliente('xg', cod_ana)->>'con', datos->>0,
    'Liga de inactivo: la página dice la organización');
  select solicitud into s_inac from pedir_por_liga('xg', cod_ana, 'Cliente Inactivo', '4421234570', null, serv, false,
    'Calle Liga 4', 'otro', null, null, v_aviso, 'ip-liga-4', 0);
  perform pg_temp.sistema();
  update membresias set activa = true where persona_id = ana and organizacion_id = xg;
  perform pg_temp.igual((select (comisionista_id is null) || ' ' || liga_sin_dueno from solicitudes where id = s_inac), 'true true'::text,
    'Liga de inactivo: atribuida a la organización, sin comisión');
  perform pg_temp.igual((select count(*) from alertas where solicitud_id = s_inac and tipo = 'liga_inactiva' and resuelta_en is null),
    1::bigint, 'Con alerta a admin_org');

  -- Validaciones.
  perform pg_temp.como(null);
  perform pg_temp.debe_fallar(format($q$select * from pedir_por_liga('xg', %L, 'Cliente', '442123', null, %L, false,
    'Calle 1', 'casa', null, null, %s, 'ipv', 0)$q$, cod_ana, serv, v_aviso), '10 dígitos', 'Teléfono obligatorio a 10 dígitos');
  perform pg_temp.debe_fallar(format($q$select * from pedir_por_liga('xg', %L, 'Cliente', '4421112222', 'no-es-correo', %L, false,
    'Calle 1', 'casa', null, null, %s, 'ipv', 0)$q$, cod_ana, serv, v_aviso), 'correo', 'Correo opcional, pero válido');
  perform pg_temp.debe_fallar(format($q$select * from pedir_por_liga('xg', %L, 'Cliente', '4421112222', null, %L, false,
    'Calle 1', 'casa', null, null, %s, 'ipv', 0)$q$, cod_ana, serv, v_aviso + 1), 'aviso de privacidad', 'Exige aceptar el aviso vigente');
  perform pg_temp.debe_fallar(format($q$select * from pedir_por_liga('xg', %L, 'Cliente', '4421112222', null, %L, false,
    'Calle 1', 'castillo', null, null, %s, 'ipv', 0)$q$, cod_ana, serv, v_aviso), 'tipo de inmueble', 'Tipo de inmueble de la lista');

  -- Antispam: 3 por teléfono y 5 por conexión al día.
  for i in 1..3 loop
    perform pedir_por_liga('xg', cod_ana, 'Spam Tel', '4429990000', null, serv, false, 'Calle', 'casa', null, null, v_aviso, 'ip-tel-' || i, 0);
  end loop;
  perform pg_temp.debe_fallar(format($q$select * from pedir_por_liga('xg', %L, 'Spam Tel', '4429990000', null, %L, false,
    'Calle', 'casa', null, null, %s, 'ip-tel-9', 0)$q$, cod_ana, serv, v_aviso), 'Ya recibimos', 'Límite por teléfono');
  for i in 1..5 loop
    perform pedir_por_liga('xg', cod_ana, 'Spam IP', '44288800' || lpad(i::text, 2, '0'), null, serv, false, 'Calle', 'casa', null, null, v_aviso, 'ip-spam', 0);
  end loop;
  perform pg_temp.debe_fallar(format($q$select * from pedir_por_liga('xg', %L, 'Spam IP', '4428880099', null, %L, false,
    'Calle', 'casa', null, null, %s, 'ip-spam', 0)$q$, cod_ana, serv, v_aviso), 'demasiadas', 'Límite por conexión');

  -- Adjuntos: solo con el token, recién creada y hasta 3.
  select solicitud, token into s_inac, tok from pedir_por_liga('xg', cod_gaby, 'Cliente Archivos', '4421234571', null, serv, false,
    'Calle Liga 5', 'casa', null, null, v_aviso, 'ip-liga-5', 2);
  perform pg_temp.igual(cliente_admite_adjunto(xg || '/' || s_inac || '/' || tok || '/escritura.pdf'), true, 'Con su token se puede subir');
  perform pg_temp.igual(cliente_admite_adjunto(xg || '/' || s_inac || '/' || gen_random_uuid() || '/escritura.pdf'), false, 'Con otro token no');
  perform pg_temp.igual(cliente_admite_adjunto(xg || '/' || s_ana || '/' || tok || '/escritura.pdf'), false, 'A otra solicitud no');
  perform pg_temp.sistema();
  insert into storage.objects (bucket_id, name) select 'clientes', xg || '/' || s_inac || '/' || tok || '/a' || g || '.pdf' from generate_series(1, 3) g;
  perform pg_temp.igual(cliente_admite_adjunto(xg || '/' || s_inac || '/' || tok || '/cuarto.pdf'), false, 'Hasta 3 archivos');
  delete from storage.objects where name like xg || '/' || s_inac || '/%';
  update solicitudes set adjuntos_hasta = now() - interval '1 minute' where id = s_inac;
  perform pg_temp.igual(cliente_admite_adjunto(xg || '/' || s_inac || '/' || tok || '/tarde.pdf'), false, 'Pasados 30 minutos ya no');

  -- Avisos: el dueño ve lo de su liga; los datos del correo solo para el servidor.
  perform pg_temp.como('gaby@tasa.test');
  perform pg_temp.igual((select count(*) from mis_solicitudes_de_liga() where id = s_gaby), 1::bigint,
    'El miembro del equipo ve "Tu cliente <nombre> pidió <servicio>"');
  perform pg_temp.igual((select count(*) from mis_solicitudes_de_liga() where id = s_ana), 0::bigint, 'Y no la de otros');
  perform pg_temp.como('xchel+ana@arqosuv.com');
  perform pg_temp.igual((select count(*) from mis_solicitudes_de_liga() where id = s_ana), 1::bigint, 'El comisionista ve la suya');
  perform pg_temp.como(null);
  perform pg_temp.debe_fallar(format('select * from datos_aviso_liga(%L)', s_ana), 'permission denied', 'anon no lee a quién avisar');
  perform pg_temp.debe_fallar('select count(*) from solicitudes', 'permission denied', 'anon no lee solicitudes');
  perform pg_temp.sistema();
  select * into r from datos_aviso_liga(s_gaby);
  perform pg_temp.igual(r.dueno_correo || ' ' || r.cliente_nombre, 'gaby@tasa.test Cliente Gaby'::text, 'El servidor sabe a quién avisar');
end;
$$;

-- @@ Seguimiento igual por los cuatro orígenes
-- Comisionista desde su cuenta, liga de comisionista, liga de equipo y
-- liga de admin_org: misma cotización, misma aceptación, mismo folio de
-- Notion. Al final cada dueño lee exactamente lo mismo: folio, estatus,
-- fechas e historial.
do $$
declare
  xg      uuid := pg_temp.xg();
  notion  uuid := pg_temp.notion_xg();
  ana     uuid := (select id from personas where correo = 'xchel+ana@arqosuv.com');
  xchel   uuid := (select id from personas where correo = 'xchel@arqosuv.com');
  eva     uuid;
  cod_ana text;  cod_eva text;  cod_xchel text;
  serv    uuid;
  cuenta  uuid;
  v_aviso integer;
  una     uuid;
  s       uuid[] := '{}';
  dueno   text[] := array['xchel+ana@arqosuv.com', 'xchel+ana@arqosuv.com', 'eva@tasa.test', 'xchel@arqosuv.com'];
  origen  text[] := array['comisionista directo', 'liga de comisionista', 'liga de equipo', 'liga de admin_org'];
  ref     text;
  visto   text;
  i       integer;
begin
  perform pg_temp.sistema();
  insert into personas (nombre, correo, organizacion_activa) values ('Eva Equipo', 'eva@tasa.test', xg) returning id into eva;
  insert into membresias (persona_id, organizacion_id, rol) values (eva, xg, 'equipo');
  insert into auth.users (email) values ('eva@tasa.test');
  select codigo_referido into cod_ana from comisionistas where persona_id = ana and organizacion_id = xg;
  select codigo_referido into cod_eva from membresias where persona_id = eva and organizacion_id = xg;
  select codigo_referido into cod_xchel from membresias where persona_id = xchel and organizacion_id = xg;
  select id into serv from servicios where organizacion_id = xg and activo order by nombre limit 1;
  select id into cuenta from cuentas_receptoras where organizacion_id = xg limit 1;
  select aviso_version into v_aviso from ajustes where organizacion_id = xg;

  -- Los cuatro caminos de entrada.
  perform pg_temp.como('xchel+ana@arqosuv.com');
  insert into solicitudes (organizacion_id, comisionista_id, tipo, origen, servicio_id, inmueble_direccion, cliente_nombre)
  values (xg, ana, 'cotizacion', 'portal', serv, 'Calle Seguimiento 1', 'Cliente Seg 1') returning id into una;
  s := s || una;
  perform pg_temp.como(null);
  select solicitud into una from pedir_por_liga('xg', cod_ana, 'Cliente Seg 2', '4425550002', null, serv, true,
    'Calle Seguimiento 2', 'casa', null, null, v_aviso, 'ip-seg-2', 0);
  s := s || una;
  select solicitud into una from pedir_por_liga('xg', cod_eva, 'Cliente Seg 3', '4425550003', null, serv, true,
    'Calle Seguimiento 3', 'casa', null, null, v_aviso, 'ip-seg-3', 0);
  s := s || una;
  select solicitud into una from pedir_por_liga('xg', cod_xchel, 'Cliente Seg 4', '4425550004', null, serv, false,
    'Calle Seguimiento 4', 'casa', null, null, v_aviso, 'ip-seg-4', 0);
  s := s || una;

  -- Misma cotización, aceptada por quien puede (el comisionista o el staff), mismo paso por Notion.
  perform pg_temp.sistema();
  for i in 1..4 loop
    insert into cotizaciones (solicitud_id, monto_honorarios, cuenta_receptora_id, vigente_hasta)
    values (s[i], 3000, cuenta, hoy_mx() + 15);
  end loop;
  for i in 1..4 loop
    perform pg_temp.como(case when i <= 2 then 'xchel+ana@arqosuv.com' else 'xchel@arqosuv.com' end);
    perform aceptar_cotizacion((select id from cotizaciones where solicitud_id = s[i] and estado = 'emitida'));
  end loop;
  perform pg_temp.sistema();
  for i in 1..4 loop
    perform registrar_registro_externo(notion, s[i], 'seguimiento-' || i);
    perform registrar_lectura(notion, 'seguimiento-' || i, 'MGP-2026-860' || i || ' Cliente Seg ' || i, 'En proceso', null);
  end loop;

  -- Cada dueño, con su sesión, ve lo mismo que el comisionista directo.
  for i in 1..4 loop
    perform pg_temp.como(dueno[i]);
    select coalesce(replace(folio, 'MGP-2026-860' || i, 'FOLIO'), '(sin folio)') || ' ' || estatus_publico || ' ' || estado
           || ' ' || (aceptada_en is not null) || ' ' || (creado_en is not null)
           || ' ' || (select string_agg(h.estatus_publico, '>' order by h.desde) from historial_estatus h where h.solicitud_id = s[i])
           || ' ' || (select count(*) from cotizaciones c where c.solicitud_id = s[i] and c.estado = 'aceptada')
      into visto from solicitudes where id = s[i];
    if i = 1 then
      ref := visto;
      perform pg_temp.igual(ref like 'FOLIO en_elaboracion tramite true true %', true, 'Comisionista directo: ve folio y estatus (' || ref || ')');
    else
      perform pg_temp.igual(visto, ref, 'Por ' || origen[i] || ': el dueño ve el mismo seguimiento');
    end if;
  end loop;

  -- Solo lo suyo, y solo lectura.
  perform pg_temp.como('eva@tasa.test');
  perform pg_temp.igual((select count(*) from solicitudes), 1::bigint, 'El equipo ve solo lo atribuido a su liga');
  perform pg_temp.igual((select count(*) from comisiones), 0::bigint, 'Y ninguna comisión');
  update solicitudes set cliente_nombre = 'Otro' where id = s[3];
  perform pg_temp.sistema();
  perform pg_temp.igual((select cliente_nombre from solicitudes where id = s[3]), 'Cliente Seg 3'::text, 'Y no la puede modificar');
  update solicitudes set liga_sin_dueno = true where id = s[3];
  perform pg_temp.como('eva@tasa.test');
  perform pg_temp.igual((select count(*) from solicitudes), 0::bigint, 'Si llegó estando inactivo, es de la organización y no la ve');
end;
$$;

-- @@ Fecha de entrega
do $$
declare
  notion uuid := pg_temp.notion_xg();
  base   solicitudes%rowtype;
  t      uuid;
  u      uuid;
begin
  perform pg_temp.sistema();
  select * into base from solicitudes where organizacion_id = pg_temp.xg() and comisionista_id is not null and marca_id is not null limit 1;
  insert into solicitudes (comisionista_id, tipo, origen, servicio_id, inmueble_direccion, cliente_nombre, marca_id,
                           cuenta_receptora_id, monto_honorarios, estado, estatus_publico, folio, externo_id, aceptada_en, creado_por)
  values (base.comisionista_id, 'tramite_directo', 'admin', base.servicio_id, 'Calle Entrega 1', 'Cliente Entrega', base.marca_id,
          base.cuenta_receptora_id, 1000, 'tramite', 'en_elaboracion', 'MGP-2026-7101', 'prueba-entrega', now(), base.creado_por)
  returning id into t;
  perform pg_temp.igual((select fecha_entrega from solicitudes where id = t), null::date, 'En elaboración: sin fecha de entrega');

  -- Desde Notion.
  perform registrar_lectura(notion, 'prueba-entrega', 'MGP-2026-7101 Cliente Entrega', 'Entregado', null);
  perform pg_temp.igual((select fecha_entrega from solicitudes where id = t), hoy_mx(), 'Pasa a Entregado desde Notion: fecha de hoy');
  update solicitudes set fecha_entrega = hoy_mx() - 40 where id = t;
  perform registrar_lectura(notion, 'prueba-entrega', 'MGP-2026-7101 Cliente Entrega', 'Cerrado', null);
  perform pg_temp.igual((select fecha_entrega from solicitudes where id = t), hoy_mx() - 40, 'Otra lectura en Entregado no la mueve');
  perform registrar_lectura(notion, 'prueba-entrega', 'MGP-2026-7101 Cliente Entrega', 'En revisión', null);
  perform pg_temp.igual((select fecha_entrega from solicitudes where id = t), null::date, 'Si se revierte, se limpia');

  -- Desde Tasa, y al pagarse se conserva.
  update solicitudes set estatus_publico = 'entregado' where id = t;
  perform pg_temp.igual((select fecha_entrega from solicitudes where id = t), hoy_mx(), 'Pasa a Entregado desde Tasa: fecha de hoy');
  insert into pagos (solicitud_id, via, monto, fecha_pago, comprobante_ruta, reportado_por)
  values (t, 'comprobante', 1000, hoy_mx(), pg_temp.xg() || '/x/entrega.pdf', base.comisionista_id);
  update pagos set estado = 'confirmado' where solicitud_id = t;
  perform liquidar_si_completo(t);
  perform pg_temp.igual((select estatus_publico || ' ' || fecha_entrega from solicitudes where id = t), 'pagado ' || hoy_mx(),
    'Entregado → Pagado conserva la fecha de entrega');

  -- Pagado sin haberse entregado: no inventa fecha.
  insert into solicitudes (comisionista_id, tipo, origen, servicio_id, inmueble_direccion, cliente_nombre, marca_id,
                           cuenta_receptora_id, monto_honorarios, estado, estatus_publico, aceptada_en, creado_por)
  values (base.comisionista_id, 'tramite_directo', 'admin', base.servicio_id, 'Calle Entrega 2', 'Cliente Pago Antes', base.marca_id,
          base.cuenta_receptora_id, 1000, 'tramite', 'en_elaboracion', now(), base.creado_por)
  returning id into u;
  insert into pagos (solicitud_id, via, monto, fecha_pago, comprobante_ruta, reportado_por)
  values (u, 'comprobante', 1000, hoy_mx(), pg_temp.xg() || '/x/entrega2.pdf', base.comisionista_id);
  update pagos set estado = 'confirmado' where solicitud_id = u;
  perform liquidar_si_completo(u);
  perform pg_temp.igual((select estatus_publico || ' ' || coalesce(fecha_entrega::text, 'sin fecha') from solicitudes where id = u),
    'pagado sin fecha'::text, 'Pagado antes de entregar: sin fecha de entrega');
end;
$$;

-- @@ Tipos de honorario y convenios
-- Cada tipo de honorario de punta a punta (cotizar, aceptar, pagar) con
-- su comisión y su efecto en el nivel; convenio sin comisión y con % fijo.
create function pg_temp.cotizar_y_aceptar(p_sol uuid, p_cuenta uuid, p_tipo text, p_monto numeric,
                                          p_min numeric default null, p_ligada uuid default null,
                                          p_convenio uuid default null, p_motivo text default null)
returns void language plpgsql as $$
begin
  perform pg_temp.sistema();
  insert into cotizaciones (solicitud_id, monto_honorarios, cuenta_receptora_id, vigente_hasta, honorario_tipo,
                            honorario_minimo, ligada_a, convenio_id, ajuste_motivo)
  values (p_sol, p_monto, p_cuenta, hoy_mx() + 15, p_tipo, p_min, p_ligada, p_convenio, p_motivo);
  perform pg_temp.como('xchel+ana@arqosuv.com');
  perform aceptar_cotizacion((select id from cotizaciones where solicitud_id = p_sol and estado = 'emitida'));
  perform pg_temp.sistema();
end;
$$;

create function pg_temp.pagar(p_sol uuid) returns void language plpgsql as $$
begin
  insert into pagos (solicitud_id, via, monto, fecha_pago, comprobante_ruta, reportado_por)
  select p_sol, 'comprobante', monto_total, hoy_mx(), pg_temp.xg() || '/x/' || p_sol || '.pdf', comisionista_id
    from solicitudes where id = p_sol;
  update pagos set estado = 'confirmado' where solicitud_id = p_sol and estado = 'reportado';
end;
$$;

do $$
declare
  xg      uuid := pg_temp.xg();
  ana     uuid := (select id from personas where correo = 'xchel+ana@arqosuv.com');
  serv    uuid;
  cuenta  uuid;
  s       uuid[] := '{}';
  una     uuid;
  conv_no uuid;
  conv_10 uuid;
  i       integer;
  prom    numeric;
  prom2   numeric;
  pct     numeric;
begin
  perform pg_temp.sistema();
  select id into serv from servicios where organizacion_id = xg and activo order by nombre limit 1;
  select id into cuenta from cuentas_receptoras where organizacion_id = xg limit 1;
  for i in 1..6 loop
    insert into solicitudes (organizacion_id, comisionista_id, tipo, origen, servicio_id, inmueble_direccion, cliente_nombre)
    values (xg, ana, 'cotizacion', 'portal', serv, 'Calle Honorario ' || i, 'Cliente Honorario ' || i) returning id into una;
    s := s || una;
  end loop;
  pct := porcentaje_vigente(xg, ana, mes_abierto_desde(xg, hoy_mx()));

  -- Convenios: los crea admin_org; finanzas los lee; el comisionista no los ve.
  perform pg_temp.como('xchel@arqosuv.com');
  insert into convenios (nombre, contacto, comision_regla) values ('Convenio Sin Comisión', 'Lic. Prueba', 'ninguna') returning id into conv_no;
  insert into convenios (nombre, comision_regla, comision_pct) values ('Convenio 10%', 'fija', 10) returning id into conv_10;
  insert into convenio_precios (convenio_id, servicio_id, monto) values (conv_no, serv, 2500);
  insert into convenio_precios (convenio_id, servicio_id, sin_costo, monto) values (conv_10, serv, true, 0);
  perform pg_temp.como('gaby@tasa.test');
  perform pg_temp.igual((select count(*) from convenios where id in (conv_no, conv_10)), 2::bigint, 'Finanzas lee los convenios para cotizar');
  perform pg_temp.debe_fallar($q$insert into convenios (nombre) values ('De finanzas')$q$, 'row-level security', 'Solo admin_org los crea');
  perform pg_temp.como('xchel+ana@arqosuv.com');
  perform pg_temp.igual((select count(*) from convenios), 0::bigint, 'El comisionista no ve los convenios');
  perform pg_temp.igual((select count(*) from convenio_precios), 0::bigint, 'Ni su tabulador');
  perform pg_temp.sistema();

  -- 1. Fijo: como siempre, comisión con el % del nivel, y suma para el nivel.
  select promedio into prom from calcular_nivel(xg, ana, (mes_abierto_desde(xg, hoy_mx()) + interval '1 month')::date);
  perform pg_temp.cotizar_y_aceptar(s[1], cuenta, 'fijo', 4000);
  perform pg_temp.pagar(s[1]);
  perform pg_temp.igual((select porcentaje || ' ' || base from comisiones where solicitud_id = s[1]), pct || ' 4000.00',
    'Fijo: comisión con el % del nivel sobre el honorario');
  select promedio into prom2 from calcular_nivel(xg, ana, (mes_abierto_desde(xg, hoy_mx()) + interval '1 month')::date);
  perform pg_temp.igual(prom2 > prom, true, 'Fijo: cuenta para el nivel');

  -- 2. Sin costo, ligado al fijo: $0, nunca comisión.
  perform pg_temp.debe_fallar(format($q$insert into cotizaciones (solicitud_id, monto_honorarios, cuenta_receptora_id, vigente_hasta, honorario_tipo)
    values (%L, 100, %L, hoy_mx() + 1, 'sin_costo')$q$, s[2], cuenta), 'cotizaciones_honorario_coherente', 'Sin costo es $0');
  perform pg_temp.debe_fallar(format($q$insert into cotizaciones (solicitud_id, monto_honorarios, cuenta_receptora_id, vigente_hasta, ligada_a)
    values (%L, 100, %L, hoy_mx() + 1, %L)$q$, s[2], cuenta, s[1]), 'cotizaciones_honorario_coherente', 'Solo sin costo se liga');
  perform pg_temp.cotizar_y_aceptar(s[2], cuenta, 'sin_costo', 0, null, s[1]);
  perform pg_temp.igual((select honorario_tipo || ' ' || monto_honorarios || ' ' || (ligada_a = s[1]) || ' ' || estado from solicitudes where id = s[2]),
    'sin_costo 0.00 true tramite'::text, 'Sin costo: se acepta y queda ligado al trabajo que cobra');
  perform liquidar_si_completo(s[2]);
  perform pg_temp.igual((select count(*) from comisiones where solicitud_id = s[2]), 0::bigint, 'Sin costo: nunca genera comisión');

  -- 3. Estimado con rango: el máximo manda hasta fijar el final.
  perform pg_temp.cotizar_y_aceptar(s[3], cuenta, 'estimado', 5000, 2000);
  perform pg_temp.igual((select monto_honorarios || ' ' || honorario_minimo || ' ' || honorario_estimado || ' ' || (honorario_final_en is null) from solicitudes where id = s[3]),
    '5000.00 2000.00 5000.00 true'::text, 'Estimado: se acepta con el máximo del rango y sin final');
  insert into pagos (solicitud_id, via, monto, fecha_pago, comprobante_ruta, reportado_por)
  values (s[3], 'comprobante', 5000, hoy_mx(), xg || '/x/estimado.pdf', ana);
  perform pg_temp.debe_fallar(format($q$update pagos set estado = 'confirmado' where solicitud_id = %L$q$, s[3]),
    'honorario final', 'Sin honorario final no se confirma el pago que lo liquidaría');
  update solicitudes set estatus_publico = 'entregado' where id = s[3];
  perform pg_temp.igual((select count(*) from alertas where solicitud_id = s[3] and tipo = 'estimado_sin_final' and resuelta_en is null),
    1::bigint, 'Entregado desde Notion sin final: alerta');
  perform pg_temp.como('xchel+ana@arqosuv.com');
  perform pg_temp.debe_fallar(format($q$select fijar_honorario_final(%L, 4000, 'Visita extra')$q$, s[3]), 'Solo administración o finanzas',
    'El comisionista no fija el honorario final');
  perform pg_temp.como('gaby@tasa.test');
  perform pg_temp.debe_fallar(format($q$select fijar_honorario_final(%L, 4000, '')$q$, s[3]), 'motivo', 'El final lleva motivo');
  perform fijar_honorario_final(s[3], 4000, 'Superficie menor a la estimada');
  perform pg_temp.sistema();
  perform pg_temp.igual((select monto_honorarios || ' ' || honorario_estimado || ' ' || (honorario_final_en is not null) from solicitudes where id = s[3]),
    '4000.00 5000.00 true'::text, 'Finanzas fija el final; el estimado se conserva');
  perform pg_temp.igual((select count(*) from bitacora where tabla = 'solicitudes' and registro_id = s[3]::text
                            and motivo = 'Honorario final: Superficie menor a la estimada'
                            and antes->>'monto_honorarios' = '5000.00' and despues->>'monto_honorarios' = '4000.00'),
    1::bigint, 'Bitácora con antes, después y motivo');
  perform pg_temp.igual((select count(*) from alertas where solicitud_id = s[3] and tipo = 'estimado_sin_final' and resuelta_en is null),
    0::bigint, 'Al fijarlo, la alerta se resuelve');
  -- Se reportó el estimado y el final quedó abajo: se rechaza con motivo y se reporta el monto correcto.
  update pagos set estado = 'rechazado', motivo_rechazo = 'El honorario final es menor' where solicitud_id = s[3] and estado = 'reportado';
  insert into pagos (solicitud_id, via, monto, fecha_pago, comprobante_ruta, reportado_por)
  values (s[3], 'comprobante', 4000, hoy_mx(), xg || '/x/estimado-final.pdf', ana);
  update pagos set estado = 'confirmado' where solicitud_id = s[3] and estado = 'reportado';
  perform pg_temp.igual((select porcentaje || ' ' || base from comisiones where solicitud_id = s[3]), pct || ' 4000.00',
    'Estimado: la comisión va sobre el honorario final pagado');

  -- 4. Convenio sin comisión: ni comisión ni nivel; con motivo de ajuste en bitácora.
  perform pg_temp.cotizar_y_aceptar(s[4], cuenta, 'fijo', 2300, null, null, conv_no, 'Descuento por volumen');
  perform pg_temp.igual((select count(*) from bitacora where tabla = 'cotizaciones' and accion = 'INSERT' and motivo = 'Ajuste al convenio: Descuento por volumen'),
    1::bigint, 'Ajuste al precio del convenio: motivo en bitácora');
  perform pg_temp.igual((select comision_regla from solicitudes where id = s[4]), 'ninguna'::text, 'El trabajo hereda la regla del convenio');
  select promedio into prom from calcular_nivel(xg, ana, (mes_abierto_desde(xg, hoy_mx()) + interval '1 month')::date);
  perform pg_temp.pagar(s[4]);
  perform pg_temp.igual((select (pagado_en is not null) || ' ' || (select count(*) from comisiones where solicitud_id = s[4]) from solicitudes where id = s[4]),
    'true 0'::text, 'Convenio sin comisión: se paga sin comisión');
  select promedio into prom2 from calcular_nivel(xg, ana, (mes_abierto_desde(xg, hoy_mx()) + interval '1 month')::date);
  perform pg_temp.igual(prom2, prom, 'Convenio sin comisión: no cuenta para el nivel');

  -- 5. Convenio con 10% fijo: sustituye el % del nivel y el cierre no lo recalcula.
  perform pg_temp.cotizar_y_aceptar(s[5], cuenta, 'fijo', 3000, null, null, conv_10);
  update convenios set comision_pct = 25 where id = conv_10;
  perform pg_temp.pagar(s[5]);
  perform pg_temp.igual((select porcentaje || ' ' || monto || ' ' || provisional from comisiones where solicitud_id = s[5]),
    '10.00 300.00 false'::text, 'Convenio 10%: comisión al % del convenio vigente al cotizar');
  perform recalcular_comisiones_del_mes(xg, mes_abierto_desde(xg, hoy_mx()));
  perform pg_temp.igual((select porcentaje from comisiones where solicitud_id = s[5]), 10.00::numeric, 'El cierre no le pone el % del nivel');

  -- 6. Convenio "sin costo" por servicio y trabajo directo estimado.
  update solicitudes set marca_id = (select id from marcas where organizacion_id = xg limit 1), cuenta_receptora_id = cuenta,
         monto_honorarios = 7000, honorario_tipo = 'estimado', estado = 'tramite', estatus_publico = 'aceptada', aceptada_en = now()
   where id = s[6];
  perform pg_temp.igual((select honorario_estimado from solicitudes where id = s[6]), 7000.00::numeric,
    'Cotizar y aceptar (trámite directo) estimado: guarda su estimado');
  update solicitudes set externo_id = 'pagina-estimado' where id = s[6];
  perform pg_temp.como('xchel@arqosuv.com');
  perform fijar_honorario_final(s[6], 6500, 'Ajuste final');
  perform pg_temp.sistema();
  perform pg_temp.igual((select count(*) from por_actualizar_monto_afuera(pg_temp.notion_xg()) where solicitud_id = s[6] and monto = 6500),
    1::bigint, 'Notion: "Cotización" se actualiza al fijar el final');
  perform registrar_monto_afuera(pg_temp.notion_xg(), s[6]);
  perform pg_temp.igual((select count(*) from por_actualizar_monto_afuera(pg_temp.notion_xg()) where solicitud_id = s[6]), 0::bigint,
    'Y una vez escrito, ya no se vuelve a mandar');
end;
$$;

-- @@ Guardar convenio en una pantalla
-- Lo que hace "Guardar" en Catálogos → Convenios: datos y precios juntos.
do $$
declare
  xg    uuid := pg_temp.xg();
  s1    uuid;  s2  uuid;  s3 uuid;
  marca uuid;
  conv  uuid;
begin
  perform pg_temp.sistema();
  select id into s1 from servicios where organizacion_id = xg and activo order by nombre limit 1;
  select id into s2 from servicios where organizacion_id = xg and activo order by nombre offset 1 limit 1;
  select id into s3 from servicios where organizacion_id = xg and activo order by nombre offset 2 limit 1;
  select id into marca from marcas where organizacion_id = xg limit 1;

  perform pg_temp.como('xchel@arqosuv.com');
  conv := guardar_convenio(null,
    jsonb_build_object('nombre', 'Notaría 4', 'contacto', 'Lic. Ruiz', 'vigente_desde', '2026-11-01', 'vigente_hasta', '2027-10-31',
                       'notas', 'Convenio anual', 'comision_regla', 'ninguna'),
    jsonb_build_array(
      jsonb_build_object('servicio_id', s1, 'honorario_tipo', 'sin_costo', 'nota', 'Sin costo si contrata el avalúo'),
      jsonb_build_object('servicio_id', s2, 'marca_id', marca, 'honorario_tipo', 'fijo', 'monto', '3500'),
      jsonb_build_object('servicio_id', s3, 'honorario_tipo', 'estimado', 'monto', '9000', 'monto_minimo', '6000')));
  perform pg_temp.igual(
    (select string_agg(cp.honorario_tipo || ':' || cp.monto || ':' || coalesce(cp.monto_minimo::text, '-') || ':' || cp.sin_costo, ' ' order by cp.honorario_tipo)
       from convenio_precios cp where cp.convenio_id = conv),
    'estimado:9000.00:6000.00:false fijo:3500.00:-:false sin_costo:0.00:-:true'::text,
    'Se guardan datos y precios juntos: fijo, sin costo y estimado con rango');
  perform pg_temp.igual((select nota from convenio_precios where convenio_id = conv and servicio_id = s1), 'Sin costo si contrata el avalúo'::text,
    'Con su nota');

  -- Editar: se quita un servicio y se cambia otro.
  perform guardar_convenio(conv,
    jsonb_build_object('nombre', 'Notaría 4', 'comision_regla', 'fija', 'comision_pct', '12.5', 'activo', true),
    jsonb_build_array(jsonb_build_object('servicio_id', s2, 'honorario_tipo', 'fijo', 'monto', '3800')));
  perform pg_temp.igual((select count(*) || ' ' || max(monto) from convenio_precios where convenio_id = conv), '1 3800.00'::text,
    'Al editar, lo que ya no viene se quita y lo demás se reemplaza');
  perform pg_temp.igual((select comision_regla || ' ' || comision_pct from convenios where id = conv), 'fija 12.50'::text, 'Y la comisión cambia');

  -- Si algo no cuadra, no se guarda nada y el mensaje dice qué.
  perform pg_temp.debe_fallar(format($q$select guardar_convenio(%L, '{"nombre":"Notaría 4","comision_regla":"normal"}',
    jsonb_build_array(jsonb_build_object('servicio_id', %L, 'honorario_tipo', 'fijo', 'monto', '')))$q$, conv, s1),
    'escribe el precio', 'Precio vacío: mensaje claro con el servicio');
  perform pg_temp.igual((select comision_regla from convenios where id = conv), 'fija'::text, 'Y no se guardó nada a medias');
  perform pg_temp.debe_fallar($q$select guardar_convenio(null, '{"nombre":"X","comision_regla":"normal"}', '[]')$q$,
    'nombre del cliente', 'Nombre obligatorio');
  perform pg_temp.debe_fallar($q$select guardar_convenio(null, '{"nombre":"Otro","comision_regla":"fija"}', '[]')$q$,
    'fijo de comisión', 'El % fijo es obligatorio');
  perform pg_temp.debe_fallar($q$select guardar_convenio(null, '{"nombre":"Otro","vigente_desde":"2027-01-01","vigente_hasta":"2026-01-01"}', '[]')$q$,
    'vigencia', 'Vigencia al revés');
  perform pg_temp.como('gaby@tasa.test');
  perform pg_temp.debe_fallar($q$select guardar_convenio(null, '{"nombre":"De finanzas"}', '[]')$q$,
    'Solo administración', 'Finanzas no edita convenios');

  -- El código anterior solo escribía sin_costo: se sigue entendiendo.
  perform pg_temp.como('xchel@arqosuv.com');
  insert into convenio_precios (convenio_id, servicio_id, sin_costo, monto) values (conv, s3, true, 0);
  perform pg_temp.igual((select honorario_tipo from convenio_precios where convenio_id = conv and servicio_id = s3), 'sin_costo'::text,
    'Un precio guardado como sin_costo queda de tipo sin costo');
end;
$$;

-- @@ Organización DEMO: nada sale de Tasa
do $$
declare
  v_demo uuid := (select id from organizaciones where slug = 'demo');
  s      uuid;
begin
  perform pg_temp.sistema();
  update organizaciones set demo = true where id = v_demo;
  perform pg_temp.igual(organizacion_es_demo('demo'), true, 'La app sabe que DEMO es demo (y no le manda correos)');
  perform pg_temp.igual(organizacion_es_demo('xg'), false, 'XG no es demo');

  -- Notion: no se activa ni se sincroniza.
  perform pg_temp.como('xchel+demo-admin@arqosuv.com');
  perform pg_temp.debe_fallar($q$select activar_conector('notion')$q$, 'demostración', 'DEMO no se conecta a Notion');
  perform pg_temp.sistema();
  insert into conectores (organizacion_id, tipo, activo, credencial_id) values (v_demo, 'notion', true, gen_random_uuid())
  on conflict do nothing;
  perform pg_temp.igual((select count(*) from conectores_para_sincronizar() where organizacion_id = v_demo), 0::bigint,
    'Aunque tuviera un conector activo, el cron no lo sincroniza');
  delete from conectores where organizacion_id = v_demo and tipo = 'notion';

  -- Cron: no le vence cotizaciones.
  perform set_config('tasa.org', v_demo::text, true);
  insert into solicitudes (organizacion_id, comisionista_id, tipo, servicio_id, inmueble_direccion, cliente_nombre)
  select v_demo, c.persona_id, 'cotizacion', (select id from servicios where organizacion_id = v_demo limit 1), 'Calle Vencida', 'Cliente Demo Vencido'
    from comisionistas c where c.organizacion_id = v_demo limit 1
  returning id into s;
  insert into cotizaciones (solicitud_id, monto_honorarios, cuenta_receptora_id, vigente_hasta)
  values (s, 1000, (select id from cuentas_receptoras where organizacion_id = v_demo limit 1), hoy_mx() + 1);
  update cotizaciones set vigente_hasta = hoy_mx() - 1 where solicitud_id = s;
  perform vencer_cotizaciones();
  perform pg_temp.igual((select estado from solicitudes where id = s), 'cotizada'::text, 'El cron no vence cotizaciones de DEMO');
end;
$$;

-- @@ Bono de referidos
-- Cada regla del bono, con el mes en curso (abierto) como mes del cálculo.
-- Los trabajos pagados se insertan con su mes de cierre para poder armar
-- historia (activos, vigencia, pérdida) sin esperar meses.
create function pg_temp.comisionista(p_nombre text, p_referidor uuid default null, p_alta date default null, p_tel text default null)
returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into personas (nombre, correo, telefono, organizacion_activa)
  values (p_nombre, lower(replace(p_nombre, ' ', '.')) || '@ref.test', p_tel, pg_temp.xg()) returning id into v;
  insert into membresias (persona_id, organizacion_id, rol) values (v, pg_temp.xg(), 'comisionista');
  insert into comisionistas (persona_id, slug, fecha_alta, referido_por, curp)
  values (v, lower(replace(p_nombre, ' ', '-')), coalesce(p_alta, (mes_de(hoy_mx()) - interval '12 months')::date), p_referidor,
          'REFX900101H' || translate(substr(md5(p_nombre), 1, 5), '0123456789abcdef', 'ABCDEFGHIJKLMNOP') || '00');
  return v;
end;
$$;

-- Un trabajo pagado de `p_com` en el mes `p_mes` (honorarios, y opcionalmente su comisión ya devengada en %).
create function pg_temp.pagado(p_com uuid, p_honorarios numeric, p_mes date, p_pct_comision numeric default null,
                               p_regla text default 'normal', p_terceros numeric default 0)
returns uuid language plpgsql as $$
declare s uuid; base solicitudes%rowtype;
begin
  select * into base from solicitudes where organizacion_id = pg_temp.xg() and marca_id is not null and cuenta_receptora_id is not null limit 1;
  insert into solicitudes (comisionista_id, tipo, origen, servicio_id, inmueble_direccion, cliente_nombre, marca_id, cuenta_receptora_id,
                           requiere_factura, monto_honorarios, monto_terceros, estado, estatus_publico, aceptada_en,
                           pagado_en, mes_cierre, comision_regla, comision_pct)
  values (p_com, 'tramite_directo', 'admin', base.servicio_id, 'Calle Referidos', 'Cliente Referidos', base.marca_id, base.cuenta_receptora_id,
          true, p_honorarios, p_terceros, 'tramite', 'pagado', p_mes, p_mes + 5, mes_de(p_mes), p_regla,
          case when p_regla = 'fija' then 10 end)
  returning id into s;
  -- Sin convenio la base pone "normal"; aquí se simula la regla que traería un convenio.
  update solicitudes set comision_regla = p_regla, comision_pct = case when p_regla = 'fija' then 10 end where id = s;
  if p_pct_comision is not null then
    insert into comisiones (comisionista_id, solicitud_id, tipo, base, porcentaje, monto, mes, nota)
    values (p_com, s, 'comision', p_honorarios, p_pct_comision, round(p_honorarios * p_pct_comision / 100, 2), mes_de(p_mes), 'Prueba');
  end if;
  return s;
end;
$$;

do $$
declare
  xg   uuid := pg_temp.xg();
  m    date := mes_de(hoy_mx());
  r    uuid;  r2 uuid;  r3 uuid;  q uuid[] := '{}';  z uuid;  vieja uuid;  s uuid;  t uuid;  eva uuid;
  i    integer;
  v    uuid;
begin
  perform pg_temp.sistema();
  perform set_config('tasa.org', xg::text, true);

  -- Escala.
  perform pg_temp.igual((select string_agg(escalon_referidos(xg, n)::text, ' ' order by n) from unnest(array[0,1,2,3,4,5,7,8,20]) n),
    '0 2.00 2.00 3.00 3.00 4.00 4.00 5.00 5.00'::text, 'Escala: 1–2 → 2%, 3–4 → 3%, 5–7 → 4%, 8+ → 5%');

  -- Rita refiere a 3; los 3 activos y ella también (trabajo pagado este mes) → 3%.
  r := pg_temp.comisionista('Rita Ref', null, null, '4425550001');
  perform pg_temp.pagado(r, 5000, m);
  for i in 1..3 loop
    q := q || pg_temp.comisionista('Ref Q' || i, r);
  end loop;
  perform pg_temp.igual((select count(*) from vinculos_referido where referidor_id = r and estado = 'activo'), 3::bigint,
    'Cada referido tiene su vínculo (sigue a referido_por)');
  perform pg_temp.igual((select count(*) from vinculos_referido where referidor_id = r and inicio is null), 3::bigint,
    'Vínculo en espera hasta el primer trabajo pagado del referido');
  s := pg_temp.pagado(q[1], 10000, m, null, 'normal', 2000);
  perform pg_temp.pagado(q[2], 8000, m);
  perform pg_temp.pagado(q[3], 6000, m);
  perform pg_temp.igual((select porcentaje || ' ' || monto from bonos_referido_calculados(xg, m) where solicitud = s),
    '3.00 300.00'::text, 'Base: honorarios sin IVA ni terceros (10,000 × 3%), con 3 activos');

  -- Un referido sin trabajo pagado en los últimos 3 meses no cuenta como activo.
  vieja := pg_temp.comisionista('Ref Viejo', r);
  perform pg_temp.pagado(vieja, 4000, (m - interval '3 months')::date);
  perform pg_temp.igual((select max(activos) from bonos_referido_calculados(xg, m) where beneficiario = r), 3,
    'Activo = trabajo pagado en los últimos 3 meses (el de hace 4 no cuenta)');
  -- Dos activos más → 5 → 4%.
  for i in 4..5 loop
    q := q || pg_temp.comisionista('Ref Q' || i, r);
    perform pg_temp.pagado(q[i], 3000, (m - interval '1 month')::date);
  end loop;
  perform pg_temp.igual((select porcentaje from bonos_referido_calculados(xg, m) where solicitud = s), 4.00::numeric,
    'Con 5 referidos activos sube a 4%');

  -- Sin costo y convenio "sin comisión" no generan bono.
  t := pg_temp.pagado(q[2], 2000, m, null, 'ninguna');
  perform pg_temp.igual((select count(*) from bonos_referido_calculados(xg, m) where solicitud = t), 0::bigint,
    'Convenio sin comisión: no genera bono');

  -- Tope 30%: el referido con 28% → el bono (4%) se recorta a 2% y queda anotado.
  t := pg_temp.pagado(q[3], 10000, m, 28);
  perform pg_temp.igual((select monto || ' ' || tope_ajustado || ' ' || bruto from bonos_referido_calculados(xg, m) where solicitud = t),
    '200.00 true 400.00'::text, 'Tope 30% por trabajo: se recorta el bono, no la comisión del referido');

  -- Al guardar (cierre): comisiones tipo referido con nota; la comisión del referido no cambia.
  perform calcular_bonos_referido(xg, m);
  perform pg_temp.igual((select count(*) from comisiones where comisionista_id = r and mes = m and tipo = 'referido'), 4::bigint,
    'El cierre guarda una línea "Bono de referidos" por trabajo');
  perform pg_temp.igual((select nota like 'Bono ajustado por tope%' from comisiones where solicitud_id = t and tipo = 'referido'), true,
    'La línea recortada dice "Bono ajustado por tope"');
  perform pg_temp.igual((select monto from comisiones where solicitud_id = t and tipo = 'comision'), 2800.00::numeric,
    'Sale de la reserva: la comisión del referido queda igual');
  perform calcular_bonos_referido(xg, m);
  perform pg_temp.igual((select count(*) from comisiones where comisionista_id = r and mes = m and tipo = 'referido'), 4::bigint,
    'Recalcular no duplica');

  -- Un solo nivel: Z, referido de Q1, genera bono a Q1 (si está activo), nunca a Rita.
  z := pg_temp.comisionista('Ref Z', q[1]);
  t := pg_temp.pagado(z, 5000, m);
  perform pg_temp.igual((select string_agg(beneficiario::text, ',') from bonos_referido_calculados(xg, m) where solicitud = t), q[1]::text,
    'Un solo nivel: el referido del referido no le genera bono al primero');

  -- Vigencia: 12 meses desde el primer trabajo pagado (no desde el registro).
  v := (select id from vinculos_referido where referido_id = vieja);
  t := pg_temp.pagado(vieja, 1000, (m - interval '14 months')::date);
  t := pg_temp.pagado(vieja, 7000, m);
  perform pg_temp.igual((select count(*) from bonos_referido_calculados(xg, m) where solicitud = t), 0::bigint,
    'Vencido: primer pago hace 14 meses, ya no genera bono');
  perform pg_temp.como('gaby@tasa.test');
  perform pg_temp.debe_fallar(format($q$select cambiar_vinculo(%L, 'ampliar', hoy_mx() + 60, 'Convenio especial')$q$, v), 'Solo admin_org',
    'Solo admin_org cambia la vigencia');
  perform pg_temp.como('xchel@arqosuv.com');
  perform pg_temp.debe_fallar(format($q$select cambiar_vinculo(%L, 'ampliar', hoy_mx() + 60, '')$q$, v), 'motivo', 'Con motivo');
  perform cambiar_vinculo(v, 'ampliar', hoy_mx() + 60, 'Convenio especial');
  perform pg_temp.sistema();
  perform pg_temp.igual((select count(*) from bonos_referido_calculados(xg, m) where solicitud = t), 1::bigint, 'Ampliar: vuelve a generar');
  perform pg_temp.como('xchel@arqosuv.com');
  perform cambiar_vinculo(v, 'quitar', null, 'Ya no aplica');
  perform pg_temp.sistema();
  perform pg_temp.igual((select count(*) from bonos_referido_calculados(xg, m) where solicitud = t), 0::bigint, 'Quitar: ya no genera');
  perform pg_temp.igual((select string_agg(tipo, ',' order by creado_en) from eventos_vinculo where vinculo_id = v), 'ampliar,quitar'::text,
    'Cada cambio queda en su historial (y en bitácora)');

  -- Actividad del que refiere: sin trabajo pagado en 3 meses, ese mes no cobra.
  r2 := pg_temp.comisionista('Raul Inactivo');
  perform pg_temp.pagado(r2, 3000, (m - interval '4 months')::date);
  q := q || pg_temp.comisionista('Ref de Raul', r2);
  t := pg_temp.pagado(q[6], 9000, m);
  perform pg_temp.igual((select count(*) from bonos_referido_calculados(xg, m) where solicitud = t), 0::bigint,
    'El que refiere sin trabajos pagados en 3 meses no cobra ese mes (no se acumula)');

  -- Pérdida: 6 meses sin trabajos pagados → vínculos liberados.
  r3 := pg_temp.comisionista('Rosa Perdida', null, (m - interval '10 months')::date);
  perform pg_temp.pagado(r3, 3000, (m - interval '7 months')::date);
  q := q || pg_temp.comisionista('Ref de Rosa', r3);
  perform actualizar_vinculos(xg, m);
  perform pg_temp.igual((select estado from vinculos_referido where referido_id = q[7]), 'liberado'::text,
    '6 meses sin trabajos pagados: sus referidos quedan liberados');
  perform pg_temp.igual((select count(*) from eventos_vinculo e join vinculos_referido vr on vr.id = e.vinculo_id
                          where vr.referido_id = q[7] and e.tipo = 'liberar'), 1::bigint, 'Con su evento');
  perform pg_temp.igual((select inicio is not null from vinculos_referido where referido_id = q[1]), true,
    'Al aprobar, el vínculo arranca con el primer trabajo pagado del referido');

  -- Equipo: % fijo con los dos interruptores; admin_org nunca.
  insert into personas (nombre, correo, organizacion_activa) values ('Eva Bono', 'eva.bono@ref.test', xg) returning id into eva;
  insert into membresias (persona_id, organizacion_id, rol, bono_referido, bono_referido_pct) values (eva, xg, 'equipo', true, 2.5);
  q := q || pg_temp.comisionista('Ref de Eva');
  update comisionistas set referido_por_miembro = eva where persona_id = q[8];
  t := pg_temp.pagado(q[8], 8000, m);
  update ajustes set bono_referido_equipo = false where organizacion_id = xg;
  perform pg_temp.igual((select count(*) from bonos_referido_calculados(xg, m) where solicitud = t), 0::bigint,
    'Equipo: con el interruptor de la organización apagado no cobra');
  update ajustes set bono_referido_equipo = true where organizacion_id = xg;
  perform pg_temp.igual((select tipo || ' ' || porcentaje || ' ' || monto from bonos_referido_calculados(xg, m) where solicitud = t),
    'equipo 2.50 200.00'::text, 'Equipo: su % fijo, sin escala');
  perform calcular_bonos_referido(xg, m);
  perform pg_temp.igual((select count(*) from bonos_equipo where persona_id = eva and mes = m), 1::bigint, 'Va en bonos_equipo (registro aparte)');
  update membresias set bono_referido = true, bono_referido_pct = 5 where persona_id = (select id from personas where correo = 'xchel@arqosuv.com') and organizacion_id = xg;
  update comisionistas set referido_por_miembro = (select id from personas where correo = 'xchel@arqosuv.com') where persona_id = q[8];
  perform pg_temp.igual((select count(*) from bonos_referido_calculados(xg, m) where solicitud = t), 0::bigint, 'admin_org nunca cobra');

  -- Antifraude: el mismo teléfono anula el código al pedir el alta; la misma CLABE anula el vínculo.
  perform pg_temp.igual(es_autorreferido(xg, r, 'otro@correo.test', null, null, '+52 442 555 0001'), true,
    'Mismo teléfono que quien invita: autorreferido');
  update comisionistas set clabe_cobro = '002180000000000012' where persona_id = r;
  update comisionistas set clabe_cobro = '002180000000000012' where persona_id = q[2];
  perform pg_temp.igual((select estado from vinculos_referido where referido_id = q[2]), 'anulado'::text,
    'Misma CLABE de cobro que quien lo invitó: vínculo anulado');
  perform pg_temp.debe_fallar($q$update comisionistas set clabe_cobro = '002180000000000013' where persona_id = (select id from personas where correo = 'rita.ref@ref.test')$q$,
    'comisionistas_clabe_cobro_check', 'La CLABE de cobro se valida con su dígito de control');

  -- Lo que ve el que refiere.
  insert into auth.users (email) values ('rita.ref@ref.test');
  perform pg_temp.como('rita.ref@ref.test');
  perform pg_temp.igual((select count(*) > 0 from mis_referidos()), true, 'El que refiere ve "Mis referidos"');
  -- Le quedan 4 activos (uno anulado por CLABE y otro quitado): 3%, y el siguiente escalón es desde 5.
  perform pg_temp.igual((select activos || ' ' || porcentaje || ' ' || siguiente_desde from mi_resumen_referidos()), '4 3.00 5'::text,
    'Ve su escalón actual y desde cuántos activos sube');
end;
$$;

-- @@ Fin
do $$ begin raise notice 'Verificaciones correctas.'; end $$;

rollback;
