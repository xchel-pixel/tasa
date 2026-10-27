-- ============================================================
-- SEMILLA DE PRUEBA — solo para un proyecto de pruebas, NUNCA en producción.
--
-- Corre después de todas las migraciones. Deja:
--   · Xchel (super_admin) y Gaby (finanzas);
--   · 3 comisionistas: Ana (alta junio), Beto (alta agosto), Carla (alta 15 sep);
--   · 10 trabajos, uno por estatus, con pagos parciales, un rechazo y un
--     pago directo de finanzas;
--   · el cierre de septiembre 2026 aprobado.
--
-- Usa las mismas reglas que la aplicación: los pagos entran como
-- reportados y se confirman después, y la comisión la devenga el
-- disparador, no esta semilla.
--
-- Resultado esperado (lo revisa el bloque final):
--   · Septiembre aprobado: Ana 1,800.00 (5% de 36,000; no había nivel previo).
--   · Nivel de octubre: Ana Aliado 10% (36,000 / 3 meses = 12,000),
--     Beto y Carla Enlace 5%.
--   · Octubre abierto: Ana 800.00 (10% de 8,000). Se devengó el 2 de
--     octubre al 5% y la aprobación de septiembre lo subió al 10%.
--
-- Los correos terminan en .test: no existen. Para entrar con tu correo
-- real, cámbialo en `personas` antes de pedir el código.
-- ============================================================

do $$
declare
  v_xchel uuid; v_gaby uuid;
  v_ana uuid; v_beto uuid; v_carla uuid;
  v_avaluo uuid; v_hacend uuid; v_ov uuid;
  v_mgp uuid; v_ap73 uuid; v_xg uuid;
  v_romi uuid; v_banregio uuid; v_scotia uuid;
  s uuid; p uuid;
begin
  -- Personas ---------------------------------------------------
  insert into personas (nombre, correo, rol) values ('Xchel Guerrero', 'xchel@tasa.test', 'super_admin') returning id into v_xchel;
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

  -- 4. Aceptada, trámite directo, sin página de Notion aún (Carla)
  insert into solicitudes (comisionista_id, tipo, origen, servicio_id, inmueble_direccion, inmueble_municipio, cliente_nombre,
                           marca_id, cuenta_receptora_id, monto_honorarios, estado, estatus_publico, aceptada_en, creado_por)
  values (v_carla, 'tramite_directo', 'admin', v_avaluo, 'Blvd. Bernardo Quintana 300', 'Querétaro', 'Inmobiliaria Norte',
          v_mgp, v_romi, 14000, 'tramite', 'aceptada', now(), v_xchel);

  -- 5. Visita agendada, pago con comprobante por revisar (Beto) --
  insert into solicitudes (comisionista_id, tipo, servicio_id, inmueble_direccion, inmueble_municipio, cliente_nombre,
                           marca_id, cuenta_receptora_id, requiere_factura, monto_honorarios, monto_terceros,
                           estado, estatus_publico, folio, notion_page_id, estatus_notion, aceptada_en, creado_por)
  values (v_beto, 'cotizacion', v_avaluo, 'Calle Madero 77, Centro', 'Querétaro', 'Rubén Torres',
          v_mgp, v_romi, true, 12000, 0, 'tramite', 'visita_agendada',
          'PRUEBA-2026-0005', 'simulado-0005', 'Por asignar', now() - interval '6 days', v_beto)
  returning id into s;
  insert into pagos (solicitud_id, via, monto, fecha_pago, comprobante_ruta, reportado_por)
  values (s, 'comprobante', 7000, hoy_mx() - 1, v_beto || '/semilla-0005.jpg', v_beto);

  -- 6. En elaboración: anticipo confirmado + aviso sin archivo (Carla)
  insert into solicitudes (comisionista_id, tipo, servicio_id, inmueble_direccion, inmueble_municipio, cliente_nombre,
                           marca_id, cuenta_receptora_id, monto_honorarios, monto_terceros,
                           estado, estatus_publico, folio, notion_page_id, estatus_notion, aceptada_en, creado_por)
  values (v_carla, 'cotizacion', v_hacend, 'Av. Constituyentes 900', 'Querétaro', 'Sofía Lara',
          v_ap73, v_banregio, 11000, 1800, 'tramite', 'en_elaboracion',
          'PRUEBA-2026-0006', 'simulado-0006', 'En proceso', '2026-10-05', v_carla)
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
          'PRUEBA-2026-0007', 'simulado-0007', 'En revisión', '2026-10-01', v_ana)
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
          'PRUEBA-2026-0008', 'simulado-0008', 'Entregado', '2026-09-25', v_beto)
  returning id into s;
  insert into pagos (solicitud_id, via, monto, fecha_pago, comprobante_ruta, reportado_por)
  values (s, 'comprobante', 3000, '2026-09-26', v_beto || '/semilla-0008.jpg', v_beto) returning id into p;
  update pagos set estado = 'confirmado', revisado_por = v_gaby where id = p;
  insert into pagos (solicitud_id, via, monto, fecha_pago, referencia, reportado_por)
  values (s, 'directo', 3000, hoy_mx(), 'SPEI 8812345', v_gaby);

  -- 9. Pagado en septiembre, dos parciales (Ana) ----------------
  --    36,000 + IVA 5,760 + terceros 1,500 = 43,260
  insert into solicitudes (comisionista_id, tipo, servicio_id, inmueble_direccion, inmueble_municipio, cliente_nombre,
                           marca_id, cuenta_receptora_id, requiere_factura, monto_honorarios, monto_terceros,
                           estado, estatus_publico, folio, notion_page_id, estatus_notion, aceptada_en, creado_por)
  values (v_ana, 'cotizacion', v_avaluo, 'Nave industrial, Parque Bernardo Quintana', 'El Marqués', 'Grupo Industrial Bajío',
          v_mgp, v_romi, true, 36000, 1500, 'tramite', 'entregado',
          'PRUEBA-2026-0009', 'simulado-0009', 'Entregado', '2026-09-01', v_ana)
  returning id into s;
  insert into pagos (solicitud_id, via, monto, fecha_pago, comprobante_ruta, reportado_por)
  values (s, 'comprobante', 20000, '2026-09-05', v_ana || '/semilla-0009a.pdf', v_ana) returning id into p;
  update pagos set estado = 'confirmado', revisado_por = v_gaby where id = p;
  insert into pagos (solicitud_id, via, monto, fecha_pago, comprobante_ruta, reportado_por)
  values (s, 'comprobante', 23260, '2026-09-22', v_ana || '/semilla-0009b.pdf', v_ana) returning id into p;
  update pagos set estado = 'confirmado', revisado_por = v_gaby where id = p;

  -- 10. Pagado el 2 de octubre, pago directo de finanzas (Ana) ---
  --     Se paga ANTES de aprobar septiembre: nace al 5% y la
  --     aprobación lo debe subir al 10%.
  insert into solicitudes (comisionista_id, tipo, origen, servicio_id, inmueble_direccion, inmueble_municipio, cliente_nombre,
                           marca_id, cuenta_receptora_id, monto_honorarios,
                           estado, estatus_publico, folio, notion_page_id, estatus_notion, aceptada_en, creado_por)
  values (v_ana, 'tramite_directo', 'admin', v_ov, 'Depto. 402, Torre Zibatá', 'El Marqués', 'Daniel Ochoa',
          v_xg, v_scotia, 8000, 'tramite', 'entregado',
          'PRUEBA-2026-0010', 'simulado-0010', 'Entregado', '2026-09-28', v_xchel)
  returning id into s;
  insert into pagos (solicitud_id, via, monto, fecha_pago, referencia, reportado_por)
  values (s, 'directo', 8000, '2026-10-02', 'Depósito 004521', v_gaby) returning id into p;
  update pagos set estado = 'confirmado', revisado_por = v_xchel where id = p;

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
  v numeric;
begin
  select count(*) into v from solicitudes;
  if v <> 10 then raise exception 'Se esperaban 10 trabajos, hay %', v; end if;

  -- 9 y no 10: los trabajos 9 y 10 están los dos en "pagado".
  select count(distinct estatus_publico) into v from solicitudes;
  if v <> 9 then raise exception 'Se esperaban 9 estatus distintos, hay %', v; end if;

  select monto into v from comisiones c join personas p on p.id = c.comisionista_id
   where p.correo = 'ana@tasa.test' and c.mes = '2026-09-01' and c.tipo = 'comision';
  if v is distinct from 1800.00 then raise exception 'Comisión de Ana en septiembre: esperaba 1800, hay %', v; end if;

  select porcentaje into v from niveles_mensuales n join personas p on p.id = n.comisionista_id
   where p.correo = 'ana@tasa.test' and n.mes = '2026-10-01';
  if v is distinct from 10.00 then raise exception 'Nivel de Ana en octubre: esperaba 10%%, hay %', v; end if;

  select monto into v from comisiones c join personas p on p.id = c.comisionista_id
   where p.correo = 'ana@tasa.test' and c.mes = '2026-10-01' and c.tipo = 'comision';
  if v is distinct from 800.00 then raise exception 'Comisión de Ana en octubre: esperaba 800, hay %', v; end if;

  if not mes_aprobado('2026-09-01') then raise exception 'Septiembre debería estar aprobado'; end if;

  raise notice 'Semilla correcta.';
end;
$$;
