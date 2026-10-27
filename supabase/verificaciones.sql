-- ============================================================
-- VERIFICACIONES — corren sobre la semilla de prueba y no dejan rastro.
--
-- Todo va dentro de begin … rollback: se puede correr las veces que
-- sea en el editor SQL de Supabase. Si algo falla, se detiene con el
-- mensaje de qué regla no se cumplió. Si todo pasa, el último aviso es
-- "Verificaciones correctas".
--
-- Las pruebas de RLS se hacen pasar por la persona de verdad
-- (`como()`): el editor corre como `postgres`, y ahí el RLS no aplica.
-- ============================================================

begin;

-- Amarra un usuario de autenticación a cada persona de la semilla.
insert into auth.users (id, email)
select gen_random_uuid(), correo from personas where correo like '%@tasa.test';

-- Cambia la sesión a la persona con ese correo (o a anon si es nulo).
create function pg_temp.como(p_correo text) returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  if p_correo is null then
    perform set_config('request.jwt.claims', '', true);
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

create function pg_temp.igual(p_real numeric, p_esperado numeric, p_que text) returns void language plpgsql as $$
begin
  if p_real is distinct from p_esperado then
    raise exception 'FALLA — %: esperaba %, salió %', p_que, p_esperado, p_real;
  end if;
  raise notice 'ok — %', p_que;
end;
$$;

grant execute on all functions in schema pg_temp to anon, authenticated;

do $$
declare
  t9  uuid := (select id from solicitudes where folio = 'PRUEBA-2026-0009');
  t8  uuid := (select id from solicitudes where folio = 'PRUEBA-2026-0008');
  t7  uuid := (select id from solicitudes where folio = 'PRUEBA-2026-0007');
  ana uuid := (select id from personas where correo = 'ana@tasa.test');
  beto uuid := (select id from personas where correo = 'beto@tasa.test');
  carla uuid := (select id from personas where correo = 'carla@tasa.test');
  v numeric;
begin
  -- ---------------------------------------------------------
  -- NIVELES
  -- ---------------------------------------------------------
  perform pg_temp.igual((select promedio from calcular_nivel(ana, '2026-10-01')), 12000,
    'Ana: promedio jul-sep con meses en cero = 36,000 / 3');
  perform pg_temp.igual((select meses_considerados from calcular_nivel(beto, '2026-10-01')), 2,
    'Beto (alta agosto): para octubre cuenta ago y sep');
  perform pg_temp.igual((select meses_considerados from calcular_nivel(carla, '2026-10-01')), 1,
    'Carla (alta 15 sep): para octubre cuenta solo sep');
  perform pg_temp.igual((select porcentaje from calcular_nivel(carla, '2026-10-01')), 5,
    'Carla sin ventas: Enlace 5%');
  perform pg_temp.igual((select meses_considerados from calcular_nivel(ana, '2026-12-01')), 3,
    'Ana para diciembre: ventana de 3 meses (sep-oct-nov)');
end;
$$;

do $$
declare
  ana uuid := (select id from personas where correo = 'ana@tasa.test');
  carla uuid := (select id from personas where correo = 'carla@tasa.test');
begin
  update comisionistas set fecha_alta = '2026-09-01' where persona_id = ana;
  perform pg_temp.igual((select porcentaje from calcular_nivel(ana, '2026-10-01')), 12.5,
    'Ana con alta en sep: 36,000 / 1 mes → Socio 12.5%');
  update comisionistas set fecha_alta = '2026-06-01' where persona_id = ana;

  update comisionistas set porcentaje_forzado = 20 where persona_id = carla;
  perform pg_temp.igual((select porcentaje from calcular_nivel(carla, '2026-10-01')), 20,
    'Élite: el porcentaje forzado manda');
  perform pg_temp.igual(porcentaje_vigente(carla, '2026-10-01'), 20,
    'Élite: también en el porcentaje vigente');
  update comisionistas set porcentaje_forzado = null where persona_id = carla;
end;
$$;

-- ---------------------------------------------------------
-- DEVENGO
-- ---------------------------------------------------------
do $$
declare
  t8   uuid := (select id from solicitudes where folio = 'PRUEBA-2026-0008');
  beto uuid := (select id from personas where correo = 'beto@tasa.test');
begin
  -- Trabajo 8: 6,000; 3,000 confirmados en sep y 3,000 directos por revisar.
  perform pg_temp.igual((select count(*) from comisiones where solicitud_id = t8), 0,
    'Sin el 100% no hay comisión');

  update pagos set estado = 'confirmado' where solicitud_id = t8 and estado = 'reportado';

  perform pg_temp.igual((select extract(day from pagado_en) from solicitudes where id = t8), 26,
    'pagado_en = fecha del pago que completa (hoy en la semilla: 26)');
  perform pg_temp.igual((select monto from comisiones where solicitud_id = t8), 300,
    'Beto: 5% de 6,000 al quedar pagado');
  perform pg_temp.igual((select count(*) from historial_estatus
                          where solicitud_id = t8 and estatus_publico = 'pagado'), 1,
    'El cambio a "pagado" queda en el historial para avisar por correo');
end;
$$;

do $$
declare
  t5 uuid := (select id from solicitudes where folio = 'PRUEBA-2026-0005');
  t7 uuid := (select id from solicitudes where folio = 'PRUEBA-2026-0007');
  t6 uuid := (select id from solicitudes where folio = 'PRUEBA-2026-0006');
  t9 uuid := (select id from solicitudes where folio = 'PRUEBA-2026-0009');
  ana uuid := (select id from personas where correo = 'ana@tasa.test');
begin
  -- Pago con fecha de un mes ya aprobado: cae en el siguiente abierto.
  insert into pagos (solicitud_id, via, monto, fecha_pago, referencia)
  values (t7, 'directo', 9000, '2026-09-30', 'tardío');
  update pagos set estado = 'confirmado' where referencia = 'tardío';
  perform pg_temp.igual((select extract(month from pagado_en) from solicitudes where id = t7), 10,
    'Fecha de pago 2 oct (completa con el de sep): pagado_en es la del que completa');

  perform pg_temp.debe_fallar(
    format($q$insert into pagos (solicitud_id, via, monto, fecha_pago, referencia)
              values (%L, 'directo', 1, '2026-10-01', 'x')$q$, t9),
    'ya está pagado', 'No se reciben pagos de un trabajo pagado');

  -- Trabajo 5: total 13,920 (12,000 + IVA). Confirmar de más se bloquea.
  insert into pagos (solicitud_id, via, monto, fecha_pago, referencia)
  values (t5, 'directo', 9000, hoy_mx(), 'de más');
  update pagos set estado = 'confirmado' where solicitud_id = t5 and referencia is null;
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
end;
$$;

-- ---------------------------------------------------------
-- TOPE 30%
-- ---------------------------------------------------------
do $$
declare
  t9  uuid := (select id from solicitudes where folio = 'PRUEBA-2026-0009');
  ana uuid := (select id from personas where correo = 'ana@tasa.test');
begin
  -- Trabajo 9: honorarios 36,000 → tope 10,800. Ya tiene 1,800.
  insert into comisiones (comisionista_id, solicitud_id, tipo, monto, mes)
  values (ana, t9, 'bono', 9000, '2026-10-01');
  perform pg_temp.igual((select sum(monto) from comisiones where solicitud_id = t9), 10800,
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
  values (ana, t9, 'cargo', -500, '2026-10-01', 'los cargos no cuentan para el tope');
  raise notice 'ok — los cargos no cuentan para el tope';
end;
$$;

-- ---------------------------------------------------------
-- CIERRE
-- ---------------------------------------------------------
do $$
declare
  t9  uuid := (select id from solicitudes where folio = 'PRUEBA-2026-0009');
  ana uuid := (select id from personas where correo = 'ana@tasa.test');
  c_sep uuid := (select id from comisiones where solicitud_id = t9 and tipo = 'comision');
begin
  perform pg_temp.debe_fallar(
    $q$select ejecutar_preparacion_cierre('2026-10-01', null)$q$,
    'no ha terminado', 'Octubre no se prepara antes del corte');
  perform pg_temp.debe_fallar(
    $q$update cierres set resumen = '{}' where mes = '2026-09-01'$q$,
    'no se reabre', 'Un cierre aprobado no se modifica');
  perform pg_temp.debe_fallar(
    $q$delete from cierres where mes = '2026-09-01'$q$,
    'no se borra', 'Un cierre aprobado no se borra');
  perform pg_temp.debe_fallar(
    format($q$update comisiones set monto = 1 where id = %L$q$, c_sep),
    'solo se puede marcar como pagada', 'La comisión de un mes cerrado no cambia de monto');
  perform pg_temp.debe_fallar(
    format($q$delete from comisiones where id = %L$q$, c_sep),
    'registra un cargo', 'La comisión de un mes cerrado no se borra');
  perform pg_temp.debe_fallar(
    format($q$insert into comisiones (comisionista_id, tipo, monto, mes) values (%L, 'ajuste', 10, '2026-09-01')$q$, ana),
    'ya está cerrado', 'No entra nada nuevo a un mes cerrado');

  update comisiones set estado = 'pagada', pagada_en = '2026-10-05' where id = c_sep;
  raise notice 'ok — lo de un mes cerrado sí se marca pagado';
  perform pg_temp.debe_fallar(
    $q$update comisiones set estado = 'pagada', pagada_en = '2026-10-05' where mes = '2026-10-01' and tipo = 'comision'$q$,
    'cierre aprobado', 'Lo de un mes abierto no se marca pagado');

  -- Cancelar un trabajo cuyo mes ya cerró: entra un cargo, no se borra.
  perform cancelar_trabajo(t9, 'El cliente desistió');
  perform pg_temp.igual(
    (select monto from comisiones where solicitud_id = t9 and tipo = 'cargo' and nota like 'Cancelación%'),
    -1800, 'Cancelación posterior al cierre → cargo de -1,800 en el mes abierto');
  perform pg_temp.igual(
    (select count(*) from comisiones where solicitud_id = t9 and tipo = 'bono'), 0,
    'El bono de un mes abierto se borra al cancelar');
  perform pg_temp.igual(
    (select count(*) from comisiones where id = c_sep), 1,
    'La comisión de septiembre sigue intacta');
end;
$$;

-- ---------------------------------------------------------
-- RLS: lo que ve y puede hacer cada quien
-- ---------------------------------------------------------
do $$
declare
  t7 uuid := (select id from solicitudes where folio = 'PRUEBA-2026-0007');
  t6 uuid := (select id from solicitudes where folio = 'PRUEBA-2026-0006');
  t5 uuid := (select id from solicitudes where folio = 'PRUEBA-2026-0005');
  avaluo uuid := (select id from servicios where nombre = 'Avalúo Comercial');
  beto uuid := (select id from personas where correo = 'beto@tasa.test');
  v numeric;
begin
  perform pg_temp.como('beto@tasa.test');

  perform pg_temp.igual((select count(*) from solicitudes), 3, 'Beto ve solo sus 3 trabajos');
  perform pg_temp.igual((select count(*) from comisiones where comisionista_id <> beto), 0,
    'Beto no ve comisiones ajenas');
  perform pg_temp.igual((select count(*) from personas), 1, 'Beto solo ve su propia persona');
  perform pg_temp.igual((select count(*) from bitacora), 0, 'Beto no ve la bitácora');
  perform pg_temp.igual((select count(*) from cuentas_receptoras), 2,
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
  perform pg_temp.igual((select count(*) from pagos where solicitud_id = t5 and estado = 'reportado'), 1,
    'El comisionista no confirma pagos (su intento no toca nada)');
  perform pg_temp.debe_fallar(
    $q$select ejecutar_aprobacion_cierre('2026-10-01', null)$q$,
    'permission denied', 'La función interna del cierre no se alcanza desde el navegador');
  perform pg_temp.debe_fallar(
    $q$select preparar_cierre('2026-09-01')$q$,
    'Solo finanzas', 'El comisionista no prepara cierres');

  perform pg_temp.como('gaby@tasa.test');
  perform pg_temp.debe_fallar(
    $q$select aprobar_cierre('2026-09-01')$q$,
    'Solo super_admin', 'Finanzas no aprueba cierres');
  perform pg_temp.debe_fallar(
    format($q$update solicitudes set cuenta_receptora_id = (select id from cuentas_receptoras where banco = 'Banregio') where id = %L$q$, t7),
    'solo super_admin', 'Finanzas no cambia la cuenta de un trabajo con pagos confirmados');
  perform pg_temp.igual((select count(*) from bitacora), 0, 'Finanzas no ve la bitácora');

  perform pg_temp.como('xchel@tasa.test');
  execute format($q$update solicitudes set cuenta_receptora_id = (select id from cuentas_receptoras where banco = 'Banregio') where id = %L$q$, t7);
  perform pg_temp.igual(
    (select count(*) from bitacora where tabla = 'solicitudes' and registro_id = t7::text
        and antes->>'cuenta_receptora_id' is distinct from despues->>'cuenta_receptora_id'
        and rol = 'super_admin'), 1,
    'super_admin sí cambia la cuenta, y queda en bitácora con antes y después');

  perform pg_temp.como(null);
  perform pg_temp.debe_fallar($q$select count(*) from solicitudes$q$, 'permission denied',
    'anon no lee solicitudes');
  perform pg_temp.debe_fallar($q$select count(*) from personas$q$, 'permission denied',
    'anon no lee personas');
  perform pg_temp.debe_fallar($q$select count(*) from cuentas_receptoras$q$, 'permission denied',
    'anon no lee cuentas');

  perform set_config('role', 'postgres', true);
  raise notice 'Verificaciones correctas.';
end;
$$;

rollback;
