-- ============================================================
-- 0061 — MAPA CATASTRAL: VISIBILIDAD NUEVA DEL COMISIONISTA
--
-- · Campo nuevo `valor_catastral_total` (terreno + construcción), para
--   la ficha, el PDF y el prellenado de la calculadora de traslado.
-- · Lo que ve por omisión el comisionista (y admin_marca), en pantalla y
--   en PDF: dirección, superficie de terreno, construcción total, valores
--   catastrales de terreno, construcción y total, medidas y
--   colindancias; en condominio, privativas, comunes e indiviso. Además
--   el área del polígono del mapa, que es lo único que se muestra cuando
--   el expediente no llega. La clave, el municipio y el polígono siempre
--   se ven. Propietario y operación, nunca (eso no es configuración).
-- · En las organizaciones de hoy se reescribe la configuración de
--   comisionista y admin_marca (todavía no hay pantalla para editarla).
-- ============================================================

create or replace function catastro_campos()
returns text[] language sql immutable set search_path = public as $$
  select array[
    -- columnas
    'colonia', 'codigo_postal', 'ubicacion', 'sup_terreno', 'sup_construccion',
    -- ubicación desglosada y datos generales
    'calle', 'num_ext', 'num_int', 'localidad', 'manzana', 'tipo_predio', 'estatus', 'clasificacion', 'uso',
    'clave_anterior', 'clave_estandar', 'clave_original', 'folio_real', 'fecha_alta', 'fecha_mantenimiento',
    'movimientos', 'superficie', 'tipos_construccion', 'series_valor',
    -- valores catastrales
    'codigo_valor', 'fecha_validez', 'valor_terreno', 'valor_construccion', 'valor_catastral_total',
    'valor_terreno_anterior', 'valor_construccion_anterior',
    -- condominio
    'regimen', 'tipo_condominio', 'nombre_condominio', 'indiviso',
    'sup_terreno_privativa', 'sup_terreno_comun', 'sup_construccion_privativa', 'sup_construccion_comun',
    'valor_terreno_privativo', 'valor_terreno_comun', 'valor_construccion_privativa', 'valor_construccion_comun',
    'cacoct', 'vacopt', 'vatrct', 'vatrpt',
    -- Registro Público (sin propietarios)
    'rppc_folio_real', 'rppc_tipo', 'rppc_estatus', 'rppc_area_terreno', 'rppc_ubicacion', 'rppc_lote',
    'rppc_nom_col_bar_otro', 'rppc_medidas', 'rppc_medid_colind',
    -- capa del mapa (GetFeatureInfo)
    'capa_folio', 'capa_no_oficial', 'capa_localidad', 'capa_curt', 'capa_area', 'capa_perimetro', 'capa_coor_x', 'capa_coor_y'
  ]::text[];
$$;

create or replace function catastro_campos_basicos()
returns text[] language sql immutable set search_path = public as $$
  select array['ubicacion', 'sup_terreno', 'sup_construccion', 'valor_terreno', 'valor_construccion', 'valor_catastral_total',
               'rppc_medid_colind', 'sup_terreno_privativa', 'sup_terreno_comun', 'sup_construccion_privativa', 'sup_construccion_comun',
               'indiviso', 'capa_area']::text[];
$$;

-- El campo nuevo para cada rol de las organizaciones de hoy (staff: todo; los demás según lo básico)…
select sembrar_campos_catastro(id) from organizaciones;
-- …y la configuración nueva de comisionista y admin_marca, en pantalla y en PDF.
update catastro_campos_visibles
   set en_pantalla = campo = any (catastro_campos_basicos()),
       en_pdf      = campo = any (catastro_campos_basicos())
 where rol in ('comisionista', 'admin_marca');

revoke all on function catastro_campos(), catastro_campos_basicos() from public, anon;
grant execute on function catastro_campos(), catastro_campos_basicos() to authenticated;
