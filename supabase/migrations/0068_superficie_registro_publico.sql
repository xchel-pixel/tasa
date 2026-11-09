-- ============================================================
-- 0068 — SUPERFICIE DEL REGISTRO PÚBLICO, SOLO PARA EL EQUIPO
--
-- La ficha muestra tres superficies: la de catastro (sup_terreno), la del
-- polígono (la calcula Tasa de la geometría) y la del Registro Público
-- (rppc_area_terreno). Esta última es solo para admin_org, finanzas y
-- equipo: la base no se la manda a otros roles aunque la configuración la
-- abra por error, igual que los datos del condominio (0063). Vale para la
-- pantalla y el PDF (los dos salen de catastro_ficha_para).
-- ============================================================

-- 0067 sin otro cambio.
create or replace function catastro_ficha_para(p_clave text, p_pdf boolean)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  p          catastro_predios;
  v_todo     jsonb;
  v_campos   jsonb;
  v_ficha    jsonb;
  v_privados jsonb;
begin
  if not exists (select 1 from mis_herramientas() where clave = 'mapa_catastral') then
    raise exception 'El mapa catastral no está disponible para ti';
  end if;
  p := catastro_predio_visible(p_clave);
  if p.clave is null then
    return null;
  end if;
  v_todo := jsonb_build_object('colonia', p.colonia, 'codigo_postal', p.codigo_postal, 'ubicacion', p.ubicacion,
                               'sup_terreno', p.sup_terreno, 'sup_construccion', p.sup_construccion) || p.extra;
  -- Por el rol, nunca por la configuración.
  if not catastro_veo_privados() then
    v_todo := v_todo - array['cacoct', 'vacopt', 'vatrct', 'vatrpt', 'rppc_area_terreno'];
  end if;
  select coalesce(jsonb_object_agg(t.key, t.value), '{}') into v_campos
    from jsonb_each(v_todo) t
   where t.value <> 'null'::jsonb
     and t.key in (select cv.campo from catastro_campos_visibles cv
                    where cv.organizacion_id = mi_org() and cv.rol = mi_rol()
                      and case when p_pdf then cv.en_pdf else cv.en_pantalla end);
  v_ficha := jsonb_build_object('clave', p.clave, 'municipio', p.municipio, 'geometria', p.geometria, 'geometria_utm', p.geometria_utm,
                                'latitud', p.latitud, 'longitud', p.longitud, 'consultado_en', p.consultado_en,
                                'expediente', p.expediente, 'campos', v_campos);
  if catastro_veo_privados() then
    select jsonb_build_object('propietarios', cp.propietarios, 'valor_operacion', cp.valor_operacion, 'escritura', cp.escritura,
                              'notario', cp.notario, 'numero_contrato', cp.numero_contrato, 'actualizado_en', cp.actualizado_en)
      into v_privados
      from catastro_propietarios cp where cp.organizacion_id = mi_org() and cp.clave = p.clave;
    v_ficha := v_ficha || jsonb_build_object('privados', v_privados,
      'historial', (select coalesce(jsonb_agg(jsonb_build_object('consultado_en', v.consultado_en, 'reemplazada_en', v.reemplazada_en,
                                                                  'cambios', v.cambios, 'tipo', v.tipo) order by v.reemplazada_en desc), '[]')
                      from catastro_versiones v where v.clave = p.clave));
  end if;
  return v_ficha;
end;
$$;
revoke all on function catastro_ficha_para(text, boolean) from public, anon, authenticated;
