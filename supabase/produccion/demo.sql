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
  v_diego uuid; v_elena uuid; v_fabi uuid; v_gus uuid; v_hugo uuid; v_ivan uuid; v_tomas uuid;
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
  delete from tarjeta_eventos            where organizacion_id = v_demo;
  delete from tarjeta_clics              where organizacion_id = v_demo;
  delete from testimonios                where organizacion_id = v_demo;
  delete from tarjetas                   where organizacion_id = v_demo;
  delete from eventos_vinculo            where organizacion_id = v_demo;
  delete from vinculos_referido          where organizacion_id = v_demo;
  delete from movimientos_credito        where organizacion_id = v_demo;
  delete from compras_paquete            where organizacion_id = v_demo;
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

  -- Perfil del aliado (0051): Tomás es topógrafo (pide avalúos para subdivisiones y fusiones); Fabi pidió
  -- "Otro" y espera la aprobación de admin_org (con su alerta). Los demás, Asesor inmobiliario.
  insert into personas (nombre, correo, organizacion_activa) values ('Tomás Topógrafo DEMO', 'tomas.topo@demo.test', v_demo)
  on conflict ((lower(correo))) do nothing;
  select id into v_tomas from personas where correo = 'tomas.topo@demo.test';
  insert into membresias (persona_id, organizacion_id, rol) values (v_tomas, v_demo, 'comisionista')
  on conflict (persona_id, organizacion_id) do nothing;
  insert into comisionistas (persona_id, slug, fecha_alta, curp)
  values (v_tomas, 'tomas-topografo-demo', (m1 - interval '6 months')::date, 'DEMO900101HTOMAS00')
  on conflict do nothing;
  update comisionistas set perfil_id = (select id from perfiles where organizacion_id = v_demo and nombre = 'Asesor inmobiliario'),
                           perfil_otro = null, perfil_solicitado = null, perfil_solicitado_en = null, perfil_rechazo = null
   where organizacion_id = v_demo;
  update comisionistas set perfil_id = (select id from perfiles where organizacion_id = v_demo and nombre = 'Topógrafo')
   where organizacion_id = v_demo and persona_id = v_tomas;
  update comisionistas set perfil_solicitado = 'Corredora de seguros inmobiliarios', perfil_solicitado_en = now() - interval '1 day'
   where organizacion_id = v_demo and persona_id = v_fabi;
  insert into alertas (organizacion_id, tipo, codigo, mensaje)
  values (v_demo, 'perfil_por_aprobar', v_fabi::text, 'Fabi Referida DEMO pide el perfil "Corredora de seguros inmobiliarios" para su tarjeta.');

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

  -- Tarjeta digital en los 4 niveles (el nivel del mes se fija aquí, solo en DEMO):
  --   Beto Enlace · Carla Aliado (color) · Ana Socio (estadísticas) · Diego Socio Plus (servicios y
  --   testimonios, uno por aprobar) · Elena Élite (= Socio Plus) · Gus en pausa ("no disponible").
  for v_x in select * from (values (v_beto, 1), (v_carla, 2), (v_tomas, 2), (v_ana, 3), (v_diego, 4)) v(com, orden) loop
    insert into niveles_mensuales (organizacion_id, comisionista_id, mes, nivel_id, porcentaje, promedio, meses_considerados, motivo)
    select v_demo, v_x.com, m0, n.id, n.porcentaje, 0, 1, 'promedio'
      from niveles n where n.organizacion_id = v_demo and n.orden = v_x.orden and not n.es_forzado
    on conflict (organizacion_id, comisionista_id, mes) do update set nivel_id = excluded.nivel_id, porcentaje = excluded.porcentaje;
  end loop;
  insert into tarjetas (organizacion_id, comisionista_id, frase, telefono, correo, mostrar_correo, zona, color, servicios, estado, motivo_estado) values
    (v_demo, v_beto,  'Te ayudo con tu avalúo, sin vueltas', '4429000002', null, false, 'Querétaro centro', null, '{}', 'publicada', null),
    (v_demo, v_carla, 'Cotizaciones claras en 24 horas', '4429000003', 'carla@demo.test', true, 'Corregidora y El Pueblito', '#7a3e9d', '{}', 'publicada', null),
    (v_demo, v_ana,   'Avalúos para compra, venta y herencias', '4429000001', 'ana@demo.test', true, 'Querétaro y El Marqués', '#2f6f4e', '{}', 'publicada', null),
    (v_demo, v_diego, 'Acompaño tu trámite de principio a fin', '4429000004', null, false, 'Zona metropolitana de Querétaro', '#b45309',
     array[v_avaluo, v_hacend], 'publicada', null),
    (v_demo, v_elena, 'Más de 10 años en el mercado inmobiliario', '4429000005', null, false, 'Juriquilla', '#0f766e',
     array[v_avaluo, v_ov], 'publicada', null),
    (v_demo, v_gus,   'Tarjeta en pausa', '4429000006', null, false, null, null, '{}', 'pausada', null),
    (v_demo, v_tomas, 'Levantamientos y deslindes en todo Querétaro', '4429000007', null, false, 'Querétaro y Corregidora', '#1d4ed8',
     '{}', 'publicada', null);
  -- Tarjeta de presentación (0050): servicios propios, redes y portafolio según el nivel.
  --   Beto (Enlace) 3 servicios + redes · Carla (Aliado) 6, uno oculto por Administración · Ana (Socio) 4 + 3 inmuebles ·
  --   Diego (Socio Plus) 8 + 4 inmuebles, despacho abajo · Elena (Élite) 2. Las fotos las sube scripts/demo.mjs.
  update tarjetas set facebook = 'https://facebook.com/beto.demo', instagram = 'https://instagram.com/beto.demo'
   where organizacion_id = v_demo and comisionista_id = v_beto;
  update tarjetas set instagram = 'https://instagram.com/ana.demo', linkedin = 'https://linkedin.com/in/ana-demo',
                      sitio_web = 'https://ana-demo.example.com'
   where organizacion_id = v_demo and comisionista_id = v_ana;
  update tarjetas set tiktok = 'https://tiktok.com/@diego.demo', facebook = 'https://facebook.com/diego.demo', despacho_arriba = false
   where organizacion_id = v_demo and comisionista_id = v_diego;
  insert into tarjeta_servicios (organizacion_id, comisionista_id, titulo, descripcion, icono, enlace, orden)
  select v_demo, x.com, x.titulo, x.descripcion, x.icono, x.enlace, x.orden
    from (values
      (v_beto,  'Venta de casas', 'Te acompaño desde la publicación hasta la firma.', 'casa', null, 0),
      (v_beto,  'Renta de departamentos', 'Busco inquilino y reviso su documentación.', 'llave', null, 1),
      (v_beto,  'Asesoría para comprar', 'Te ayudo a elegir zona y negociar el precio.', 'trato', null, 2),
      (v_carla, 'Venta de terrenos', 'Lotes en Corregidora y El Pueblito.', 'mapa', null, 0),
      (v_carla, 'Administración de rentas', 'Cobro, mantenimiento y reportes mensuales.', 'calculadora', null, 1),
      (v_carla, 'Fotografía de inmuebles', 'Fotos para tus anuncios.', 'camara', null, 2),
      (v_carla, 'Trámites de escrituración', 'Te acompaño con la notaría.', 'documento', null, 3),
      (v_carla, 'Locales comerciales', 'Renta y venta de locales.', 'edificio', null, 4),
      (v_carla, 'Seguro de renta', 'Te conecto con aseguradoras.', 'escudo', null, 5),
      (v_ana,   'Venta y compra de casas', 'Querétaro y El Marqués.', 'casa', 'https://ana-demo.example.com/casas', 0),
      (v_ana,   'Créditos hipotecarios', 'Te explico opciones de crédito.', 'grafica', null, 1),
      (v_ana,   'Herencias y sucesiones', 'Te oriento para vender un inmueble heredado.', 'documento', null, 2),
      (v_ana,   'Remodelación para vender', 'Contactos de confianza para mejorar tu casa.', 'herramienta', null, 3),
      (v_diego, 'Venta de residencias', 'Zona metropolitana de Querétaro.', 'casa', null, 0),
      (v_diego, 'Naves industriales', 'Renta y venta en parques industriales.', 'edificio', null, 1),
      (v_diego, 'Inversiones inmobiliarias', 'Análisis de rendimiento para inversionistas.', 'grafica', 'https://example.com/diego-inversiones', 2),
      (v_diego, 'Preventas', 'Desarrollos nuevos con precio de preventa.', 'llave', null, 3),
      (v_diego, 'Oficinas', 'Renta de oficinas por metro cuadrado.', 'maletin', null, 4),
      (v_diego, 'Ranchos y terrenos', 'Terrenos rústicos.', 'mapa', null, 5),
      (v_diego, 'Renta vacacional', 'Departamentos amueblados.', 'llave', null, 6),
      (v_diego, 'Asesoría legal inmobiliaria', 'Con abogados aliados.', 'documento', null, 7),
      (v_elena, 'Venta en Juriquilla', 'Casas y departamentos en Juriquilla.', 'casa', null, 0),
      (v_elena, 'Rentas corporativas', 'Para empresas que reubican personal.', 'maletin', null, 1),
      (v_tomas, 'Levantamiento topográfico', 'Medición del terreno con estación total y GPS.', 'mapa', null, 0),
      (v_tomas, 'Deslinde de predios', 'Ubicamos y marcamos los linderos de tu terreno.', 'documento', null, 1),
      (v_tomas, 'Subdivisiones y fusiones', 'Planos para dividir o unir predios ante el municipio.', 'edificio', null, 2),
      (v_tomas, 'Planos con curvas de nivel', 'Para proyectos de construcción y fraccionamientos.', 'grafica', null, 3),
      (v_tomas, 'Trazo de obra', 'Ejes y niveles en el terreno antes de construir.', 'herramienta', null, 4),
      (v_tomas, 'Georreferenciación', 'Coordenadas UTM para catastro y registro.', 'calculadora', null, 5)
    ) x(com, titulo, descripcion, icono, enlace, orden);
  update tarjeta_servicios set oculto_en = now(), oculto_por = v_adm, oculto_motivo = 'Ofrece un seguro sin dar el nombre de la aseguradora (DEMO)'
   where organizacion_id = v_demo and comisionista_id = v_carla and titulo = 'Seguro de renta';
  insert into tarjeta_inmuebles (organizacion_id, comisionista_id, titulo, operacion, precio, zona, foto_ruta, enlace, orden)
  values (v_demo, v_ana,   'Casa con jardín', 'venta', 3450000, 'El Refugio', 'demo/inmueble-1.png', null, 0),
         (v_demo, v_ana,   'Departamento amueblado', 'renta', 14500, 'Centro Sur', 'demo/inmueble-2.png', null, 1),
         (v_demo, v_ana,   'Terreno habitacional', 'venta', null, 'Zibatá', 'demo/inmueble-3.png', null, 2),
         (v_demo, v_diego, 'Nave industrial 1,200 m²', 'renta', 98000, 'Parque Industrial Querétaro', 'demo/inmueble-4.png', null, 0),
         (v_demo, v_diego, 'Residencia en club de golf', 'venta', 12800000, 'Juriquilla', 'demo/inmueble-5.png', 'https://example.com/residencia', 1),
         (v_demo, v_diego, 'Oficina en corporativo', 'renta', 32000, 'Centro Sur', 'demo/inmueble-6.png', null, 2),
         (v_demo, v_diego, 'Departamento en preventa', 'venta', 2650000, 'El Marqués', 'demo/inmueble-7.png', null, 3);
  insert into tarjeta_clics (organizacion_id, comisionista_id, tipo, ref_id, dia, clics)
  select v_demo, v_ana, 'servicio', s.id, hoy_mx() - g, 1 + (g % 3)
    from tarjeta_servicios s, generate_series(0, 20, 4) g
   where s.organizacion_id = v_demo and s.comisionista_id = v_ana and s.orden < 2;
  insert into tarjeta_clics (organizacion_id, comisionista_id, tipo, ref_id, dia, clics)
  select v_demo, v_ana, 'inmueble', i.id, hoy_mx() - g, 2
    from tarjeta_inmuebles i, generate_series(0, 12, 3) g
   where i.organizacion_id = v_demo and i.comisionista_id = v_ana;
  insert into testimonios (organizacion_id, comisionista_id, cliente, texto, estado, decidido_por, decidido_en) values
    (v_demo, v_diego, 'M. R.', 'Me explicó todo y el avalúo llegó antes de lo prometido.', 'aprobado', v_adm, now() - interval '5 days'),
    (v_demo, v_diego, 'Familia Torres', 'Muy amable y paciente con nuestras dudas.', 'aprobado', v_adm, now() - interval '2 days'),
    (v_demo, v_diego, 'J. L.', 'Excelente atención por WhatsApp.', 'pendiente', null, null);
  insert into tarjeta_eventos (organizacion_id, comisionista_id, dia, visitas, whatsapp)
  select v_demo, v_ana, (hoy_mx() - g)::date, 3 + (g % 5), g % 3 from generate_series(0, 40, 3) g;

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

  -- 6b. Pagos que recibió el comisionista, asignaciones y trámites traídos de Notion (0047).
  -- Ana cobró en efectivo hace 8 días y no lo ha entregado: vencido, con su alerta (el cron no alerta en DEMO).
  insert into solicitudes (comisionista_id, tipo, servicio_id, inmueble_direccion, inmueble_municipio, cliente_nombre,
                           marca_id, cuenta_receptora_id, monto_honorarios, estado, estatus_publico, aceptada_en, creado_por)
  values (v_ana, 'cotizacion', v_avaluo, 'Calle Efectivo Demo 8', 'Querétaro', 'Cliente Efectivo Demo',
          v_marca, v_cuenta, 6000, 'tramite', 'visita_agendada', now() - interval '12 days', v_ana) returning id into s;
  insert into pagos (solicitud_id, via, monto, fecha_pago, recibido_por, reportado_por, recibio_asesor)
  values (s, 'efectivo', 3000, hoy_mx() - 8, 'Ana Comisionista Demo', v_ana, true);
  insert into alertas (organizacion_id, tipo, solicitud_id, mensaje)
  values (v_demo, 'pago_por_entregar', s,
          'Pago por entregar vencido: Ana DEMO recibió $3,000.00 del cliente hace 8 días y no lo ha entregado a la cuenta · Cliente Efectivo Demo');
  -- Carla recibió una transferencia y ya la entregó: por confirmar, con su comprobante del depósito.
  insert into solicitudes (comisionista_id, tipo, servicio_id, inmueble_direccion, inmueble_municipio, cliente_nombre,
                           marca_id, cuenta_receptora_id, monto_honorarios, estado, estatus_publico, aceptada_en, creado_por)
  values (v_carla, 'cotizacion', v_hacend, 'Calle Entrega Demo 2', 'Corregidora', 'Cliente Entrega Demo',
          v_marca, v_cuenta, 4000, 'tramite', 'en_elaboracion', now() - interval '5 days', v_carla) returning id into s;
  insert into pagos (solicitud_id, via, monto, fecha_pago, comprobante_ruta, reportado_por, recibio_asesor)
  values (s, 'comprobante', 4000, hoy_mx() - 1, v_demo || '/' || v_carla || '/demo-entrega-cliente.jpg', v_carla, true) returning id into p;
  update pagos set entregado_en = now(), entrega_ruta = v_demo || '/' || v_carla || '/demo-entrega-deposito.jpg' where id = p;
  -- Un trámite que era de Beto y se le asignó a Ana (queda en su historial).
  insert into solicitudes (comisionista_id, tipo, servicio_id, inmueble_direccion, inmueble_municipio, cliente_nombre,
                           marca_id, cuenta_receptora_id, monto_honorarios, estado, estatus_publico, aceptada_en, creado_por)
  values (v_ana, 'cotizacion', v_avaluo, 'Calle Reasignada Demo 3', 'Querétaro', 'Cliente Reasignado Demo',
          v_marca, v_cuenta, 8000, 'tramite', 'en_elaboracion', now() - interval '9 days', v_beto) returning id into s;
  insert into eventos_trabajo (organizacion_id, solicitud_id, accion, motivo, detalle, persona_id)
  values (v_demo, s, 'asignar_comisionista', 'El cliente lo trajo Ana (DEMO)', 'Beto Comisionista Demo → Ana Comisionista Demo', v_adm);
  -- Uno que no genera comisión: Diego solo lo recomendó.
  insert into solicitudes (comisionista_id, tipo, servicio_id, inmueble_direccion, inmueble_municipio, cliente_nombre,
                           marca_id, cuenta_receptora_id, monto_honorarios, estado, estatus_publico, aceptada_en, creado_por)
  values (v_diego, 'cotizacion', v_avaluo, 'Calle Recomendada Demo 4', 'El Marqués', 'Cliente Recomendado Demo',
          v_marca, v_cuenta, 10000, 'tramite', 'aceptada', now() - interval '2 days', v_adm) returning id into s;
  update solicitudes set comision_regla_antes = 'normal', comision_regla = 'ninguna',
                         sin_comision_motivo = 'Solo lo recomendó; ya estaba pactado con el despacho (DEMO)' where id = s;
  insert into eventos_trabajo (organizacion_id, solicitud_id, accion, motivo, persona_id)
  values (v_demo, s, 'sin_comision', 'Solo lo recomendó; ya estaba pactado con el despacho (DEMO)', v_adm);
  -- Traído de Notion (lectura simulada): ligado a su "página" y con su folio.
  insert into solicitudes (comisionista_id, tipo, origen, servicio_id, inmueble_direccion, inmueble_municipio, cliente_nombre,
                           cliente_telefono, marca_id, cuenta_receptora_id, monto_honorarios, estado, estatus_publico, aceptada_en,
                           folio, externo_id, estatus_externo, externo_leido_en, creado_por)
  values (v_carla, 'tramite_directo', 'importado', v_avaluo, 'Calle Notion Demo 9', 'Querétaro', 'Cliente Notion Demo',
          '4429990000', v_marca, v_cuenta, 7500, 'tramite', 'en_elaboracion', now() - interval '25 days',
          'DEMO-' || extract(year from hoy_mx()) || '-0901', 'demo-notion-0901', 'En elaboración', now(), v_adm) returning id into s;
  insert into eventos_trabajo (organizacion_id, solicitud_id, accion, motivo, detalle, persona_id)
  values (v_demo, s, 'importar', 'Lo trajo Carla antes de Tasa (DEMO)',
          'Traído de Notion con el folio DEMO-' || extract(year from hoy_mx()) || '-0901', v_adm);

  -- 7. Liga de cliente: de comisionista ("Quiero el trámite") y de equipo.
  select aviso_version into v_aviso from ajustes where organizacion_id = v_demo;
  select codigo_referido into cod_ana from comisionistas where persona_id = v_ana and organizacion_id = v_demo;
  select codigo_referido into cod_eq from membresias where persona_id = v_eq and organizacion_id = v_demo;
  perform pedir_por_liga('demo', cod_ana, 'Cliente Liga Demo', '4429222201', 'cliente1@demo.test', v_avaluo, true,
                         'Calle Liga Demo 1', 'casa', null, 'Llegó por la liga de Ana', v_aviso, 'demo-ip-1', 0);
  perform pedir_por_liga('demo', cod_eq, 'Cliente Equipo Demo', '4429222202', null, v_hacend, false,
                         'Calle Liga Demo 2', 'terreno', null, null, v_aviso, 'demo-ip-2', 0);

  -- Un teléfono que llegó al límite de la liga (Alertas → Liberar este teléfono).
  insert into alertas (organizacion_id, tipo, codigo, mensaje)
  values (v_demo, 'liga_limite', '4429222299',
          'La liga de Ana DEMO llegó al límite de 10 solicitudes al día con el teléfono 4429222299. Si es un cliente real, libera el teléfono.');

  -- 8. Referidos de alta: uno de comisionista y uno de equipo (pendientes).
  perform pedir_alta('demo', 'Diego Referido Demo', 'diego@demo.test', '4429333301', 'DERD900101AB6', null, cod_ana, v_aviso, 'demo-ip-3', false);
  perform pedir_alta('demo', 'Elena Referida Demo', 'elena@demo.test', '4429333302', 'DERE900101AB7', null, cod_eq, v_aviso, 'demo-ip-4', false);

  -- 9. Calculadora de traslado (0055): activa en DEMO; la completa, para Socio en adelante y el equipo (catálogo 0053).
  perform sembrar_herramientas(v_demo);
  perform sembrar_parametros_fiscales(v_demo);
  update herramientas set activa = true where organizacion_id = v_demo and clave in ('calculadora_traslado', 'calculadora_traslado_completa');
  delete from calculos_traslado where organizacion_id = v_demo;
  delete from usos_herramienta where organizacion_id = v_demo;
  -- Un cálculo de ejemplo para cada persona DEMO ("Mis cálculos" es solo de quien calculó): caso 01 de las skills.
  insert into calculos_traslado (organizacion_id, persona_id, modo, referencia, municipio, lado, entrada, resultado)
  select v_demo, p.id, 'rapida', 'Ejemplo DEMO · casa en Querétaro', 'Querétaro', 'C',
         '{"fecha_firma":"2026-11-20","referencia":"Ejemplo DEMO · casa en Querétaro","operacion":"compraventa","donacion_exenta":false,"valor_catastral":0,"comprador":{"vivienda_primera":null,"incluir_avaluo":true,"certificados_gravamen":1},"vendedor":{"isr":null,"cancelar_hipoteca":0},"extemporaneo":null,"detalle":true,"lado":"C","municipio":"Querétaro","valor_operacion":2500000,"avaluo":2400000}'::jsonb,
         '{"lado":"C","municipio":"Querétaro","fecha":"2026-11-20","vo":2500000,"va":2400000,"vk":0,"C":[["Impuestos","Impuesto sobre traslado de dominio (ISTD)",140772.41],["Honorarios notariales","Honorarios por la escritura",20711.7],["Honorarios notariales","Trámite de inscripción en el Registro Público",469.24],["Honorarios notariales","IVA de honorarios (16 %)",3388.95],["Derechos y trámites","Inscripción en el Registro Público",18750],["Derechos y trámites","Avisos preventivo y definitivo",703.86],["Derechos y trámites","Certificado de libertad de gravamen",586.55],["Derechos y trámites","Avalúo hacendario (incluye folio)",11300],["Derechos y trámites","IVA del avalúo (16 %)",1808]],"V":[],"totC":198490.71,"totV":0,"det":[["ISTD · Querétaro (Art. 15)",["Base: el mayor entre operación 2,500,000.00, comercial 2,400,000.00 → operación.","Cálculo: cuota fija 74,616.95 + (2,500,000.00 − 1,379,992.90) × 0.059067 = $140,772.41."]],["ISR por adquisición",["Avalúo no excede en más de 10 % el precio: no hay ISR por adquisición."]],["Honorarios notariales (Ley del Notariado, arts. 147 y 171-V)",["Base: el mayor entre operación, comercial y fiscal = $2,500,000.00.","36 UMA fijas + 140.56 UMA progresivas sobre 21,311.1 UMA = $20,711.70.","Trámite de inscripción 4 UMA = $469.24."]],["Registro Público de la Propiedad (LHEQ)",["7.5 al millar sobre 2,500,000.00 (LHEQ arts. 90, 97 y 110) = $18,750.00.","Avisos preventivo (4 UMA) y definitivo (2 UMA) = $703.86.","Certificado de libertad de gravamen 5 UMA × 1 = $586.55."]],["Avalúo hacendario",["Arancel del Consejo de Valuadores sobre $2,400,000.00 = $11,300.00 + IVA (incluye derechos de folio)."]]],"notas":["La ley excluye las deducciones de vivienda de interés social y popular.","Herencias y donaciones entre cónyuges y línea recta: estímulo del programa municipal (PEF-TP, de 40 % a 100 %), no incluido."],"mejora":null,"ley_istd":"Ley de Ingresos 2026 (P.O. No. 103, 25-XII-2025, pág. 50252)","SC":["El avalúo es menor al precio: el ISTD y los derechos se calculan sobre el precio pactado."],"SV":[],"avisos":[]}'::jsonb
    from personas p where p.correo in ('xchel+demo-admin@arqosuv.com', 'xchel+demo-finanzas@arqosuv.com', 'xchel+demo-equipo@arqosuv.com', 'xchel+demo-ana@arqosuv.com');
  -- Cupos (0057): Ana lleva 12 cálculos rápidos y 1 completo este mes, y se le liberaron 2 completos más.
  delete from extras_herramienta where organizacion_id = v_demo;
  perform sembrar_cupos(v_demo);
  insert into usos_herramienta (organizacion_id, persona_id, herramienta, modo)
  select v_demo, p.id, h, m from personas p, (select 'calculadora_traslado' h, 'rapida' m from generate_series(1, 12) union all select 'calculadora_traslado_completa', 'completa') x
   where p.correo = 'xchel+demo-ana@arqosuv.com';
  insert into extras_herramienta (organizacion_id, persona_id, herramienta, mes, cantidad, motivo)
  select v_demo, p.id, 'calculadora_traslado_completa', mes_mx(now()), 2, 'Ejemplo DEMO: varias operaciones este mes'
    from personas p where p.correo = 'xchel+demo-ana@arqosuv.com';

  -- 10. Mapa catastral (0059): encendido en DEMO. Tres predios INVENTADOS (claves que no existen en catastro,
  --     marcados demo: solo los ven organizaciones demo) junto al Jardín Zenea: uno normal con kardex, un
  --     condominio con MultiPolygon y uno con el expediente pendiente. Sin datos personales reales. Con su geometría
  --     UTM "de la fuente" (0066) y la de grados con 9 decimales.
  update herramientas set activa = true where organizacion_id = v_demo and clave in ('mapa_catastral', 'mapa_catastral_pdf');
  perform sembrar_campos_catastro(v_demo);
  delete from catastro_propietarios where organizacion_id = v_demo;
  delete from catastro_fallas where organizacion_id = v_demo;
  delete from catastro_predios where demo;
  insert into catastro_predios (clave, municipio, geometria, geometria_utm, latitud, longitud, lat_min, lat_max, lon_min, lon_max, colonia, codigo_postal,
                                ubicacion, sup_terreno, sup_construccion, extra, expediente, consultado_en, demo)
  values
    ('149999990000001', '14',
     '{"type":"Polygon","coordinates":[[[-100.392299953,20.592800034],[-100.392100013,20.592800017],[-100.392100031,20.592949982],[-100.392299971,20.592949999],[-100.392299953,20.592800034]]]}',
     '{"type":"Polygon","coordinates":[[[354900.29,2277702.94],[354921.13,2277702.76],[354921.27,2277719.36],[354900.43,2277719.54],[354900.29,2277702.94]]]}',
     20.592875, -100.392200, 20.592800, 20.592950, -100.392300, -100.392100, 'Centro (ejemplo DEMO)', '76000',
     'Calle Ejemplo 10, Colonia Centro (ejemplo DEMO), CP 76000, Querétaro', 350.5, 280,
     '{"tipo_predio":"URBANO","clasificacion":"HABITACIONAL","valor_terreno":1850000,"valor_construccion":1420000,"capa_area":350.48,"capa_folio":"DEMO-1","rppc_lote":"7","rppc_medid_colind":"Al norte 20.00 m con lote 6 (ejemplo DEMO)"}',
     'completo', now() - interval '10 days', true),
    ('149999990000002', '14',
     '{"type":"MultiPolygon","coordinates":[[[[-100.392000043,20.592800009],[-100.391849992,20.592800042],[-100.391850026,20.592920014],[-100.39199998,20.592919982],[-100.392000043,20.592800009]]],[[[-100.391800007,20.592799992],[-100.391719993,20.592800004],[-100.391719961,20.59285999],[-100.391799975,20.592859979],[-100.391800007,20.592799992]]]]}',
     '{"type":"MultiPolygon","coordinates":[[[[354931.55,2277702.67],[354947.19,2277702.54],[354947.3,2277715.82],[354931.67,2277715.95],[354931.55,2277702.67]]],[[[354952.4,2277702.49],[354960.74,2277702.42],[354960.8,2277709.06],[354952.46,2277709.13],[354952.4,2277702.49]]]]}',
     20.592858, -100.391900, 20.592800, 20.592920, -100.392000, -100.391720, 'Centro (ejemplo DEMO)', '76000',
     'Calle Ejemplo 12 int. 3, Colonia Centro (ejemplo DEMO), CP 76000, Querétaro', 95.2, 88.7,
     '{"tipo_predio":"CONDOMINIO","regimen":"CONDOMINIO","tipo_condominio":"VERTICAL","nombre_condominio":"Condominio Ejemplo DEMO","indiviso":12.5,"sup_terreno_privativa":60.1,"sup_terreno_comun":35.1,"sup_construccion_privativa":72.4,"sup_construccion_comun":16.3,"valor_terreno_privativo":410000,"valor_construccion_privativa":520000,"cacoct":1,"vacopt":0,"clave_original":"149999990000000"}',
     'completo', now() - interval '20 days', true),
    ('149999990000003', '14',
     '{"type":"Polygon","coordinates":[[[-100.392300041,20.592999957],[-100.392100005,20.593000031],[-100.392100039,20.593120003],[-100.392299979,20.59312002],[-100.392300041,20.592999957]]]}',
     '{"type":"Polygon","coordinates":[[[354900.47,2277725.07],[354921.32,2277724.9],[354921.43,2277738.18],[354900.59,2277738.36],[354900.47,2277725.07]]]}',
     20.593060, -100.392200, 20.593000, 20.593120, -100.392300, -100.392100, null, null, null, null, null,
     '{"capa_area":266.9,"capa_folio":"DEMO-3"}', 'pendiente', now() - interval '1 day', true);
  insert into catastro_versiones (clave, consultado_en, reemplazada_en, cambios, antes)
  values ('149999990000001', now() - interval '200 days', now() - interval '10 days', '{valor_construccion,valor_terreno}',
          '{"valor_terreno":1700000,"valor_construccion":1380000,"sup_terreno":350.5}');
  insert into catastro_propietarios (organizacion_id, clave, propietarios, valor_operacion, escritura, notario, numero_contrato)
  values (v_demo, '149999990000001', '[{"nombre":"Inmobiliaria Ejemplo DEMO","porcentaje":100,"origen":"catastro"},{"nombre":"Inmobiliaria Ejemplo DEMO","porcentaje":100,"origen":"rppc","tipo_adquisicion":"COMPRAVENTA"}]',
          2900000, '12345', 'Notaría 99 (ejemplo DEMO)', 'DEMO-0001');
  -- Ana lleva 5 consultas del mes.
  insert into usos_herramienta (organizacion_id, persona_id, herramienta, modo)
  select v_demo, p.id, 'mapa_catastral', 'consulta' from personas p, generate_series(1, 5)
   where p.correo = 'xchel+demo-ana@arqosuv.com';

  -- 11. DXF del mapa catastral (0065): Ana autorizada con 3 descargas para probar con los predios de ejemplo.
  delete from dxf_descargas where organizacion_id = v_demo;
  delete from dxf_movimientos where organizacion_id = v_demo;
  delete from dxf_autorizaciones where organizacion_id = v_demo;
  insert into dxf_autorizaciones (organizacion_id, persona_id, saldo) values (v_demo, v_ana, 3);
  insert into dxf_movimientos (organizacion_id, persona_id, accion, cantidad, saldo_despues, motivo, hecho_por)
  values (v_demo, v_ana, 'autorizar', 3, 3, 'DEMO: para probar el DXF con los predios de ejemplo', v_adm);

  perform set_config('tasa.motivo', '', true);
end;
$$;

-- 12. Uso de ejemplo para Estadísticas, Accesos y "Mi uso" (0070-0073): del día 1 del mes a hoy, sin humo. Reproducible
--     (sin azar). Consultas de la fuente (con tiempos y alguna falla) y de lo guardado, PDF, DXF, cálculos, accesos,
--     denegaciones, un "pedir más", y solicitudes de este mes marcadas como venidas del mapa o de la calculadora.
do $$
declare
  v_demo  uuid := (select id from organizaciones where slug = 'demo');
  v_ini   date := date_trunc('month', now() at time zone 'America/Mexico_City')::date;
  v_dias  integer := ((now() at time zone 'America/Mexico_City')::date - date_trunc('month', now() at time zone 'America/Mexico_City')::date);
  v_gente uuid[] := array(select p.id from personas p where p.correo in ('xchel+demo-ana@arqosuv.com', 'xchel+demo-beto@arqosuv.com',
                                                                         'xchel+demo-carla@arqosuv.com', 'diego.ref@demo.test')
                          order by p.correo);
  v_claves text[] := array['149999990000001', '149999990000002', '149999990000003'];
  v_p     uuid;
  i       integer;
  d       integer;
  k       integer;
  v_t     timestamptz;
begin
  if v_demo is null then return; end if;
  delete from eventos_uso where organizacion_id = v_demo and not humo;
  update solicitudes set origen_herramienta = null, evento_origen_id = null
   where organizacion_id = v_demo and calculo_traslado_id is null;
  for i in 1 .. coalesce(array_length(v_gente, 1), 0) loop
    v_p := v_gente[i];
    for d in 0 .. v_dias loop
      v_t := ((v_ini + d)::timestamp + time '10:00') at time zone 'America/Mexico_City';
      if (d + i) % 3 = 0 then
        insert into eventos_uso (organizacion_id, persona_id, herramienta, evento, resultado, referencia, creado_en, humo)
        values (v_demo, v_p, 'acceso', 'acceso', 'ok', case when i % 2 = 0 then 'Safari en iPhone' else 'Chrome en Android' end, v_t, false);
      end if;
      for k in 1 .. ((d * i) % 3) + 1 loop
        insert into eventos_uso (organizacion_id, persona_id, herramienta, evento, origen, clave, resultado, consumio, duracion_ms, creado_en, humo)
        values (v_demo, v_p, 'mapa_catastral', 'consulta',
                case when k = 1 then 'fuente' else 'guardado' end,
                v_claves[1 + ((d + k + i) % 3)],
                case when k = 1 and (d + i) % 7 = 0 then 'falla' else 'ok' end,
                k = 1 and (d + i) % 7 <> 0,
                case when k = 1 then 900 + ((d * 37 + i * 211) % 2600) end,
                v_t + make_interval(mins => 15 * k), false);
      end loop;
      if (d + i) % 4 = 0 then
        insert into eventos_uso (organizacion_id, persona_id, herramienta, evento, origen, clave, resultado, consumio, creado_en, humo)
        values (v_demo, v_p, 'mapa_catastral_pdf', 'pdf', 'guardado', v_claves[1 + (d % 3)], 'ok', true, v_t + interval '1 hour', false);
      end if;
      if (d + i) % 5 = 0 then
        insert into eventos_uso (organizacion_id, persona_id, herramienta, evento, resultado, consumio, creado_en, humo)
        values (v_demo, v_p, case when i % 2 = 0 then 'calculadora_traslado_completa' else 'calculadora_traslado' end, 'calculo', 'ok', true,
                v_t + interval '2 hours', false);
      end if;
    end loop;
  end loop;
  -- Beto llegó a su límite de PDF (3 en Enlace): uno más, el día 1.
  insert into eventos_uso (organizacion_id, persona_id, herramienta, evento, origen, clave, resultado, consumio, creado_en, humo)
  select v_demo, id, 'mapa_catastral_pdf', 'pdf', 'guardado', '149999990000003', 'ok', true,
         (v_ini::timestamp + time '09:00') at time zone 'America/Mexico_City', false
    from personas where correo = 'xchel+demo-beto@arqosuv.com';
  -- Ana: un DXF; Beto: se quedó sin PDF (denegación) y pidió más.
  insert into eventos_uso (organizacion_id, persona_id, herramienta, evento, origen, clave, resultado, consumio, creado_en, humo)
  select v_demo, id, 'mapa_catastral_dxf', 'dxf', 'guardado', '149999990000002', 'ok', true, now() - interval '2 days', false
    from personas where correo = 'xchel+demo-ana@arqosuv.com';
  insert into eventos_uso (organizacion_id, persona_id, herramienta, evento, clave, resultado, codigo, estado_http, creado_en, humo)
  select v_demo, id, 'mapa_catastral_pdf', 'denegado', '149999990000001', 'denegado', 'sin_cupo', 429, now() - interval '1 day', false
    from personas where correo = 'xchel+demo-beto@arqosuv.com';
  insert into alertas (organizacion_id, tipo, codigo, mensaje, creada_en)
  select v_demo, 'cupo_agotado', id || ':mapa_catastral_pdf:' || to_char(v_ini, 'YYYY-MM'), 'Beto DEMO llegó a su límite de PDF del mapa catastral este mes y pide más.',
         now() - interval '1 day'
    from personas where correo = 'xchel+demo-beto@arqosuv.com'
  on conflict do nothing;
  -- El cupo se cuenta con usos_herramienta: lo que gastó cupo en los eventos del mapa y del PDF (los cálculos ya los trae la semilla).
  delete from usos_herramienta where organizacion_id = v_demo and not humo and herramienta in ('mapa_catastral', 'mapa_catastral_pdf');
  insert into usos_herramienta (organizacion_id, persona_id, herramienta, modo, referencia, creado_en, humo)
  select organizacion_id, persona_id, herramienta, case when herramienta = 'mapa_catastral' then 'consulta' else 'pdf' end,
         case when herramienta = 'mapa_catastral_pdf' then clave end, creado_en, false
    from eventos_uso
   where organizacion_id = v_demo and not humo and consumio and herramienta in ('mapa_catastral', 'mapa_catastral_pdf');
  -- Embudo: solicitudes de este mes venidas del mapa (Ana y Carla) y de la calculadora (Beto).
  update solicitudes s set origen_herramienta = 'mapa_catastral'
   where s.id in (select s2.id from solicitudes s2 join personas p on p.id = s2.comisionista_id
                   where s2.organizacion_id = v_demo and p.correo in ('xchel+demo-ana@arqosuv.com', 'xchel+demo-carla@arqosuv.com')
                     and s2.creado_en >= v_ini::timestamp at time zone 'America/Mexico_City' and s2.estado in ('tramite', 'solicitada', 'cotizada')
                   order by s2.creado_en limit 5);
  update solicitudes s set origen_herramienta = 'calculadora_traslado'
   where s.id in (select s2.id from solicitudes s2 join personas p on p.id = s2.comisionista_id
                   where s2.organizacion_id = v_demo and p.correo = 'xchel+demo-beto@arqosuv.com'
                     and s2.creado_en >= v_ini::timestamp at time zone 'America/Mexico_City' and s2.origen_herramienta is null
                   order by s2.creado_en limit 2);
end;
$$;

-- Lo que quedó, para que se vea al correrlo.
select estatus_publico, honorario_tipo, count(*)
  from solicitudes where organizacion_id = (select id from organizaciones where slug = 'demo')
 group by 1, 2 order by 1, 2;

-- 13. Monedero (0077): Ana DEMO con un trimestral a medio usar. Lo compró hace 40 días (transferencia confirmada) y
--     aplicó 6,000 a un trámite fijo sin pagos (el resto de ese trámite se paga normal). La cuenta para paquetes de
--     DEMO es su cuenta sugerida. Solo si Ana todavía no tiene compras: no se duplica al volver a correr.
do $$
declare
  v_demo  uuid := (select id from organizaciones where slug = 'demo');
  v_ana   uuid := (select id from personas where correo = 'xchel+demo-ana@arqosuv.com');
  v_paq   uuid;
  v_cta   uuid;
  v_comp  uuid;
  v_sol   uuid;
  v_fecha date := hoy_mx() - 40;
begin
  if v_demo is null or v_ana is null then return; end if;
  if exists (select 1 from compras_paquete where organizacion_id = v_demo and persona_id = v_ana) then return; end if;
  v_cta := coalesce((select cuenta_paquetes from ajustes where organizacion_id = v_demo),
                    (select m.cuenta_sugerida_id from marcas m where m.organizacion_id = v_demo and m.cuenta_sugerida_id is not null order by m.clave limit 1),
                    (select c.id from cuentas_receptoras c where c.organizacion_id = v_demo and c.activa order by c.alias limit 1));
  update ajustes set cuenta_paquetes = v_cta where organizacion_id = v_demo and cuenta_paquetes is null;
  v_paq := (select id from paquetes where organizacion_id = v_demo and clave = 'trimestral');
  if v_paq is null or v_cta is null then return; end if;

  insert into compras_paquete (organizacion_id, persona_id, paquete_id, tipo, precio, credito, terminos_version, terminos_aceptados_en,
                               pago_monto, pago_fecha, cuenta_id, pago_referencia, folio_cfdi, creado_en)
  values (v_demo, v_ana, v_paq, 'compra', 10000, 12000, (select max(version) from terminos_paquetes where organizacion_id = v_demo),
          v_fecha::timestamp at time zone 'America/Mexico_City', 10000, v_fecha, v_cta, 'SPEI DEMO 0001', 'A-DEMO-1',
          v_fecha::timestamp at time zone 'America/Mexico_City')
  returning id into v_comp;
  perform set_config('tasa.org', v_demo::text, true);
  perform ejecutar_confirmar_compra(v_comp, v_fecha, (select id from personas where correo = 'xchel+demo-finanzas@arqosuv.com'));
  update movimientos_credito set creado_en = v_fecha::timestamp at time zone 'America/Mexico_City' + interval '11 hours' where compra_id = v_comp;

  v_sol := (select s.id from solicitudes s
             where s.organizacion_id = v_demo and s.comisionista_id = v_ana and s.estado = 'tramite' and s.pagado_en is null
               and s.honorario_tipo = 'fijo' and s.convenio_id is null and s.monto_honorarios >= 6000
               and not exists (select 1 from pagos g where g.solicitud_id = s.id)
             order by s.creado_en limit 1);
  if v_sol is not null then
    perform ejecutar_aplicar_credito(v_sol, 6000, v_ana);
  end if;
end;
$$;

-- 14. Marca DEMO (admin_marca) para humo: ve solo lo de una marca de DEMO. Una sola vez.
do $$
declare
  v_demo  uuid := (select id from organizaciones where slug = 'demo');
  v_p     uuid;
  v_m     uuid;
  v_marca uuid;
begin
  if v_demo is null then return; end if;
  insert into personas (nombre, correo, organizacion_activa) values ('Marca DEMO', 'xchel+demo-marca@arqosuv.com', v_demo)
  on conflict ((lower(correo))) do nothing;
  select id into v_p from personas where lower(correo) = 'xchel+demo-marca@arqosuv.com';
  update personas set organizacion_activa = v_demo, activo = true where id = v_p;
  insert into membresias (persona_id, organizacion_id, rol) values (v_p, v_demo, 'admin_marca') on conflict (persona_id, organizacion_id) do nothing;
  select id into v_m from membresias where persona_id = v_p and organizacion_id = v_demo;
  v_marca := (select id from marcas where organizacion_id = v_demo order by clave limit 1);
  if v_marca is not null then
    insert into membresia_marcas (organizacion_id, membresia_id, marca_id) values (v_demo, v_m, v_marca) on conflict do nothing;
  end if;
  update personas p set user_id = u.id from auth.users u where p.id = v_p and p.user_id is null and lower(u.email) = lower(p.correo);
  -- Su cálculo de ejemplo ("Mis cálculos" es solo de quien calculó), como el de las demás personas DEMO.
  insert into calculos_traslado (organizacion_id, persona_id, modo, referencia, municipio, lado, entrada, resultado)
  select c.organizacion_id, v_p, c.modo, c.referencia, c.municipio, c.lado, c.entrada, c.resultado
    from calculos_traslado c join personas q on q.id = c.persona_id
   where c.organizacion_id = v_demo and q.correo = 'xchel+demo-admin@arqosuv.com'
     and not exists (select 1 from calculos_traslado x where x.persona_id = v_p)
   limit 1;
end;
$$;
