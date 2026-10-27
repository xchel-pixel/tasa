-- ============================================================
-- 0008 — CATÁLOGOS INICIALES
-- Datos reales con los que arranca Tasa (no son de prueba).
-- Las CLABEs son PLACEHOLDER: se corrigen desde el catálogo de
-- cuentas antes de emitir la primera cotización.
-- ============================================================

insert into marcas (clave, nombre) values
  ('MGP',   'MGP'),
  ('AP73',  'AP73'),
  ('ARQOS', 'Arqos'),
  ('XG',    'Xchel Guerrero');   -- trabajos personales de Xchel

-- ROMI no es marca: es la titular de la cuenta que recibe por MGP.
-- Arqos no tiene cuenta todavía.
insert into cuentas_receptoras (titular, banco, clabe, marca_id)
select v.titular, v.banco, v.clabe, m.id
  from (values
    ('ROMI',           null,         '000000000000000001', 'MGP'),
    ('AP73',           'Banregio',   '000000000000000002', 'AP73'),
    ('Xchel Guerrero', 'Scotiabank', '000000000000000003', 'XG')
  ) as v (titular, banco, clabe, marca)
  join marcas m on m.clave = v.marca;

-- Cada marca sugiere la cuenta que tiene ligada.
update marcas m
   set cuenta_sugerida_id = c.id
  from cuentas_receptoras c
 where c.marca_id = m.id;

-- Los nombres coinciden con "Tipo de Trámite" en Notion.
insert into servicios (nombre, orden) values
  ('Avalúo Comercial', 1),
  ('Avalúo Hacendario', 2),
  ('Valor Hacendario', 3),
  ('Opinión de Valor', 4),
  ('Avalúo Bancario', 5),
  ('Avalúo Condominal y Mem Desc', 6),
  ('Peritaje para el Poder Judicial', 7),
  ('Topografía', 8),
  ('Deslinde Catastral', 9),
  ('Otros', 10);

insert into niveles (nombre, orden, umbral_minimo, porcentaje, es_forzado) values
  ('Enlace',     1,     0,  5.00, false),
  ('Aliado',     2, 10000, 10.00, false),
  ('Socio',      3, 30000, 12.50, false),
  ('Socio Plus', 4, 60000, 15.00, false),
  ('Élite',      5,  null,  null, true);

-- "Etapa" de Notion → estatus público. "Cancelado" no se mapea a
-- propósito: cancelar se hace en Tasa, que es quien sabe si hay que
-- borrar la comisión o meter un cargo. "Visita agendada" no existe
-- como etapa en Notion; sale de la "Fecha de visita" (lo resuelve el
-- adaptador de Notion, no esta tabla).
insert into mapeo_estatus (etapa_notion, estatus_publico) values
  ('Por asignar',          'aceptada'),
  ('En espera de cliente', 'aceptada'),
  ('En proceso',           'en_elaboracion'),
  ('En revisión',          'en_revision'),
  ('Listo para entregar',  'en_revision'),
  ('Entregado',            'entregado'),
  ('Cerrado',              'entregado');
