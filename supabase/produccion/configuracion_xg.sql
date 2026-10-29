-- ============================================================
-- CONFIGURACIÓN INICIAL DE XG EN PRODUCCIÓN (Etapa B)
--
-- Se corre UNA vez, justo después de `db:reset-produccion`, con
--   npx supabase db query --linked -f supabase/produccion/configuracion_xg.sql
-- Los términos y el aviso los pega aparte `cargar_textos` (scripts),
-- desde docs/textos-produccion. Nada de aquí es secreto.
--
-- Datos: mensaje de Xchel "PASO A PRODUCCIÓN" (28-oct-2026).
-- ============================================================

begin;

select set_config('tasa.org', 'a0000000-0000-4000-8000-000000000001', true);

-- ------------------------------------------------------------
-- MARCAS (envío de comprobante: al comisionista; lo dice el PDF)
-- ------------------------------------------------------------
update marcas set
  nombre_legal = 'MGP Ingeniería y Valuación Inmobiliaria',
  direccion = 'High Park Corporate Centro Sur, Oficina 15H, C.P. 76090, Querétaro, Qro.',
  correo = 'avaluosmgp@gmail.com',
  telefonos = '442 682 1525 · 442 109 1882',
  firmante = 'M. en C. Mitzin Xchel Guerrero Solorio', firmante_cargo = 'Director de Operaciones',
  color = '#04386C', color_acento = '#006DB3', color_claro = '#E7F0F8', tipografia = 'manrope', hoja = 'carta', logo_ruta = null
 where organizacion_id = current_setting('tasa.org')::uuid and clave = 'MGP';

update marcas set
  nombre_legal = 'AP73 · Adrián Puente',
  direccion = 'High Park Corporate Centro Sur, Oficina 15H, C.P. 76090, Querétaro, Qro.',
  correo = 'gerencia@ap73.mx · apuente@ap73.mx',
  telefonos = '442 682 1525 · 442 426 1073',
  firmante = 'M. en C. Adrián Gonzalo Puente Suárez', firmante_cargo = 'Tasador con registro en el Estado de Querétaro',
  color = '#262626', color_acento = '#262626', color_claro = '#EFEFEF', tipografia = 'adventor', hoja = 'oficio', logo_ruta = null
 where organizacion_id = current_setting('tasa.org')::uuid and clave = 'AP73';

update marcas set
  nombre_legal = 'ARQOS Unidad de Valuación en Inteligencia Inmobiliaria, S.A. de C.V.',
  direccion = 'High Park Corporate Centro Sur, Oficina 15H, C.P. 76090, Querétaro, Qro.',
  correo = 'xchel@arqosuv.com',
  telefonos = '442 682 1525 · 442 109 1882',
  firmante = 'M. en C. Mitzin Xchel Guerrero Solorio', firmante_cargo = 'Director de Operaciones',
  color = '#1F3C6E', color_acento = '#1F3C6E', color_claro = '#E8EDF5', tipografia = 'adventor', hoja = 'carta', logo_ruta = null
 where organizacion_id = current_setting('tasa.org')::uuid and clave = 'ARQOS';

update marcas set
  nombre_legal = 'Mitzin Xchel Guerrero Solorio',
  direccion = 'High Park Corporate Centro Sur, Oficina 15H, C.P. 76090, Querétaro, Qro.',
  correo = 'xguerrero.mgp@gmail.com',
  telefonos = '442 682 1525 · 442 109 1882',
  firmante = 'M. en C. Mitzin Xchel Guerrero Solorio', firmante_cargo = 'Director de Operaciones',
  color = '#04386C', color_acento = '#006DB3', color_claro = '#E7F0F8', tipografia = 'manrope', hoja = 'carta', logo_ruta = null
 where organizacion_id = current_setting('tasa.org')::uuid and clave = 'XG';

-- ------------------------------------------------------------
-- CUENTAS RECEPTORAS (la base revisa el dígito de control de la CLABE)
-- ------------------------------------------------------------
insert into cuentas_receptoras (organizacion_id, alias, banco, clabe, titular, rfc, marca_id)
select current_setting('tasa.org')::uuid, v.alias, v.banco, v.clabe, v.titular, v.rfc, m.id
  from (values
    ('ROMI', 'Fondeadora', '699180600008088771', 'Conjuntos Habitacionales y Comerciales ROMI, S.A. de C.V.', 'CHC2206204P2', 'MGP'),
    ('Banregio AP73', 'BanRegio', '058597000050240948', 'Adrián Gonzalo Puente Suárez', 'PUSA8705253C3', 'AP73'),
    ('Scotiabank XG', 'Scotiabank', '044680035049542462', 'Mitzin Xchel Guerrero Solorio', 'GUSM840104GU9', 'XG')
  ) as v(alias, banco, clabe, titular, rfc, marca)
  join marcas m on m.organizacion_id = current_setting('tasa.org')::uuid and m.clave = v.marca;

update marcas m set cuenta_sugerida_id = c.id
  from cuentas_receptoras c
 where m.organizacion_id = current_setting('tasa.org')::uuid and c.organizacion_id = m.organizacion_id
   and (m.clave, c.alias) in (('MGP', 'ROMI'), ('AP73', 'Banregio AP73'), ('XG', 'Scotiabank XG'));

-- ------------------------------------------------------------
-- SERVICIOS: los seis de producción; los de 0008 que no van se borran
-- (en una base recién reseteada nadie los usa).
-- ------------------------------------------------------------
update servicios set nombre = 'Opinión de valor (con o sin visita)', orden = 1
 where organizacion_id = current_setting('tasa.org')::uuid and nombre = 'Opinión de Valor';
update servicios set nombre = 'Avalúo comercial', orden = 2
 where organizacion_id = current_setting('tasa.org')::uuid and nombre = 'Avalúo Comercial';
update servicios set nombre = 'Avalúo hacendario', orden = 3
 where organizacion_id = current_setting('tasa.org')::uuid and nombre = 'Avalúo Hacendario';
update servicios set nombre = 'Dictamen pericial', orden = 4
 where organizacion_id = current_setting('tasa.org')::uuid and nombre = 'Peritaje para el Poder Judicial';

-- Infonavit y Fovissste toman los textos del avalúo para crédito.
insert into servicios (organizacion_id, nombre, orden, alcance, tiempo_entrega, documentos, aviso)
select organizacion_id, v.nombre, v.orden, alcance, tiempo_entrega, documentos, aviso
  from servicios, (values ('Avalúo Infonavit', 5), ('Avalúo Fovissste', 6)) as v(nombre, orden)
 where organizacion_id = current_setting('tasa.org')::uuid and servicios.nombre = 'Avalúo Bancario';

delete from servicios
 where organizacion_id = current_setting('tasa.org')::uuid
   and nombre not in ('Opinión de valor (con o sin visita)', 'Avalúo comercial', 'Avalúo hacendario',
                      'Dictamen pericial', 'Avalúo Infonavit', 'Avalúo Fovissste');
update servicios set activo = true where organizacion_id = current_setting('tasa.org')::uuid;

-- ------------------------------------------------------------
-- NIVELES Y PARÁMETROS (los niveles de 0008 ya son los de producción)
-- ------------------------------------------------------------
update niveles set umbral_minimo = v.umbral, porcentaje = v.pct, orden = v.orden
  from (values ('Enlace', 0, 5.00, 1), ('Aliado', 10000, 10.00, 2), ('Socio', 30000, 12.50, 3), ('Socio Plus', 60000, 15.00, 4))
       as v(nombre, umbral, pct, orden)
 where niveles.organizacion_id = current_setting('tasa.org')::uuid and niveles.nombre = v.nombre;

update ajustes set
  contacto_soporte = 'soporte@xgplataform.com',
  dia_limite_pago_comision = 10,
  bienvenida_nivel_id = (select id from niveles where organizacion_id = current_setting('tasa.org')::uuid and nombre = 'Socio Plus'),
  bienvenida_meses = 3,
  arranque_nivel_id = (select id from niveles where organizacion_id = current_setting('tasa.org')::uuid and nombre = 'Aliado'),
  arranque_meses = 2,
  actualizado_en = now()
 where organizacion_id = current_setting('tasa.org')::uuid;

update organizaciones set prefijo_folio = 'MGP' where id = current_setting('tasa.org')::uuid;

-- Lo que ve quien todavía no entra a ninguna organización.
update ajustes_plataforma set contacto_soporte = 'soporte@xgplataform.com';

-- ------------------------------------------------------------
-- EQUIPO (Xchel además es super_plataforma). Nadie recibe correo: cada
-- quien entra con su correo y el código de 6 dígitos.
-- ------------------------------------------------------------
insert into personas (nombre, correo, organizacion_activa, super_plataforma)
values
  ('Mitzin Xchel Guerrero Solorio', 'xchel@arqosuv.com', current_setting('tasa.org')::uuid, true),
  ('Xchel (vista finanzas)', 'xchel+finanzas@arqosuv.com', current_setting('tasa.org')::uuid, false),
  ('Juana Gabriela Olvera Rangel', 'olveragabriela.mgp@gmail.com', current_setting('tasa.org')::uuid, false),
  ('Alexandro Soriano Gómez', 'asoriano.mgp@gmail.com', current_setting('tasa.org')::uuid, false),
  ('Mayte Uristegui Urrutia', 'muriostegui.mgp@gmail.com', current_setting('tasa.org')::uuid, false),
  ('Rodolfo Adame Gómez', 'radame.mgp@gmail.com', current_setting('tasa.org')::uuid, false),
  ('Cuauhtli Missael Guerrero Solorio', 'cguerrero.mgp@gmail.com', current_setting('tasa.org')::uuid, false),
  ('María Guadalupe Cervantes Núñez', 'gcervantes.mgp@gmail.com', current_setting('tasa.org')::uuid, false);

insert into membresias (persona_id, organizacion_id, rol)
select p.id, current_setting('tasa.org')::uuid, v.rol
  from (values
    ('xchel@arqosuv.com', 'admin_org'),
    ('xchel+finanzas@arqosuv.com', 'finanzas'),
    ('olveragabriela.mgp@gmail.com', 'finanzas'),
    ('asoriano.mgp@gmail.com', 'equipo'),
    ('muriostegui.mgp@gmail.com', 'equipo'),
    ('radame.mgp@gmail.com', 'equipo'),
    ('cguerrero.mgp@gmail.com', 'equipo'),
    ('gcervantes.mgp@gmail.com', 'equipo')
  ) as v(correo, rol)
  join personas p on lower(p.correo) = v.correo;

-- Si su usuario de acceso sobrevivió al reset, se amarra ya; si no, al entrar.
update personas p set user_id = u.id
  from auth.users u
 where lower(u.email) = lower(p.correo) and p.user_id is null
   and not exists (select 1 from personas o where o.user_id = u.id);

commit;
