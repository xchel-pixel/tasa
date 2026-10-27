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
  perform set_config('role', 'postgres', true);
end;
$$;

-- @@ Comisionistas
do $$
declare
  diego uuid;
begin
  perform pg_temp.como('gaby@tasa.test');
  diego := alta_comisionista('Diego Prueba', ' Xchel+Diego@arqosuv.com ', '4420000004', 'guxd800101ab1',
                             'diego-prueba', null, true);
  perform pg_temp.igual((select rol from personas where id = diego), 'comisionista'::text,
    'Finanzas da de alta un comisionista');
  perform pg_temp.igual((select correo from personas where id = diego), 'xchel+diego@arqosuv.com'::text,
    'El correo se guarda limpio y en minúsculas');
  perform pg_temp.igual((select rfc || '/' || emite_factura from comisionistas where persona_id = diego),
    'GUXD800101AB1/true'::text, 'RFC en mayúsculas y "emite factura"');
  perform pg_temp.debe_fallar(
    $q$select alta_comisionista('Otro', 'xchel+diego@arqosuv.com', null, null, 'otro', null, false)$q$,
    'ya está dado de alta', 'No se repite un correo');
  perform pg_temp.debe_fallar(
    $q$select alta_comisionista('Otro', 'otro@tasa.test', null, null, 'diego-prueba', null, false)$q$,
    'slug', 'No se repite la liga');
  perform pg_temp.igual((select count(*) from resumen_comisionistas()), 4::bigint,
    'El staff ve a los 4 comisionistas en la lista');
  perform pg_temp.debe_fallar(format('select forzar_elite(%L, 20)', diego),
    'Solo super_admin', 'Finanzas no fuerza Élite');
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
    $q$select alta_comisionista('X', 'x@tasa.test', null, null, 'x', null, false)$q$,
    'Solo finanzas', 'Un comisionista no da de alta a nadie');
  perform set_config('role', 'postgres', true);
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
  perform pg_temp.igual(vence_pago_comision('2026-09-01'), date '2026-10-10',
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
  perform set_config('role', 'postgres', true);
  update ajustes set dia_limite_pago_comision = 3;
  perform pg_temp.como('gaby@tasa.test');
  perform pg_temp.igual((select vencido from comisiones_por_pagar() where mes = '2026-10-01'), true,
    'Con el día límite en 3, octubre ya venció (el parámetro aplica a todos)');
  perform pg_temp.como('xchel+ana@arqosuv.com');
  perform pg_temp.igual((select count(*) from comisiones_por_pagar()), 0::bigint,
    'Un comisionista no lee la bandeja de comisiones por pagar');
  perform set_config('role', 'postgres', true);
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
    'Solo super_admin', 'Finanzas no agrega movimientos');
  perform set_config('role', 'postgres', true);

  -- Noviembre: Beto +1,200 (trabajo 5), Carla −500, Ana −500 (arrastre).
  create or replace function hoy_mx() returns date language sql stable as $f$ select date '2026-12-05' $f$;
  perform ejecutar_preparacion_cierre('2026-11-01', null);
  perform ejecutar_aprobacion_cierre('2026-11-01', null);

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
  efectivo uuid := (select id from origenes_pago where nombre = 'Efectivo');
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
  perform pg_temp.debe_fallar(format('select subir_factura_comision(%L, %L)', jun, beto || '/x.pdf'),
    'no es tuyo', 'Beto no sube factura a un pendiente ajeno');

  perform pg_temp.como('xchel+ana@arqosuv.com');
  perform pg_temp.igual((select count(*) from pendientes_comision), 1::bigint, 'Ana ve solo su pendiente');
  perform pg_temp.igual((select count(*) from mis_pagos_comision()), 1::bigint, 'Ana ve solo su pago (el de la semilla)');
  perform subir_factura_comision(jun, ana || '/factura-jun.pdf');
  perform pg_temp.igual((select factura_ruta from pendientes_comision where id = jun), ana || '/factura-jun.pdf',
    'Ana sube su factura del pendiente de junio');

  perform pg_temp.como('gaby@tasa.test');
  perform pg_temp.igual((select esperando_factura from comisiones_por_pagar() where pendiente_id = jun), false,
    'Con la factura subida, ya no espera factura');
  perform set_config('role', 'postgres', true);
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
  avaluo uuid := (select id from servicios where nombre = 'Avalúo Comercial');
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
    'Solo finanzas', 'El comisionista no revierte confirmaciones');

  perform pg_temp.como('gaby@tasa.test');
  perform pg_temp.debe_fallar(format('select revertir_pago(%L, %L)', p, '  '),
    'Escribe el motivo', 'Revertir pide motivo');
  perform revertir_pago(p, 'Se confirmó el pago equivocado');
  perform set_config('role', 'postgres', true);
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
  perform set_config('role', 'postgres', true);
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
  perform set_config('role', 'postgres', true);
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
    'Solo finanzas', 'El comisionista no anula cotizaciones');
  perform pg_temp.como('gaby@tasa.test');
  perform anular_cotizacion((select id from cotizaciones where solicitud_id = t2 and estado = 'emitida'), 'Precio equivocado');
  perform set_config('role', 'postgres', true);
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
    'Solo super_admin', 'Finanzas no anula movimientos');
  perform pg_temp.como('xchel@arqosuv.com');
  perform anular_movimiento(mov, 'Era para otra persona');
  perform pg_temp.igual((select sum(monto) from comisiones where id = mov or anula_id = mov), 0.00::numeric,
    'Anular un bono mete su contrario: los dos suman cero y ninguno se borra');
  perform pg_temp.debe_fallar(format('select anular_movimiento(%L, %L)', mov, 'x'),
    'ya estaba anulado', 'No se anula dos veces');
  perform set_config('role', 'postgres', true);
end;
$$;

-- @@ Fin
do $$ begin raise notice 'Verificaciones correctas.'; end $$;

rollback;
