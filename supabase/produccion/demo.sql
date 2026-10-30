-- ============================================================
-- DATOS DE LA ORGANIZACIÓN DEMO (sintéticos) — se corre con `npm run demo`
--
-- Crea la organización DEMO la primera vez (oculta para todos menos
-- super_plataforma, sin conectores externos, sin correos ni cron: ver
-- 0043) y, en cada corrida, BORRA SOLO los datos operativos de DEMO y
-- los vuelve a crear. Nunca toca otra organización: todo borrado lleva
-- `organizacion_id = <DEMO>` y el script se detiene si la organización
-- encontrada no está marcada como demo.
--
-- Qué deja (fechas relativas a hoy):
--   · Gente: admin_org, finanzas, equipo y 3 comisionistas (Ana, Beto,
--     Carla), con correos xchel+demo-…@arqosuv.com.
--   · Solicitudes y trabajos en cada estatus, de cada tipo de honorario
--     (fijo, sin costo, estimado con y sin final).
--   · Un convenio con las tres modalidades y % fijo de comisión.
--   · Pagos confirmados, por revisar y rechazados; el cierre del mes
--     pasado aprobado; comisiones.
--   · Solicitudes por liga de cliente (de comisionista y de equipo) y
--     referidos de alta (de comisionista y de equipo).
-- Corre como postgres (sin sesión): `tasa.org` hace que cada fila nazca
-- en DEMO, igual que la semilla de pruebas.
-- ============================================================

do $$
declare
  v_demo   uuid;
  m0       date := mes_de(hoy_mx());                              -- mes en curso
  m1       date := (mes_de(hoy_mx()) - interval '1 month')::date;  -- mes pasado (se cierra)
  v_adm    uuid; v_fin uuid; v_eq uuid;
  v_ana    uuid; v_beto uuid; v_carla uuid;
  v_marca  uuid; v_cuenta uuid;
  v_avaluo uuid; v_hacend uuid; v_ov uuid; v_vh uuid;
  v_conv   uuid;
  v_aviso  integer;
  s uuid; p uuid; t_lig uuid; t6 uuid; t_m1 uuid;
  v_diego uuid; v_elena uuid; v_fabi uuid; v_gus uuid; v_hugo uuid; v_ivan uuid;
  v_x record;
  cod_ana  text; cod_eq text;
begin
  -- 1. La organización (una sola vez) -------------------------
  select id into v_demo from organizaciones where slug = 'demo';
  if v_demo is null then
    insert into organizaciones (nombre, slug, prefijo_folio, demo) values ('DEMO', 'demo', 'DEMO', true) returning id into v_demo;
    insert into ajustes (organizacion_id, contacto_soporte) values (v_demo, 'soporte@demo.test');
    insert into conectores (organizacion_id, tipo) values (v_demo, 'manual');
    insert into niveles (organizacion_id, nombre, orden, umbral_minimo, porcentaje, es_forzado) values
      (v_demo, 'Enlace', 1, 0, 5.00, false), (v_demo, 'Aliado', 2, 10000, 10.00, false),
      (v_demo, 'Socio', 3, 30000, 12.50, false), (v_demo, 'Socio Plus', 4, 60000, 15.00, false),
      (v_demo, 'Élite', 5, null, null, true);
    insert into origenes_pago (organizacion_id, nombre, orden) values
      (v_demo, 'Transferencia', 1), (v_demo, 'Efectivo', 2), (v_demo, 'Otra', 3);
  end if;
  if not (select o.demo from organizaciones o where o.id = v_demo) then
    raise exception 'La organización "demo" no está marcada como demo: no se toca';
  end if;
  perform set_config('tasa.org', v_demo::text, true);
  perform set_config('tasa.motivo', 'Datos DEMO (npm run demo)', true);
  -- Solo en esta transacción y solo para DEMO: abre los candados de cierres para poder borrar (0043).
  perform set_config('tasa.regenerar_demo', 'si', true);
  update organizaciones set activa = true where id = v_demo;
  update ajustes set aviso_privacidad = coalesce(aviso_privacidad, 'Aviso de privacidad de DEMO (datos sintéticos).'),
                     terminos = coalesce(terminos, 'Términos y condiciones de DEMO (datos sintéticos).')
   where organizacion_id = v_demo;

  -- 2. Borrar lo operativo de DEMO (solo DEMO) -----------------
  delete from alertas                    where organizacion_id = v_demo;
  delete from bonos_equipo               where organizacion_id = v_demo;
  delete from eventos_vinculo            where organizacion_id = v_demo;
  delete from vinculos_referido          where organizacion_id = v_demo;
  delete from aplicaciones_pago_comision where organizacion_id = v_demo;
  delete from pagos_comision             where organizacion_id = v_demo;
  delete from pendientes_comision        where organizacion_id = v_demo;
  delete from comisiones                 where organizacion_id = v_demo;
  delete from niveles_mensuales          where organizacion_id = v_demo;
  delete from cierres                    where organizacion_id = v_demo;
  delete from pagos                      where organizacion_id = v_demo;
  delete from eventos_trabajo            where organizacion_id = v_demo;
  delete from historial_estatus          where organizacion_id = v_demo;
  update solicitudes set ligada_a = null where organizacion_id = v_demo;
  update cotizaciones set ligada_a = null where organizacion_id = v_demo;
  delete from cotizaciones               where organizacion_id = v_demo;
  delete from solicitudes                where organizacion_id = v_demo;
  delete from convenio_precios           where organizacion_id = v_demo;
  delete from convenios                  where organizacion_id = v_demo;
  delete from csf_reemplazadas           where organizacion_id = v_demo;
  delete from solicitudes_alta           where organizacion_id = v_demo;
  delete from folios_contador            where organizacion_id = v_demo;
  insert into folios_contador (organizacion_id, anio, ultimo) values (v_demo, extract(year from hoy_mx()), 0);

  -- 3. Catálogos (una sola vez) --------------------------------
  select id into v_marca from marcas where organizacion_id = v_demo and clave = 'DEM';
  if v_marca is null then
    insert into marcas (clave, nombre, color, nombre_legal) values ('DEM', 'Demo Valuación', '#2f6f4e', 'Demo Valuación S.C.') returning id into v_marca;
    insert into cuentas_receptoras (titular, banco, clabe, marca_id, alias)
    values ('Demo Valuación', 'Banco Demo', '002180000000000012', v_marca, 'Cuenta DEMO') returning id into v_cuenta;
    update marcas set cuenta_sugerida_id = v_cuenta where id = v_marca;
  end if;
  insert into servicios (nombre, orden) values ('Avalúo Comercial', 1), ('Avalúo Hacendario', 2), ('Opinión de Valor', 3), ('Valor Hacendario', 4)
  on conflict (organizacion_id, nombre) do nothing;
  select id into v_cuenta from cuentas_receptoras where organizacion_id = v_demo and marca_id = v_marca limit 1;
  select id into v_avaluo from servicios where organizacion_id = v_demo and nombre = 'Avalúo Comercial';
  select id into v_hacend from servicios where organizacion_id = v_demo and nombre = 'Avalúo Hacendario';
  select id into v_ov     from servicios where organizacion_id = v_demo and nombre = 'Opinión de Valor';
  select id into v_vh     from servicios where organizacion_id = v_demo and nombre = 'Valor Hacendario';

  -- 4. Gente (una sola vez; se amarra a su usuario si ya existe) --
  insert into personas (nombre, correo, telefono, organizacion_activa) values
    ('Admin DEMO',     'xchel+demo-admin@arqosuv.com',    null,         v_demo),
    ('Finanzas DEMO',  'xchel+demo-finanzas@arqosuv.com', null,         v_demo),
    ('Equipo DEMO',    'xchel+demo-equipo@arqosuv.com',   null,         v_demo),
    ('Ana DEMO',       'xchel+demo-ana@arqosuv.com',      '4429000001', v_demo),
    ('Beto DEMO',      'xchel+demo-beto@arqosuv.com',     '4429000002', v_demo),
    ('Carla DEMO',     'xchel+demo-carla@arqosuv.com',    '4429000003', v_demo)
  on conflict ((lower(correo))) do nothing;
  select id into v_adm   from personas where lower(correo) = 'xchel+demo-admin@arqosuv.com';
  select id into v_fin   from personas where lower(correo) = 'xchel+demo-finanzas@arqosuv.com';
  select id into v_eq    from personas where lower(correo) = 'xchel+demo-equipo@arqosuv.com';
  select id into v_ana   from personas where lower(correo) = 'xchel+demo-ana@arqosuv.com';
  select id into v_beto  from personas where lower(correo) = 'xchel+demo-beto@arqosuv.com';
  select id into v_carla from personas where lower(correo) = 'xchel+demo-carla@arqosuv.com';
  update personas set organizacion_activa = v_demo, activo = true where id in (v_adm, v_fin, v_eq, v_ana, v_beto, v_carla);
  insert into membresias (persona_id, organizacion_id, rol) values
    (v_adm, v_demo, 'admin_org'), (v_fin, v_demo, 'finanzas'), (v_eq, v_demo, 'equipo'),
    (v_ana, v_demo, 'comisionista'), (v_beto, v_demo, 'comisionista'), (v_carla, v_demo, 'comisionista')
  on conflict (persona_id, organizacion_id) do nothing;
  update membresias set activa = true where organizacion_id = v_demo;
  insert into comisionistas (persona_id, slug, fecha_alta, rfc) values
    (v_ana,   'demo-ana',   (m1 - interval '2 months')::date, 'DEAA900101AB3'),
    (v_beto,  'demo-beto',  (m1 - interval '1 month')::date,  'DEBB900101AB4'),
    (v_carla, 'demo-carla', m1,                               'DECC900101AB5')
  on conflict do nothing;
  -- Los comisionistas de DEMO ya aceptaron los términos vigentes (si no, todo los manda a /terminos).
  insert into aceptaciones_terminos (persona_id, version)
  select x, (select terminos_version from ajustes where organizacion_id = v_demo) from unnest(array[v_ana, v_beto, v_carla]) x
  on conflict do nothing;
  update personas p set user_id = u.id from auth.users u
   where p.id in (v_adm, v_fin, v_eq, v_ana, v_beto, v_carla) and p.user_id is null and lower(u.email) = lower(p.correo);

  -- 5. Convenio con las tres modalidades y 8% fijo ---------------
  insert into convenios (nombre, contacto, vigente_desde, notas, comision_regla, comision_pct)
  values ('Notaría DEMO', 'Lic. Demo · 442 900 0000', m1, 'Convenio sintético', 'fija', 8) returning id into v_conv;
  insert into convenio_precios (convenio_id, servicio_id, honorario_tipo, monto, monto_minimo, nota) values
    (v_conv, v_hacend, 'fijo', 4500, null, null),
    (v_conv, v_vh, 'sin_costo', 0, null, 'Sin costo si contrata el avalúo hacendario'),
    (v_conv, v_avaluo, 'estimado', 9000, 6000, 'Según superficie');

  -- 6. Trabajos y solicitudes ----------------------------------
  -- Pagado el mes pasado (Ana, fijo): comisión del mes que se cierra.
  insert into solicitudes (comisionista_id, tipo, servicio_id, inmueble_direccion, inmueble_municipio, cliente_nombre,
                           marca_id, cuenta_receptora_id, monto_honorarios, estado, estatus_publico, aceptada_en, creado_por)
  values (v_ana, 'cotizacion', v_avaluo, 'Nave 7, Parque Industrial Demo', 'El Marqués', 'Industrias Demo',
          v_marca, v_cuenta, 24000, 'tramite', 'entregado', m1 + 1, v_ana) returning id into t_m1;
  insert into pagos (solicitud_id, via, monto, fecha_pago, comprobante_ruta, reportado_por)
  values (t_m1, 'comprobante', 24000, m1 + 9, v_demo || '/' || v_ana || '/demo-1.pdf', v_ana) returning id into p;
  update pagos set estado = 'confirmado', revisado_por = v_fin where id = p;

  -- Bono de referidos (lo calcula el cierre del mes pasado) ------
  --   · Ana refiere a Diego, Elena y Fabi, los tres con trabajo pagado en el mes → 3 activos → 3%.
  --   · Elena es Élite 28%: su bono se recorta por el tope de 30% ("Bono ajustado por tope").
  --   · Gus, también de Ana, tuvo su primer trabajo pagado hace 14 meses: vencido, no genera.
  --   · Beto refiere a Hugo, pero Beto no tuvo trabajos pagados en los últimos 3 meses: ese mes no cobra.
  --   · Equipo DEMO (interruptores encendidos, 2.5%) refiere a Iván: su bono va en bonos_equipo.
  update ajustes set bono_referido_equipo = true where organizacion_id = v_demo;
  update membresias set bono_referido = true, bono_referido_pct = 2.5, bono_referido_hasta = null
   where organizacion_id = v_demo and persona_id = v_eq;
  for v_x in select * from (values
      ('Diego Referido DEMO', 'diego.ref@demo.test', 'DEMDIEGO'), ('Elena Referida DEMO', 'elena.ref@demo.test', 'DEMELENA'),
      ('Fabi Referida DEMO', 'fabi.ref@demo.test', 'DEMFABIX'), ('Gus Referido DEMO', 'gus.ref@demo.test', 'DEMGUSXX'),
      ('Hugo Referido DEMO', 'hugo.ref@demo.test', 'DEMHUGOX'), ('Ivan Referido DEMO', 'ivan.ref@demo.test', 'DEMIVANX')) v(nombre, correo, clave)
  loop
    insert into personas (nombre, correo, organizacion_activa) values (v_x.nombre, v_x.correo, v_demo) on conflict ((lower(correo))) do nothing;
    insert into membresias (persona_id, organizacion_id, rol)
    select id, v_demo, 'comisionista' from personas where lower(correo) = v_x.correo
    on conflict (persona_id, organizacion_id) do nothing;
    insert into comisionistas (persona_id, slug, fecha_alta, curp)
    select id, lower(replace(v_x.nombre, ' ', '-')), (m1 - interval '15 months')::date,
           'DEMO900101H' || translate(substr(md5(v_x.nombre), 1, 5), '0123456789abcdef', 'ABCDEFGHIJKLMNOP') || '00'
      from personas where lower(correo) = v_x.correo
    on conflict do nothing;
  end loop;
  select id into v_diego from personas where correo = 'diego.ref@demo.test';
  select id into v_elena from personas where correo = 'elena.ref@demo.test';
  select id into v_fabi  from personas where correo = 'fabi.ref@demo.test';
  select id into v_gus   from personas where correo = 'gus.ref@demo.test';
  select id into v_hugo  from personas where correo = 'hugo.ref@demo.test';
  select id into v_ivan  from personas where correo = 'ivan.ref@demo.test';
  update comisionistas set porcentaje_forzado = 28 where organizacion_id = v_demo and persona_id = v_elena;
  -- Los vínculos se rehacen desde cero: primero sin referidor, después con el suyo.
  update comisionistas set referido_por = null, referido_por_miembro = null
   where organizacion_id = v_demo and persona_id in (v_diego, v_elena, v_fabi, v_gus, v_hugo, v_ivan);
  update comisionistas set referido_por = v_ana  where organizacion_id = v_demo and persona_id in (v_diego, v_elena, v_fabi, v_gus);
  update comisionistas set referido_por = v_beto where organizacion_id = v_demo and persona_id = v_hugo;
  update comisionistas set referido_por_miembro = v_eq where organizacion_id = v_demo and persona_id = v_ivan;

  -- Gus: su primer trabajo pagado fue hace 14 meses (historia, sin pagos ni comisión).
  insert into solicitudes (comisionista_id, tipo, origen, servicio_id, inmueble_direccion, cliente_nombre, marca_id, cuenta_receptora_id,
                           monto_honorarios, estado, estatus_publico, aceptada_en, pagado_en, mes_cierre, creado_por)
  values (v_gus, 'tramite_directo', 'admin', v_ov, 'Calle Historia Demo', 'Cliente Antiguo Demo', v_marca, v_cuenta,
          3000, 'tramite', 'pagado', (m1 - interval '14 months')::date, (m1 - interval '14 months')::date + 5,
          (m1 - interval '14 months')::date, v_adm);

  -- Trabajos de los referidos pagados en el mes pasado.
  for v_x in select * from (values (v_diego, 10000), (v_elena, 8000), (v_fabi, 6000), (v_gus, 7000), (v_hugo, 9000), (v_ivan, 8000)) v(com, hon)
  loop
    insert into solicitudes (comisionista_id, tipo, origen, servicio_id, inmueble_direccion, cliente_nombre, marca_id, cuenta_receptora_id,
                             monto_honorarios, estado, estatus_publico, aceptada_en, creado_por)
    values (v_x.com, 'tramite_directo', 'admin', v_avaluo, 'Calle Referidos Demo', 'Cliente de Referido Demo', v_marca, v_cuenta,
            v_x.hon, 'tramite', 'entregado', m1 + 2, v_adm) returning id into s;
    insert into pagos (solicitud_id, via, monto, fecha_pago, referencia, reportado_por)
    values (s, 'directo', v_x.hon, m1 + 12, 'SPEI DEMO-REF', v_fin) returning id into p;
    update pagos set estado = 'confirmado', revisado_por = v_adm where id = p;
  end loop;

  perform ejecutar_preparacion_cierre(v_demo, m1, v_fin);
  perform ejecutar_aprobacion_cierre(v_demo, m1, v_adm);

  -- Solicitada (Beto).
  insert into solicitudes (comisionista_id, tipo, servicio_id, inmueble_direccion, inmueble_municipio, cliente_nombre, cliente_telefono, creado_por)
  values (v_beto, 'cotizacion', v_avaluo, 'Av. Demo 120, Centro', 'Querétaro', 'Laura Demo', '4429111111', v_beto);

  -- Cotizada, fijo, vigente (Ana).
  insert into solicitudes (comisionista_id, tipo, servicio_id, inmueble_direccion, inmueble_municipio, cliente_nombre, marca_id, creado_por)
  values (v_ana, 'cotizacion', v_hacend, 'Calle Demo 45', 'Corregidora', 'Jorge Demo', v_marca, v_ana) returning id into s;
  insert into cotizaciones (solicitud_id, requiere_factura, monto_honorarios, monto_terceros, cuenta_receptora_id, vigente_hasta, emitida_por)
  values (s, true, 9500, 2300, v_cuenta, hoy_mx() + 10, v_adm);

  -- Vencida (Carla): DEMO no la vence el cron, se vence aquí.
  insert into solicitudes (comisionista_id, tipo, servicio_id, inmueble_direccion, inmueble_municipio, cliente_nombre, marca_id, creado_por)
  values (v_carla, 'cotizacion', v_ov, 'Privada Demo 8', 'Querétaro', 'Marta Demo', v_marca, v_carla) returning id into s;
  insert into cotizaciones (solicitud_id, monto_honorarios, cuenta_receptora_id, vigente_hasta, emitida_por)
  values (s, 3500, v_cuenta, hoy_mx() + 1, v_adm);
  update cotizaciones set estado = 'vencida', respondida_en = now() where solicitud_id = s;
  update solicitudes set estado = 'vencida', estatus_publico = 'vencida' where id = s;

  -- Aceptada, trámite directo (Carla): el conector manual le pone folio DEMO.
  insert into solicitudes (comisionista_id, tipo, origen, servicio_id, inmueble_direccion, inmueble_municipio, cliente_nombre,
                           marca_id, cuenta_receptora_id, monto_honorarios, estado, estatus_publico, aceptada_en, creado_por)
  values (v_carla, 'tramite_directo', 'admin', v_avaluo, 'Blvd. Demo 300', 'Querétaro', 'Inmobiliaria Demo',
          v_marca, v_cuenta, 14000, 'tramite', 'aceptada', now(), v_adm) returning id into t_lig;

  -- Visita agendada con pago por revisar (Beto).
  insert into solicitudes (comisionista_id, tipo, servicio_id, inmueble_direccion, inmueble_municipio, cliente_nombre,
                           marca_id, cuenta_receptora_id, requiere_factura, monto_honorarios, estado, estatus_publico, aceptada_en, creado_por)
  values (v_beto, 'cotizacion', v_avaluo, 'Calle Madero Demo 77', 'Querétaro', 'Rubén Demo',
          v_marca, v_cuenta, true, 12000, 'tramite', 'visita_agendada', now() - interval '6 days', v_beto) returning id into s;
  insert into pagos (solicitud_id, via, monto, fecha_pago, comprobante_ruta, reportado_por)
  values (s, 'comprobante', 7000, hoy_mx() - 1, v_demo || '/' || v_beto || '/demo-5.jpg', v_beto);

  -- En elaboración, ESTIMADO sin final, con anticipo (Carla).
  insert into solicitudes (comisionista_id, tipo, servicio_id, inmueble_direccion, inmueble_municipio, cliente_nombre,
                           marca_id, cuenta_receptora_id, monto_honorarios, honorario_tipo, honorario_minimo,
                           estado, estatus_publico, aceptada_en, creado_por)
  values (v_carla, 'cotizacion', v_avaluo, 'Rancho Demo, fracción 2', 'Huimilpan', 'Sofía Demo',
          v_marca, v_cuenta, 9000, 'estimado', 6000, 'tramite', 'en_elaboracion', now() - interval '4 days', v_carla) returning id into t6;
  insert into pagos (solicitud_id, via, monto, fecha_pago, comprobante_ruta, reportado_por)
  values (t6, 'comprobante', 4000, hoy_mx() - 3, v_demo || '/' || v_carla || '/demo-6.pdf', v_carla) returning id into p;
  update pagos set estado = 'confirmado', revisado_por = v_fin where id = p;

  -- En revisión, ESTIMADO con final fijado, con un pago rechazado (Ana).
  insert into solicitudes (comisionista_id, tipo, servicio_id, inmueble_direccion, inmueble_municipio, cliente_nombre,
                           marca_id, cuenta_receptora_id, monto_honorarios, honorario_tipo, estado, estatus_publico, aceptada_en, creado_por)
  values (v_ana, 'cotizacion', v_avaluo, 'Fracc. Demo III, casa 14', 'Querétaro', 'Hugo Demo',
          v_marca, v_cuenta, 18000, 'estimado', 'tramite', 'en_revision', now() - interval '10 days', v_ana) returning id into s;
  update solicitudes set monto_honorarios = 16500, honorario_final_en = now() - interval '1 day' where id = s;
  insert into pagos (solicitud_id, via, monto, fecha_pago, comprobante_ruta, reportado_por)
  values (s, 'comprobante', 8000, hoy_mx() - 8, v_demo || '/' || v_ana || '/demo-7a.jpg', v_ana) returning id into p;
  update pagos set estado = 'confirmado', revisado_por = v_fin where id = p;
  insert into pagos (solicitud_id, via, monto, fecha_pago, comprobante_ruta, reportado_por)
  values (s, 'comprobante', 8500, hoy_mx() - 2, v_demo || '/' || v_ana || '/demo-7b.jpg', v_ana) returning id into p;
  update pagos set estado = 'rechazado', motivo_rechazo = 'El comprobante no muestra la cuenta destino', revisado_por = v_fin where id = p;

  -- Entregado, SIN COSTO por convenio, ligado al trámite directo (Beto).
  insert into solicitudes (comisionista_id, tipo, servicio_id, inmueble_direccion, inmueble_municipio, cliente_nombre,
                           marca_id, cuenta_receptora_id, monto_honorarios, honorario_tipo, ligada_a, convenio_id,
                           estado, estatus_publico, aceptada_en, creado_por)
  values (v_beto, 'cotizacion', v_vh, 'Blvd. Demo 300', 'Querétaro', 'Inmobiliaria Demo',
          v_marca, v_cuenta, 0, 'sin_costo', t_lig, v_conv, 'tramite', 'entregado', now() - interval '3 days', v_beto);

  -- Pagado este mes por convenio (8% fijo) (Beto).
  insert into solicitudes (comisionista_id, tipo, servicio_id, inmueble_direccion, inmueble_municipio, cliente_nombre,
                           marca_id, cuenta_receptora_id, monto_honorarios, convenio_id, estado, estatus_publico, aceptada_en, creado_por)
  values (v_beto, 'cotizacion', v_hacend, 'Calle Notaría Demo 4', 'Querétaro', 'Notaría DEMO',
          v_marca, v_cuenta, 4500, v_conv, 'tramite', 'entregado', now() - interval '7 days', v_beto) returning id into s;
  insert into pagos (solicitud_id, via, monto, fecha_pago, referencia, reportado_por)
  values (s, 'directo', 4500, hoy_mx(), 'SPEI DEMO-10', v_fin) returning id into p;
  update pagos set estado = 'confirmado', revisado_por = v_adm where id = p;

  -- Sin costo → conversión (Reportes, mes pasado). Nunca se cobran: solo se mide si lo ligado se contrató.
  --   · Ana: valor hacendario ligado a su avalúo pagado (convertido).
  --   · Carla: valor hacendario sin trabajo ligado, con más de 30 días.
  insert into solicitudes (comisionista_id, tipo, servicio_id, inmueble_direccion, inmueble_municipio, cliente_nombre,
                           marca_id, cuenta_receptora_id, monto_honorarios, honorario_tipo, ligada_a, convenio_id,
                           estado, estatus_publico, aceptada_en, creado_por)
  values (v_ana, 'cotizacion', v_vh, 'Nave 7, Parque Industrial Demo', 'El Marqués', 'Industrias Demo',
          v_marca, v_cuenta, 0, 'sin_costo', t_m1, v_conv, 'tramite', 'entregado', m1 + 1, v_ana),
         (v_carla, 'cotizacion', v_vh, 'Lote 12, Fracc. Demo', 'Corregidora', 'Cliente Sin Avalúo Demo',
          v_marca, v_cuenta, 0, 'sin_costo', null, v_conv, 'tramite', 'entregado',
          least(m1 + interval '1 day', now() - interval '31 days'), v_carla);

  -- Cancelada (Ana).
  insert into solicitudes (comisionista_id, tipo, servicio_id, inmueble_direccion, inmueble_municipio, cliente_nombre, creado_por)
  values (v_ana, 'cotizacion', v_ov, 'Calle Cancelada Demo 1', 'Querétaro', 'Cliente Cancelado', v_ana) returning id into s;
  update solicitudes set estado = 'cancelada', estatus_publico = 'cancelada', cancelada_en = now(),
         motivo_cancelacion = 'El cliente ya no lo necesita (DEMO)' where id = s;

  -- 7. Liga de cliente: de comisionista ("Quiero el trámite") y de equipo.
  select aviso_version into v_aviso from ajustes where organizacion_id = v_demo;
  select codigo_referido into cod_ana from comisionistas where persona_id = v_ana and organizacion_id = v_demo;
  select codigo_referido into cod_eq from membresias where persona_id = v_eq and organizacion_id = v_demo;
  perform pedir_por_liga('demo', cod_ana, 'Cliente Liga Demo', '4429222201', 'cliente1@demo.test', v_avaluo, true,
                         'Calle Liga Demo 1', 'casa', null, 'Llegó por la liga de Ana', v_aviso, 'demo-ip-1', 0);
  perform pedir_por_liga('demo', cod_eq, 'Cliente Equipo Demo', '4429222202', null, v_hacend, false,
                         'Calle Liga Demo 2', 'terreno', null, null, v_aviso, 'demo-ip-2', 0);

  -- 8. Referidos de alta: uno de comisionista y uno de equipo (pendientes).
  perform pedir_alta('demo', 'Diego Referido Demo', 'diego@demo.test', '4429333301', 'DERD900101AB6', null, cod_ana, v_aviso, 'demo-ip-3', false);
  perform pedir_alta('demo', 'Elena Referida Demo', 'elena@demo.test', '4429333302', 'DERE900101AB7', null, cod_eq, v_aviso, 'demo-ip-4', false);

  perform set_config('tasa.motivo', '', true);
end;
$$;

-- Lo que quedó, para que se vea al correrlo.
select estatus_publico, honorario_tipo, count(*)
  from solicitudes where organizacion_id = (select id from organizaciones where slug = 'demo')
 group by 1, 2 order by 1, 2;
