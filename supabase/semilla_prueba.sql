-- ============================================================
-- SEMILLA DE PRUEBA — solo para un proyecto de pruebas, NUNCA en producción.
--
-- Corre después de todas las migraciones. Deja:
--   · Xchel (super_admin) y Gaby (finanzas);
--   · 3 comisionistas: Ana (alta junio), Beto (alta agosto), Carla (alta 15 sep);
--   · 10 trabajos en 9 estatus distintos (dos están pagados), con pagos
--     parciales, un rechazo, un aviso sin archivo y pagos directos de finanzas;
--   · un trámite aceptado cuya página de Notion aún no tiene folio;
--   · cierres de junio a septiembre 2026 aprobados; octubre abierto.
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
-- Xchel usa su correo real (xchel@arqosuv.com) para poder entrar con
-- la semilla cargada. Los demás terminan en .test: no existen.
-- ============================================================

do $$
declare
  v_xchel uuid; v_gaby uuid;
  v_ana uuid; v_beto uuid; v_carla uuid;
  v_avaluo uuid; v_hacend uuid; v_ov uuid;
  v_mgp uuid; v_ap73 uuid; v_xg uuid;
  v_romi uuid; v_banregio uuid; v_scotia uuid;
  t10 uuid;
  s uuid; p uuid;
begin
  -- Personas ---------------------------------------------------
  insert into personas (nombre, correo, rol) values ('Xchel Guerrero', 'xchel@arqosuv.com', 'super_admin') returning id into v_xchel;
  insert into personas (nombre, correo, rol) values ('Gaby', 'gaby@tasa.test', 'finanzas') returning id into v_gaby;
  insert into personas (nombre, correo, telefono, rol) values ('Ana Prueba',   'ana@tasa.test',   '4420000001', 'comisionista') returning id into v_ana;
  insert into personas (nombre, correo, telefono, rol) values ('Beto Prueba',  'beto@tasa.test',  '4420000002', 'comisionista') returning id into v_beto;
  insert into personas (nombre, correo, telefono, rol) values ('Carla Prueba', 'carla@tasa.test', '4420000003', 'comisionista') returning id into v_carla;

  insert into comisionistas (persona_id, slug, fecha_alta) values
    (v_ana,   'ana-prueba',   '2026-06-01'),
    (v_beto,  'beto-prueba',  '2026-08-01'),
    (v_carla, 'carla-prueba', '2026-09-15');

  -- Catálogos (vienen de 0008) ---------------------------------
  select id into v_avaluo from servicios where nombre = 'Avalúo Comercial';
  select id into v_hacend from servicios where nombre = 'Avalúo Hacendario';
  select id into v_ov     from servicios where nombre = 'Opinión de Valor';
  select id into v_mgp  from marcas where clave = 'MGP';
  select id into v_ap73 from marcas where clave = 'AP73';
  select id into v_xg   from marcas where clave = 'XG';
  select id into v_romi     from cuentas_receptoras where titular = 'ROMI';
  select id into v_banregio from cuentas_receptoras where banco = 'Banregio';
  select id into v_scotia   from cuentas_receptoras where banco = 'Scotiabank';

  -- 9. Pagado en junio, dos parciales (Ana) --------------------
  --    36,000 + IVA 5,760 + terceros 1,500 = 43,260
  insert into solicitudes (comisionista_id, tipo, servicio_id, inmueble_direccion, inmueble_municipio, cliente_nombre,
                           marca_id, cuenta_receptora_id, requiere_factura, monto_honorarios, monto_terceros,
                           estado, estatus_publico, folio, notion_page_id, estatus_notion, aceptada_en, creado_por)
  values (v_ana, 'cotizacion', v_avaluo, 'Nave industrial, Parque Bernardo Quintana', 'El Marqués', 'Grupo Industrial Bajío',
          v_mgp, v_romi, true, 36000, 1500, 'tramite', 'entregado',
          'MGP-2026-9009', 'simulado-0009', 'Entregado', '2026-06-01', v_ana)
  returning id into s;
  insert into pagos (solicitud_id, via, monto, fecha_pago, comprobante_ruta, reportado_por)
  values (s, 'comprobante', 20000, '2026-06-05', v_ana || '/semilla-0009a.pdf', v_ana) returning id into p;
  update pagos set estado = 'confirmado', revisado_por = v_gaby where id = p;
  insert into pagos (solicitud_id, via, monto, fecha_pago, comprobante_ruta, reportado_por)
  values (s, 'comprobante', 23260, '2026-06-22', v_ana || '/semilla-0009b.pdf', v_ana) returning id into p;
  update pagos set estado = 'confirmado', revisado_por = v_gaby where id = p;

  -- Cierres de junio, julio y agosto ---------------------------
  perform ejecutar_preparacion_cierre('2026-06-01', v_gaby);
  perform ejecutar_aprobacion_cierre('2026-06-01', v_xchel);
  perform ejecutar_preparacion_cierre('2026-07-01', v_gaby);
  perform ejecutar_aprobacion_cierre('2026-07-01', v_xchel);
  perform ejecutar_preparacion_cierre('2026-08-01', v_gaby);
  perform ejecutar_aprobacion_cierre('2026-08-01', v_xchel);

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

  -- 4. Aceptada, trámite directo; la página de Notion ya existe pero
  --    todavía no tiene folio → "Aceptada – folio en asignación" (Carla)
  insert into solicitudes (comisionista_id, tipo, origen, servicio_id, inmueble_direccion, inmueble_municipio, cliente_nombre,
                           marca_id, cuenta_receptora_id, monto_honorarios, estado, estatus_publico,
                           notion_page_id, estatus_notion, aceptada_en, creado_por)
  values (v_carla, 'tramite_directo', 'admin', v_avaluo, 'Blvd. Bernardo Quintana 300', 'Querétaro', 'Inmobiliaria Norte',
          v_mgp, v_romi, 14000, 'tramite', 'aceptada',
          'simulado-0004', 'Por asignar', now(), v_xchel);

  -- 5. Visita agendada, pago con comprobante por revisar (Beto) --
  insert into solicitudes (comisionista_id, tipo, servicio_id, inmueble_direccion, inmueble_municipio, cliente_nombre,
                           marca_id, cuenta_receptora_id, requiere_factura, monto_honorarios, monto_terceros,
                           estado, estatus_publico, folio, notion_page_id, estatus_notion, aceptada_en, creado_por)
  values (v_beto, 'cotizacion', v_avaluo, 'Calle Madero 77, Centro', 'Querétaro', 'Rubén Torres',
          v_mgp, v_romi, true, 12000, 0, 'tramite', 'visita_agendada',
          'MGP-2026-9005', 'simulado-0005', 'Por asignar', now() - interval '6 days', v_beto)
  returning id into s;
  insert into pagos (solicitud_id, via, monto, fecha_pago, comprobante_ruta, reportado_por)
  values (s, 'comprobante', 7000, hoy_mx() - 1, v_beto || '/semilla-0005.jpg', v_beto);

  -- 6. En elaboración: anticipo confirmado + aviso sin archivo (Carla)
  insert into solicitudes (comisionista_id, tipo, servicio_id, inmueble_direccion, inmueble_municipio, cliente_nombre,
                           marca_id, cuenta_receptora_id, monto_honorarios, monto_terceros,
                           estado, estatus_publico, folio, notion_page_id, estatus_notion, aceptada_en, creado_por)
  values (v_carla, 'cotizacion', v_hacend, 'Av. Constituyentes 900', 'Querétaro', 'Sofía Lara',
          v_ap73, v_banregio, 11000, 1800, 'tramite', 'en_elaboracion',
          'MGP-2026-9006', 'simulado-0006', 'En proceso', '2026-10-05', v_carla)
  returning id into s;
  insert into pagos (solicitud_id, via, monto, fecha_pago, comprobante_ruta, reportado_por)
  values (s, 'comprobante', 6000, '2026-10-06', v_carla || '/semilla-0006.pdf', v_carla) returning id into p;
  update pagos set estado = 'confirmado', revisado_por = v_gaby where id = p;
  insert into pagos (solicitud_id, via, monto, fecha_pago, nota, reportado_por)
  values (s, 'aviso', 3000, hoy_mx(), 'El cliente dice que transfirió hoy en la mañana', v_carla);

  -- 7. En revisión: parcial confirmado + uno rechazado (Ana) ----
  insert into solicitudes (comisionista_id, tipo, servicio_id, inmueble_direccion, inmueble_municipio, cliente_nombre,
                           marca_id, cuenta_receptora_id, monto_honorarios,
                           estado, estatus_publico, folio, notion_page_id, estatus_notion, aceptada_en, creado_por)
  values (v_ana, 'cotizacion', v_avaluo, 'Fracc. Milenio III, casa 14', 'Querétaro', 'Hugo Paredes',
          v_mgp, v_romi, 18000, 'tramite', 'en_revision',
          'MGP-2026-9007', 'simulado-0007', 'En revisión', '2026-10-01', v_ana)
  returning id into s;
  insert into pagos (solicitud_id, via, monto, fecha_pago, comprobante_ruta, reportado_por)
  values (s, 'comprobante', 9000, '2026-10-02', v_ana || '/semilla-0007a.jpg', v_ana) returning id into p;
  update pagos set estado = 'confirmado', revisado_por = v_gaby where id = p;
  insert into pagos (solicitud_id, via, monto, fecha_pago, comprobante_ruta, reportado_por)
  values (s, 'comprobante', 9000, '2026-10-20', v_ana || '/semilla-0007b.jpg', v_ana) returning id into p;
  update pagos set estado = 'rechazado', motivo_rechazo = 'El comprobante no muestra la cuenta destino', revisado_por = v_gaby where id = p;

  -- 8. Entregado: parcial confirmado + pago directo por revisar (Beto)
  insert into solicitudes (comisionista_id, tipo, servicio_id, inmueble_direccion, inmueble_municipio, cliente_nombre,
                           marca_id, cuenta_receptora_id, monto_honorarios,
                           estado, estatus_publico, folio, notion_page_id, estatus_notion, aceptada_en, creado_por)
  values (v_beto, 'cotizacion', v_ov, 'Lomas de Casa Blanca, lote 3', 'Querétaro', 'Patricia Gómez',
          v_xg, v_scotia, 6000, 'tramite', 'entregado',
          'MGP-2026-9008', 'simulado-0008', 'Entregado', '2026-09-25', v_beto)
  returning id into s;
  insert into pagos (solicitud_id, via, monto, fecha_pago, comprobante_ruta, reportado_por)
  values (s, 'comprobante', 3000, '2026-09-26', v_beto || '/semilla-0008.jpg', v_beto) returning id into p;
  update pagos set estado = 'confirmado', revisado_por = v_gaby where id = p;
  insert into pagos (solicitud_id, via, monto, fecha_pago, referencia, reportado_por)
  values (s, 'directo', 3000, hoy_mx(), 'SPEI 8812345', v_gaby);

  -- 10. Pagado el 2 de octubre, pago directo de finanzas (Ana) ---
  --     Septiembre sigue abierto: la comisión nace provisional.
  insert into solicitudes (comisionista_id, tipo, origen, servicio_id, inmueble_direccion, inmueble_municipio, cliente_nombre,
                           marca_id, cuenta_receptora_id, monto_honorarios,
                           estado, estatus_publico, folio, notion_page_id, estatus_notion, aceptada_en, creado_por)
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

  -- Cierre de septiembre: Gaby prepara, Xchel aprueba ------------
  perform ejecutar_preparacion_cierre('2026-09-01', v_gaby);
  perform ejecutar_aprobacion_cierre('2026-09-01', v_xchel);
end;
$$;

-- ============================================================
-- COMPROBACIÓN — debe terminar sin error
-- ============================================================
do $$
declare
  ana uuid := (select id from personas where correo = 'ana@tasa.test');
  t10 uuid := (select id from solicitudes where folio = 'MGP-2026-9010');
  v numeric;
begin
  select count(*) into v from solicitudes;
  if v <> 10 then raise exception 'Se esperaban 10 trabajos, hay %', v; end if;

  -- 9 y no 10: los trabajos 9 y 10 están los dos en "pagado".
  select count(distinct estatus_publico) into v from solicitudes;
  if v <> 9 then raise exception 'Se esperaban 9 estatus distintos, hay %', v; end if;

  select monto into v from comisiones where comisionista_id = ana and mes = '2026-06-01' and tipo = 'comision';
  if v is distinct from 1800.00 then raise exception 'Comisión de Ana en junio: esperaba 1800, hay %', v; end if;

  if (select string_agg(to_char(mes, 'MM') || '=' || porcentaje, ' ' order by mes)
        from niveles_mensuales where comisionista_id = ana) <> '07=12.50 08=10.00 09=10.00 10=5.00' then
    raise exception 'Niveles de Ana distintos a los esperados: %',
      (select string_agg(to_char(mes, 'MM') || '=' || porcentaje, ' ' order by mes)
         from niveles_mensuales where comisionista_id = ana);
  end if;

  -- El nivel real de octubre es 5%, pero lo provisional solo sube.
  select monto into v from comisiones where solicitud_id = t10 and tipo = 'comision';
  if v is distinct from 800.00 then raise exception 'Comisión del trabajo 10: esperaba 800 (se respeta el 10%% provisional), hay %', v; end if;
  if (select provisional from comisiones where solicitud_id = t10) then
    raise exception 'La comisión del trabajo 10 ya no debía ser provisional';
  end if;

  if (select count(*) from cierres where estado = 'aprobado') <> 4 then
    raise exception 'Se esperaban 4 cierres aprobados (jun-sep)';
  end if;

  if (select folio from solicitudes where notion_page_id = 'simulado-0004') is not null then
    raise exception 'El trabajo 4 debía quedar sin folio';
  end if;

  raise notice 'Semilla correcta.';
end;
$$;
