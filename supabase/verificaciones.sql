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

create function pg_temp.igual(p_real anyelement, p_esperado anyelement, p_que text) returns void language plpgsql as $$
begin
  if p_real is distinct from p_esperado then
    raise exception 'FALLA — %: esperaba %, salió %', p_que, p_esperado, p_real;
  end if;
  raise notice 'ok — %', p_que;
end;
$$;

grant execute on all functions in schema pg_temp to anon, authenticated;

-- @@ Niveles
do $$
declare
  ana   uuid := (select id from personas where correo = 'xchel+ana@arqosuv.com');
  beto  uuid := (select id from personas where correo = 'xchel+beto@arqosuv.com');
  carla uuid := (select id from personas where correo = 'xchel+carla@arqosuv.com');
begin
  perform pg_temp.igual((select promedio from calcular_nivel(ana, '2026-07-01')), 36000::numeric,
    'Ana para julio: solo junio cuenta (alta en junio) → 36,000 / 1');
  perform pg_temp.igual((select porcentaje from calcular_nivel(ana, '2026-07-01')), 12.50::numeric,
    'Ana para julio: 36,000 ≥ 30,000 → Socio 12.5%');
  perform pg_temp.igual((select promedio from calcular_nivel(ana, '2026-08-01')), 18000::numeric,
    'Ana para agosto: jun + jul (julio en cero cuenta) → 18,000');
  perform pg_temp.igual((select promedio from calcular_nivel(ana, '2026-09-01')), 12000::numeric,
    'Ana para septiembre: jun-jul-ago → 12,000, Aliado');
  perform pg_temp.igual((select porcentaje from calcular_nivel(ana, '2026-10-01')), 5.00::numeric,
    'Ana para octubre: junio sale de la ventana → 0, Enlace 5%');
  perform pg_temp.igual((select meses_considerados from calcular_nivel(ana, '2026-12-01')), 3::smallint,
    'La ventana nunca pasa de 3 meses');
  perform pg_temp.igual((select meses_considerados from calcular_nivel(beto, '2026-10-01')), 2::smallint,
    'Beto (alta agosto): para octubre cuenta ago y sep');
  perform pg_temp.igual((select meses_considerados from calcular_nivel(carla, '2026-10-01')), 1::smallint,
    'Carla (alta 15 sep): para octubre cuenta solo sep');
  perform pg_temp.igual((select meses_considerados from calcular_nivel(beto, '2026-08-01')), 0::smallint,
    'Beto para agosto: todavía no estaba dado de alta en la ventana → 0 meses, Enlace');

  update comisionistas set porcentaje_forzado = 20 where persona_id = carla;
  perform pg_temp.igual((select porcentaje from calcular_nivel(carla, '2026-10-01')), 20::numeric,
    'Élite: el porcentaje forzado manda en el cálculo');
  perform pg_temp.igual(porcentaje_vigente(carla, '2026-11-01'), 20::numeric,
    'Élite: también en el porcentaje vigente');
  perform pg_temp.igual(porcentaje_es_provisional(carla, '2026-11-01'), false,
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
    format($q$select ejecutar_preparacion_cierre(%L, null)$q$, mes_de(hoy_mx())),
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
  t4  uuid := (select id from solicitudes where notion_page_id = 'simulado-0004');
  t10 uuid := (select id from solicitudes where folio = 'MGP-2026-9010');
begin
  perform pg_temp.igual(
    registrar_lectura_notion('simulado-0004', 'Pendiente de folio – Inmobiliaria Norte', 'Por asignar', null),
    'sin_cambios'::text, 'Página sin folio: no pasa nada');
  perform pg_temp.igual((select folio from solicitudes where id = t4), null::text,
    'Sigue sin folio → "Aceptada – folio en asignación"');

  perform pg_temp.igual(
    registrar_lectura_notion('simulado-0004', 'MGP-2026-0590 Inmobiliaria Norte', 'Por asignar', '2026-10-30'),
    'actualizado'::text, 'Aparece el folio en el título');
  perform pg_temp.igual((select folio from solicitudes where id = t4), 'MGP-2026-0590'::text,
    'Tasa copia el folio del título');
  perform pg_temp.igual((select estatus_publico from solicitudes where id = t4), 'visita_agendada'::text,
    'Con fecha de visita, "Por asignar" se muestra como visita agendada');

  perform registrar_lectura_notion('simulado-0004', 'MGP-2026-0590 Inmobiliaria Norte', 'En proceso', '2026-10-30');
  perform pg_temp.igual((select estatus_publico from solicitudes where id = t4), 'en_elaboracion'::text,
    '"En proceso" → en elaboración');

  perform registrar_lectura_notion('simulado-0004', 'MGP-2026-0590 Inmobiliaria Norte', 'Etapa nueva', null);
  perform pg_temp.igual((select estatus_publico from solicitudes where id = t4), 'en_elaboracion'::text,
    'Una etapa que no está en el mapeo no mueve el estatus');

  perform pg_temp.igual(
    registrar_lectura_notion('simulado-0004', 'MGP-2026-0590 Inmobiliaria Norte', 'Cancelado', null),
    'alerta'::text, 'Cancelado en Notion levanta una alerta');
  perform pg_temp.igual((select estado from solicitudes where id = t4), 'tramite'::text,
    'Pero NO cancela el trabajo');
  perform registrar_lectura_notion('simulado-0004', 'MGP-2026-0590 Inmobiliaria Norte', 'Cancelado', null);
  perform pg_temp.igual((select count(*) from alertas where solicitud_id = t4), 1::bigint,
    'Leer otra vez no duplica la alerta');

  perform cancelar_trabajo(t4, 'Confirmado: el cliente canceló');
  perform pg_temp.igual((select count(*) from alertas where solicitud_id = t4 and resuelta_en is null), 0::bigint,
    'Cancelar en Tasa cierra la alerta');

  perform registrar_lectura_notion('simulado-0010', 'MGP-2026-9010 Daniel Ochoa', 'En proceso', null);
  perform pg_temp.igual((select estatus_publico from solicitudes where id = t10), 'pagado'::text,
    'Notion no pisa el "pagado" de Tasa');
  perform pg_temp.igual(registrar_lectura_notion('no-existe', 'x', 'En proceso', null), 'sin_trabajo'::text,
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
  perform pg_temp.igual(v, 'contacto_soporte, correo_en_padron'::text, 'anon solo ejecuta correo_en_padron y contacto_soporte');

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
  perform pg_temp.igual(has_function_privilege('authenticated', 'ejecutar_aprobacion_cierre(date, uuid)', 'execute'), false,
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
  avaluo uuid := (select id from servicios where nombre = 'Avalúo Comercial');
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
    $q$select ejecutar_aprobacion_cierre('2026-10-01', null)$q$,
    'permission denied', 'La función interna del cierre no se alcanza desde el navegador');
  perform pg_temp.debe_fallar(
    $q$select preparar_cierre('2026-09-01')$q$,
    'Solo finanzas', 'El comisionista no prepara cierres');
  perform pg_temp.debe_fallar(
    $q$select registrar_lectura_notion('simulado-0005', 'x', 'Entregado', null)$q$,
    'Solo el staff', 'El comisionista no escribe estatus de Notion');

  perform pg_temp.como('gaby@tasa.test');
  perform pg_temp.debe_fallar(
    $q$select aprobar_cierre('2026-09-01')$q$,
    'Solo super_admin', 'Finanzas no aprueba cierres');
  perform pg_temp.debe_fallar(
    format($q$update solicitudes set cuenta_receptora_id = (select id from cuentas_receptoras where banco = 'Banregio') where id = %L$q$, t7),
    'solo super_admin', 'Finanzas no cambia la cuenta de un trabajo con pagos confirmados');
  perform pg_temp.igual((select count(*) from bitacora), 0::bigint, 'Finanzas no ve la bitácora');
  perform pg_temp.igual((select count(*) > 0 from alertas), true, 'Finanzas sí ve las alertas');

  perform pg_temp.como('xchel@arqosuv.com');
  execute format($q$update solicitudes set cuenta_receptora_id = (select id from cuentas_receptoras where banco = 'Banregio') where id = %L$q$, t7);
  perform pg_temp.igual(
    (select count(*) from bitacora where tabla = 'solicitudes' and registro_id = t7::text
        and antes->>'cuenta_receptora_id' is distinct from despues->>'cuenta_receptora_id'
        and rol = 'super_admin'), 1::bigint,
    'super_admin sí cambia la cuenta, y queda en bitácora con antes y después');

  perform pg_temp.como(null);
  perform pg_temp.debe_fallar($q$select count(*) from solicitudes$q$, 'permission denied',
    'anon no lee solicitudes');
  perform pg_temp.debe_fallar($q$select count(*) from personas$q$, 'permission denied',
    'anon no lee personas');
  perform pg_temp.debe_fallar($q$select count(*) from cuentas_receptoras$q$, 'permission denied',
    'anon no lee cuentas');
  perform pg_temp.debe_fallar($q$select count(*) from alertas$q$, 'permission denied',
    'anon no lee alertas');

  perform set_config('role', 'postgres', true);
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
  perform pg_temp.igual(contacto_soporte(), 'soporte@tasa.test'::text, 'super_admin configura el contacto');

  perform pg_temp.como(null);
  perform pg_temp.igual(contacto_soporte(), 'soporte@tasa.test'::text,
    'Sin sesión se ve solo el contacto (para la pantalla de acceso)');
  perform pg_temp.debe_fallar($q$select * from ajustes$q$, 'permission denied',
    'Sin sesión no se lee la tabla de ajustes');

  perform set_config('role', 'postgres', true);
  update ajustes set contacto_soporte = null;
end;
$$;

-- @@ Alias de cuenta
-- La cuenta se nombra por su alias en todo lo que es etiqueta; el
-- titular legal solo acompaña a la CLABE.
do $$
begin
  perform pg_temp.igual(
    (select string_agg(alias, ', ' order by alias) from cuentas_receptoras),
    'Banregio AP73, ROMI, Scotiabank XG'::text, 'Cada cuenta tiene su alias');
  perform pg_temp.igual(
    (select titular from cuentas_receptoras where alias = 'Scotiabank XG'), 'Xchel Guerrero'::text,
    'El titular real se conserva para los datos bancarios');
  perform pg_temp.igual(resumen_del_mes('2026-10-01')::text like '%Scotiabank XG%', true,
    'El resumen del cierre agrupa por alias');
  perform pg_temp.igual(resumen_del_mes('2026-10-01')::text like '%Xchel Guerrero%', false,
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
  perform pg_temp.igual(porcentaje_vigente(ana, '2026-10-01'), 5.00::numeric,
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

  perform ejecutar_preparacion_cierre('2026-10-01', null);
  perform ejecutar_aprobacion_cierre('2026-10-01', null);

  perform pg_temp.igual(porcentaje_vigente(beto, '2026-11-01'), 10.00::numeric,
    'Al aprobar octubre, Beto queda en Aliado para noviembre');
  perform pg_temp.igual((select monto from comisiones where solicitud_id = t5), 1200.00::numeric,
    'Si el real es mayor, la provisional sube: 10% de 12,000');
  perform pg_temp.igual((select provisional from comisiones where solicitud_id = t5), false,
    'Y deja de ser provisional');
  perform pg_temp.igual((select count(*) from comisiones where mes = '2026-10-01' and provisional), 0::bigint,
    'Nada de un mes aprobado queda provisional');
end;
$$;

-- @@ Fin
do $$ begin raise notice 'Verificaciones correctas.'; end $$;

rollback;
