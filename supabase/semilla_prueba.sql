-- ============================================================
-- SEMILLA DE PRUEBA — solo para un proyecto de pruebas, NUNCA en producción.
--
-- Corre después de todas las migraciones (`npm run db:resembrar`
-- deja la base en cero y la carga). Dos organizaciones:
--
-- XG (la de Xchel; la crea la migración 0015 con sus catálogos)
--   · Xchel: admin_org y super_plataforma. Gaby: finanzas.
--   · 3 comisionistas: Ana (alta junio), Beto (alta agosto), Carla (alta 15 sep).
--   · 10 trabajos en 9 estatus, con pagos parciales, un rechazo, un aviso
--     sin archivo, pagos directos de finanzas y uno en efectivo.
--   · Cierres de junio a septiembre 2026 aprobados; octubre abierto.
--   · Conector manual: el trabajo 4 recibe su folio de Tasa (MGP-2026-9011).
--
-- DEMO VALUADORES (para probar el aislamiento)
--   · demo-admin: admin_org. demo: comisionista.
--   · Una marca, una cuenta, dos servicios; un trabajo pagado en octubre
--     (folio DEMO-2026-0001, generado por Tasa) y una solicitud nueva.
--
-- Usa las mismas reglas que la aplicación: los pagos entran como
-- reportados y se confirman después, y la comisión la devenga el
-- disparador, no esta semilla.
--
-- La historia de Ana, que es la que prueba los niveles:
--   · Junio: cobra el trabajo 9 (36,000 de honorarios). Comisión 5%
--     = 1,800 (primer mes, sin nivel previo).
--   · Niveles que dejan los cierres:
--       julio      36,000 / 1 mes  → Socio 12.5%
--       agosto     36,000 / 2      → Aliado 10%
--       septiembre 36,000 / 3      → Aliado 10%
--       octubre         0 / 3      → Enlace 5%   (junio sale de la ventana)
--   · 2 de octubre: cobra el trabajo 10 (8,000) con septiembre todavía
--     abierto. La comisión nace PROVISIONAL con el nivel vigente
--     (septiembre, 10%) = 800. Al aprobar septiembre, su nivel real de
--     octubre resulta 5%: como lo provisional solo sube, se queda en
--     10% (800) y deja de ser provisional.
--
-- Los correos reales (alias xchel+…@arqosuv.com) permiten entrar con la
-- semilla cargada. Gaby sigue en .test.
--
-- Sin usuario, `mi_org()` lee `tasa.org`: así cada fila nace en la
-- organización correcta sin repetirla en cada insert.
-- ============================================================

do $$
declare
  xg  uuid := 'a0000000-0000-4000-8000-000000000001';
  v_xchel uuid; v_gaby uuid;
  v_ana uuid; v_beto uuid; v_carla uuid;
  v_avaluo uuid; v_hacend uuid; v_ov uuid;
  v_mgp uuid; v_ap73 uuid; v_xg uuid;
  v_romi uuid; v_banregio uuid; v_scotia uuid;
  t10 uuid;
  s uuid; p uuid;
begin
  perform set_config('tasa.org', xg::text, false);

  -- Personas y membresías ---------------------------------------
  insert into personas (nombre, correo, super_plataforma, organizacion_activa)
  values ('Xchel Guerrero', 'xchel@arqosuv.com', true, xg) returning id into v_xchel;
  insert into personas (nombre, correo, organizacion_activa) values ('Gaby', 'gaby@tasa.test', xg) returning id into v_gaby;
  insert into personas (nombre, correo, telefono, organizacion_activa)
  values ('Ana Prueba', 'xchel+ana@arqosuv.com', '4420000001', xg) returning id into v_ana;
  insert into personas (nombre, correo, telefono, organizacion_activa)
  values ('Beto Prueba', 'xchel+beto@arqosuv.com', '4420000002', xg) returning id into v_beto;
  insert into personas (nombre, correo, telefono, organizacion_activa)
  values ('Carla Prueba', 'xchel+carla@arqosuv.com', '4420000003', xg) returning id into v_carla;

  insert into membresias (persona_id, organizacion_id, rol) values
    (v_xchel, xg, 'admin_org'), (v_gaby, xg, 'finanzas'),
    (v_ana, xg, 'comisionista'), (v_beto, xg, 'comisionista'), (v_carla, xg, 'comisionista');

  insert into comisionistas (persona_id, slug, fecha_alta) values
    (v_ana,   'ana-prueba',   '2026-06-01'),
    (v_beto,  'beto-prueba',  '2026-08-01'),
    (v_carla, 'carla-prueba', '2026-09-15');

  -- Catálogos de XG (vienen de 0008) ----------------------------
  select id into v_avaluo from servicios where organizacion_id = xg and nombre = 'Avalúo Comercial';
  select id into v_hacend from servicios where organizacion_id = xg and nombre = 'Avalúo Hacendario';
  select id into v_ov     from servicios where organizacion_id = xg and nombre = 'Opinión de Valor';
  select id into v_mgp  from marcas where organizacion_id = xg and clave = 'MGP';
  select id into v_ap73 from marcas where organizacion_id = xg and clave = 'AP73';
  select id into v_xg   from marcas where organizacion_id = xg and clave = 'XG';
  -- Las cuentas de relleno de 0008 no pasan el dígito de control y 0021
  -- las quita: la semilla trae las suyas, con CLABE de prueba válidas.
  insert into cuentas_receptoras (titular, banco, clabe, marca_id, alias)
  values ('ROMI', 'Fondeadora', '002180000000000012', v_mgp, 'ROMI') returning id into v_romi;
  insert into cuentas_receptoras (titular, banco, clabe, marca_id, alias)
  values ('AP73', 'Banregio', '002180000000000025', v_ap73, 'Banregio AP73') returning id into v_banregio;
  insert into cuentas_receptoras (titular, banco, clabe, marca_id, alias)
  values ('Xchel Guerrero', 'Scotiabank', '002180000000000038', v_xg, 'Scotiabank XG') returning id into v_scotia;
  update marcas set cuenta_sugerida_id = v_romi where id = v_mgp;
  update marcas set cuenta_sugerida_id = v_banregio where id = v_ap73;
  update marcas set cuenta_sugerida_id = v_scotia where id = v_xg;

  -- 9. Pagado en junio, dos parciales (Ana) --------------------
  --    36,000 + IVA 5,760 + terceros 1,500 = 43,260
  insert into solicitudes (comisionista_id, tipo, servicio_id, inmueble_direccion, inmueble_municipio, cliente_nombre,
                           marca_id, cuenta_receptora_id, requiere_factura, monto_honorarios, monto_terceros,
                           estado, estatus_publico, folio, externo_id, estatus_externo, aceptada_en, creado_por)
  values (v_ana, 'cotizacion', v_avaluo, 'Nave industrial, Parque Bernardo Quintana', 'El Marqués', 'Grupo Industrial Bajío',
          v_mgp, v_romi, true, 36000, 1500, 'tramite', 'entregado',
          'MGP-2026-9009', 'simulado-0009', 'Entregado', '2026-06-01', v_ana)
  returning id into s;
  insert into pagos (solicitud_id, via, monto, fecha_pago, comprobante_ruta, reportado_por)
  values (s, 'comprobante', 20000, '2026-06-05', xg || '/' || v_ana || '/semilla-0009a.pdf', v_ana) returning id into p;
  update pagos set estado = 'confirmado', revisado_por = v_gaby where id = p;
  insert into pagos (solicitud_id, via, monto, fecha_pago, comprobante_ruta, reportado_por)
  values (s, 'comprobante', 23260, '2026-06-22', xg || '/' || v_ana || '/semilla-0009b.pdf', v_ana) returning id into p;
  update pagos set estado = 'confirmado', revisado_por = v_gaby where id = p;

  -- Cierres de junio, julio y agosto ---------------------------
  perform ejecutar_preparacion_cierre(xg, '2026-06-01', v_gaby);
  perform ejecutar_aprobacion_cierre(xg, '2026-06-01', v_xchel);
  perform ejecutar_preparacion_cierre(xg, '2026-07-01', v_gaby);
  perform ejecutar_aprobacion_cierre(xg, '2026-07-01', v_xchel);
  perform ejecutar_preparacion_cierre(xg, '2026-08-01', v_gaby);
  perform ejecutar_aprobacion_cierre(xg, '2026-08-01', v_xchel);

  -- 1. Solicitada (Beto) ---------------------------------------
  insert into solicitudes (comisionista_id, tipo, servicio_id, inmueble_direccion, inmueble_municipio, cliente_nombre, cliente_telefono, creado_por)
  values (v_beto, 'cotizacion', v_avaluo, 'Av. Zaragoza 120, Centro', 'Querétaro', 'Laura Méndez', '4421111111', v_beto);

  -- 2. Cotizada, vigente (Ana) ----------------------------------
  insert into solicitudes (comisionista_id, tipo, servicio_id, inmueble_direccion, inmueble_municipio, cliente_nombre, marca_id, creado_por)
  values (v_ana, 'cotizacion', v_hacend, 'Calle Hidalgo 45, El Pueblito', 'Corregidora', 'Jorge Salinas', v_ap73, v_ana)
  returning id into s;
  insert into cotizaciones (solicitud_id, requiere_factura, monto_honorarios, monto_terceros, cuenta_receptora_id, vigente_hasta, emitida_por)
  values (s, true, 9500, 2300, v_banregio, hoy_mx() + 10, v_xchel);

  -- 3. Vencida (Carla) -----------------------------------------
  insert into solicitudes (comisionista_id, tipo, servicio_id, inmueble_direccion, inmueble_municipio, cliente_nombre, marca_id, creado_por)
  values (v_carla, 'cotizacion', v_ov, 'Privada Los Arcos 8, Juriquilla', 'Querétaro', 'Marta Ríos', v_mgp, v_carla)
  returning id into s;
  insert into cotizaciones (solicitud_id, monto_honorarios, cuenta_receptora_id, vigente_hasta, emitida_por)
  values (s, 3500, v_romi, '2026-10-01', v_xchel);
  perform vencer_cotizaciones();

  -- 5. Visita agendada, pago con comprobante por revisar (Beto) --
  insert into solicitudes (comisionista_id, tipo, servicio_id, inmueble_direccion, inmueble_municipio, cliente_nombre,
                           marca_id, cuenta_receptora_id, requiere_factura, monto_honorarios, monto_terceros,
                           estado, estatus_publico, folio, externo_id, estatus_externo, aceptada_en, creado_por)
  values (v_beto, 'cotizacion', v_avaluo, 'Calle Madero 77, Centro', 'Querétaro', 'Rubén Torres',
          v_mgp, v_romi, true, 12000, 0, 'tramite', 'visita_agendada',
          'MGP-2026-9005', 'simulado-0005', 'Por asignar', now() - interval '6 days', v_beto)
  returning id into s;
  insert into pagos (solicitud_id, via, monto, fecha_pago, comprobante_ruta, reportado_por)
  values (s, 'comprobante', 7000, hoy_mx() - 1, xg || '/' || v_beto || '/semilla-0005.jpg', v_beto);

  -- 6. En elaboración: anticipo confirmado + aviso sin archivo (Carla)
  insert into solicitudes (comisionista_id, tipo, servicio_id, inmueble_direccion, inmueble_municipio, cliente_nombre,
                           marca_id, cuenta_receptora_id, monto_honorarios, monto_terceros,
                           estado, estatus_publico, folio, externo_id, estatus_externo, aceptada_en, creado_por)
  values (v_carla, 'cotizacion', v_hacend, 'Av. Constituyentes 900', 'Querétaro', 'Sofía Lara',
          v_ap73, v_banregio, 11000, 1800, 'tramite', 'en_elaboracion',
          'MGP-2026-9006', 'simulado-0006', 'En proceso', '2026-10-05', v_carla)
  returning id into s;
  insert into pagos (solicitud_id, via, monto, fecha_pago, comprobante_ruta, reportado_por)
  values (s, 'comprobante', 6000, '2026-10-06', xg || '/' || v_carla || '/semilla-0006.pdf', v_carla) returning id into p;
  update pagos set estado = 'confirmado', revisado_por = v_gaby where id = p;
  insert into pagos (solicitud_id, via, monto, fecha_pago, nota, reportado_por)
  values (s, 'aviso', 3000, hoy_mx(), 'El cliente dice que transfirió hoy en la mañana', v_carla);

  -- 7. En revisión: parcial confirmado + uno rechazado (Ana) ----
  insert into solicitudes (comisionista_id, tipo, servicio_id, inmueble_direccion, inmueble_municipio, cliente_nombre,
                           marca_id, cuenta_receptora_id, monto_honorarios,
                           estado, estatus_publico, folio, externo_id, estatus_externo, aceptada_en, creado_por)
  values (v_ana, 'cotizacion', v_avaluo, 'Fracc. Milenio III, casa 14', 'Querétaro', 'Hugo Paredes',
          v_mgp, v_romi, 18000, 'tramite', 'en_revision',
          'MGP-2026-9007', 'simulado-0007', 'En revisión', '2026-10-01', v_ana)
  returning id into s;
  insert into pagos (solicitud_id, via, monto, fecha_pago, comprobante_ruta, reportado_por)
  values (s, 'comprobante', 9000, '2026-10-02', xg || '/' || v_ana || '/semilla-0007a.jpg', v_ana) returning id into p;
  update pagos set estado = 'confirmado', revisado_por = v_gaby where id = p;
  insert into pagos (solicitud_id, via, monto, fecha_pago, comprobante_ruta, reportado_por)
  values (s, 'comprobante', 9000, '2026-10-20', xg || '/' || v_ana || '/semilla-0007b.jpg', v_ana) returning id into p;
  update pagos set estado = 'rechazado', motivo_rechazo = 'El comprobante no muestra la cuenta destino', revisado_por = v_gaby where id = p;

  -- 8. Entregado: parcial confirmado + pago directo por revisar (Beto)
  insert into solicitudes (comisionista_id, tipo, servicio_id, inmueble_direccion, inmueble_municipio, cliente_nombre,
                           marca_id, cuenta_receptora_id, monto_honorarios,
                           estado, estatus_publico, folio, externo_id, estatus_externo, aceptada_en, creado_por)
  values (v_beto, 'cotizacion', v_ov, 'Lomas de Casa Blanca, lote 3', 'Querétaro', 'Patricia Gómez',
          v_xg, v_scotia, 6000, 'tramite', 'entregado',
          'MGP-2026-9008', 'simulado-0008', 'Entregado', '2026-09-25', v_beto)
  returning id into s;
  insert into pagos (solicitud_id, via, monto, fecha_pago, comprobante_ruta, reportado_por)
  values (s, 'comprobante', 3000, '2026-09-26', xg || '/' || v_beto || '/semilla-0008.jpg', v_beto) returning id into p;
  update pagos set estado = 'confirmado', revisado_por = v_gaby where id = p;
  insert into pagos (solicitud_id, via, monto, fecha_pago, referencia, reportado_por)
  values (s, 'directo', 3000, hoy_mx(), 'SPEI 8812345', v_gaby);

  -- 10. Pagado el 2 de octubre, pago directo de finanzas (Ana) ---
  --     Septiembre sigue abierto: la comisión nace provisional.
  insert into solicitudes (comisionista_id, tipo, origen, servicio_id, inmueble_direccion, inmueble_municipio, cliente_nombre,
                           marca_id, cuenta_receptora_id, monto_honorarios,
                           estado, estatus_publico, folio, externo_id, estatus_externo, aceptada_en, creado_por)
  values (v_ana, 'tramite_directo', 'admin', v_ov, 'Depto. 402, Torre Zibatá', 'El Marqués', 'Daniel Ochoa',
          v_xg, v_scotia, 8000, 'tramite', 'entregado',
          'MGP-2026-9010', 'simulado-0010', 'Entregado', '2026-09-28', v_xchel)
  returning id into t10;
  insert into pagos (solicitud_id, via, monto, fecha_pago, referencia, reportado_por)
  values (t10, 'directo', 8000, '2026-10-02', 'Depósito 004521', v_gaby) returning id into p;
  update pagos set estado = 'confirmado', revisado_por = v_xchel where id = p;

  if (select porcentaje from comisiones where solicitud_id = t10) is distinct from 10.00
     or not (select provisional from comisiones where solicitud_id = t10) then
    raise exception 'El trabajo 10 debía nacer provisional al 10%% (nivel de septiembre)';
  end if;

  -- 4. Aceptada, trámite directo (Carla). Conector manual: Tasa le
  --    pone el siguiente folio del año, MGP-2026-9011.
  insert into solicitudes (comisionista_id, tipo, origen, servicio_id, inmueble_direccion, inmueble_municipio, cliente_nombre,
                           marca_id, cuenta_receptora_id, monto_honorarios, estado, estatus_publico,
                           externo_id, aceptada_en, creado_por)
  values (v_carla, 'tramite_directo', 'admin', v_avaluo, 'Blvd. Bernardo Quintana 300', 'Querétaro', 'Inmobiliaria Norte',
          v_mgp, v_romi, 14000, 'tramite', 'aceptada',
          'simulado-0004', now(), v_xchel);

  -- Cierre de septiembre: Gaby prepara, Xchel aprueba ------------
  perform ejecutar_preparacion_cierre(xg, '2026-09-01', v_gaby);
  perform ejecutar_aprobacion_cierre(xg, '2026-09-01', v_xchel);

  -- Pago de comisiones: el cierre de junio dejó a Ana un pendiente de
  -- 1,800 (vencía el 10 de julio). Gaby le pagó 1,000 el 8 de julio;
  -- quedan 800, vencidos. Ana emite factura y no la ha subido.
  update comisionistas set emite_factura = true, rfc = 'PUAA900101AB1' where persona_id = v_ana;
  perform ejecutar_pago_comision(
    xg, v_gaby, v_ana, '2026-07-08', (select id from origenes_pago where organizacion_id = xg and nombre = 'Scotiabank XG'),
    'SPEI 1001', null, 'recibo', null,
    jsonb_build_array(jsonb_build_object(
      'pendiente_id', (select id from pendientes_comision where comisionista_id = v_ana and mes = '2026-06-01'),
      'monto', 1000)));

  -- Un pago del cliente en efectivo, sin recibo, por confirmar (trabajo 7).
  insert into pagos (solicitud_id, via, monto, fecha_pago, recibido_por, nota, reportado_por)
  select id, 'efectivo', 2000, hoy_mx(), 'Oficina Querétaro', 'Lo dejó en la recepción', v_ana
    from solicitudes where organizacion_id = xg and folio = 'MGP-2026-9007';
end;
$$;

-- ============================================================
-- DEMO VALUADORES
-- ============================================================
do $$
declare
  demo   uuid;
  v_adm  uuid; v_com uuid;
  v_marca uuid; v_cuenta uuid; v_serv uuid;
  s uuid; p uuid;
begin
  insert into organizaciones (nombre, slug, prefijo_folio, color_primario)
  values ('Demo Valuadores', 'demo', 'DEMO', '#2f6f4e') returning id into demo;
  perform set_config('tasa.org', demo::text, false);

  insert into ajustes (organizacion_id, contacto_soporte) values (demo, 'soporte@demo.test');
  insert into conectores (organizacion_id, tipo) values (demo, 'manual');
  insert into niveles (nombre, orden, umbral_minimo, porcentaje, es_forzado) values
    ('Básico', 1, 0, 8.00, false), ('Plus', 2, 20000, 12.00, false), ('Élite', 3, null, null, true);
  insert into origenes_pago (nombre, orden) values ('Transferencia', 1), ('Efectivo', 2);
  insert into servicios (nombre, orden) values ('Avalúo Comercial', 1), ('Opinión de Valor', 2);
  select id into v_serv from servicios where organizacion_id = demo and nombre = 'Avalúo Comercial';
  insert into marcas (clave, nombre) values ('DV', 'Demo Valuadores') returning id into v_marca;
  insert into cuentas_receptoras (titular, banco, clabe, marca_id, alias)
  values ('Demo Valuadores SA', 'BBVA', '002180000000000999', v_marca, 'BBVA Demo') returning id into v_cuenta;
  update marcas set cuenta_sugerida_id = v_cuenta where id = v_marca;

  insert into personas (nombre, correo, organizacion_activa)
  values ('Admin Demo', 'xchel+demo-admin@arqosuv.com', demo) returning id into v_adm;
  insert into personas (nombre, correo, organizacion_activa)
  values ('Comisionista Demo', 'xchel+demo@arqosuv.com', demo) returning id into v_com;
  insert into membresias (persona_id, organizacion_id, rol) values
    (v_adm, demo, 'admin_org'), (v_com, demo, 'comisionista');
  insert into comisionistas (persona_id, slug, fecha_alta) values (v_com, 'demo', '2026-09-01');

  -- Pagado el 15 de octubre: comisión de 8% sobre 20,000 = 1,600.
  insert into solicitudes (comisionista_id, tipo, origen, servicio_id, inmueble_direccion, inmueble_municipio,
                           cliente_nombre, marca_id, cuenta_receptora_id, monto_honorarios,
                           estado, estatus_publico, aceptada_en, creado_por)
  values (v_com, 'tramite_directo', 'admin', v_serv, 'Av. Demo 100', 'Querétaro', 'Cliente Demo Uno',
          v_marca, v_cuenta, 20000, 'tramite', 'entregado', '2026-10-01', v_adm)
  returning id into s;
  insert into pagos (solicitud_id, via, monto, fecha_pago, referencia, reportado_por)
  values (s, 'directo', 20000, '2026-10-15', 'SPEI DEMO-1', v_adm) returning id into p;
  update pagos set estado = 'confirmado', revisado_por = v_adm where id = p;

  insert into solicitudes (comisionista_id, tipo, servicio_id, inmueble_direccion, cliente_nombre, creado_por)
  values (v_com, 'cotizacion', v_serv, 'Calle Demo 2', 'Cliente Demo Dos', v_com);

  perform set_config('tasa.org', '', false);
end;
$$;

-- ============================================================
-- COMPROBACIÓN — debe terminar sin error
-- ============================================================
do $$
declare
  xg  uuid := 'a0000000-0000-4000-8000-000000000001';
  ana uuid := (select id from personas where correo = 'xchel+ana@arqosuv.com');
  t10 uuid := (select id from solicitudes where folio = 'MGP-2026-9010');
  v numeric;
begin
  select count(*) into v from solicitudes where organizacion_id = xg;
  if v <> 10 then raise exception 'Se esperaban 10 trabajos en XG, hay %', v; end if;

  -- 9 y no 10: los trabajos 9 y 10 están los dos en "pagado".
  select count(distinct estatus_publico) into v from solicitudes where organizacion_id = xg;
  if v <> 9 then raise exception 'Se esperaban 9 estatus distintos, hay %', v; end if;

  select monto into v from comisiones where comisionista_id = ana and mes = '2026-06-01' and tipo = 'comision';
  if v is distinct from 1800.00 then raise exception 'Comisión de Ana en junio: esperaba 1800, hay %', v; end if;

  if (select string_agg(to_char(mes, 'MM') || '=' || porcentaje, ' ' order by mes)
        from niveles_mensuales where comisionista_id = ana) <> '07=12.50 08=10.00 09=10.00 10=5.00' then
    raise exception 'Niveles de Ana distintos a los esperados: %',
      (select string_agg(to_char(mes, 'MM') || '=' || porcentaje, ' ' order by mes)
         from niveles_mensuales where comisionista_id = ana);
  end if;

  select monto into v from comisiones where solicitud_id = t10 and tipo = 'comision';
  if v is distinct from 800.00 then raise exception 'Comisión del trabajo 10: esperaba 800 (se respeta el 10%% provisional), hay %', v; end if;
  if (select provisional from comisiones where solicitud_id = t10) then
    raise exception 'La comisión del trabajo 10 ya no debía ser provisional';
  end if;

  if (select count(*) from cierres where organizacion_id = xg and estado = 'aprobado') <> 4 then
    raise exception 'Se esperaban 4 cierres aprobados en XG (jun-sep)';
  end if;

  if (select string_agg(to_char(mes, 'MM') || '=' || monto || '/' || pagado, ' ') from pendientes_comision)
     is distinct from '06=1800.00/1000.00' then
    raise exception 'Pendientes de comisión distintos a los esperados (solo junio de Ana, 1000 pagados)';
  end if;

  if (select folio from solicitudes where externo_id = 'simulado-0004') is distinct from 'MGP-2026-9011' then
    raise exception 'El trabajo 4 debía recibir el folio MGP-2026-9011 del conector manual';
  end if;

  if (select folio from solicitudes where cliente_nombre = 'Cliente Demo Uno') is distinct from
       'DEMO-' || extract(year from hoy_mx()) || '-0001' then
    raise exception 'El trabajo de Demo debía recibir DEMO-<año>-0001';
  end if;
  if (select monto from comisiones where solicitud_id = (select id from solicitudes where cliente_nombre = 'Cliente Demo Uno'))
     is distinct from 1600.00 then
    raise exception 'La comisión de Demo debía ser 8%% de 20,000 = 1,600 (niveles de Demo, no de XG)';
  end if;

  raise notice 'Semilla correcta.';
end;
$$;
