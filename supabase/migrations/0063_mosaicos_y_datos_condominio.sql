-- ============================================================
-- 0063 — MAPA CATASTRAL: PERMISO Y LÍMITE DE MOSAICOS; DATOS DEL CONDOMINIO SOLO EQUIPO
--
-- 1. catastro_permiso_mosaico(): lo pregunta la ruta de mosaicos de líneas
--    de predios en cada petición, con la sesión del usuario.
--    · 'rol': no es admin_org, finanzas ni equipo (comisionista,
--      admin_marca o sin sesión) → 403.
--    · 'sin_herramienta': es del equipo pero el mapa no está encendido para
--      su rol → 403.
--    · 'limite': ya pidió 600 mosaicos en esta hora → 429.
--    · 'ok': se cuenta y se sirve.
--    El conteo vive en catastro_mosaicos (por persona y hora); se borra
--    solo a los dos días. Sin permisos directos para nadie.
-- 2. cacoct, vacopt, vatrct y vatrpt ("Dato del condominio 1-4"): solo
--    admin_org, finanzas y equipo, en pantalla y en PDF, aunque la
--    configuración se los abra a otro rol por error.
-- ============================================================

create table catastro_mosaicos (
  organizacion_id uuid not null references organizaciones(id) on delete cascade,
  persona_id      uuid not null references personas(id) on delete cascade,
  hora            timestamptz not null,
  cantidad        integer not null default 0,
  primary key (organizacion_id, persona_id, hora)
);
alter table catastro_mosaicos enable row level security;
revoke all on catastro_mosaicos from anon, authenticated;

create or replace function catastro_permiso_mosaico()
returns text language plpgsql security definer set search_path = public as $$
declare
  v_hora     timestamptz := date_trunc('hour', now());
  v_cantidad integer;
begin
  if mi_persona_id() is null or coalesce(mi_rol(), '') not in ('admin_org', 'finanzas', 'equipo') then
    return 'rol';
  end if;
  if not exists (select 1 from mis_herramientas() where clave = 'mapa_catastral') then
    return 'sin_herramienta';
  end if;
  insert into catastro_mosaicos as m (organizacion_id, persona_id, hora, cantidad)
  values (mi_org(), mi_persona_id(), v_hora, 1)
  on conflict (organizacion_id, persona_id, hora) do update set cantidad = m.cantidad + 1
  returning cantidad into v_cantidad;
  if v_cantidad = 1 then
    delete from catastro_mosaicos where hora < now() - interval '2 days';
  end if;
  return case when v_cantidad > 600 then 'limite' else 'ok' end;
end;
$$;

-- La ficha (pantalla o PDF): igual que en 0060, más los datos del condominio solo para el equipo.
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
    v_todo := v_todo - array['cacoct', 'vacopt', 'vatrct', 'vatrpt'];
  end if;
  select coalesce(jsonb_object_agg(t.key, t.value), '{}') into v_campos
    from jsonb_each(v_todo) t
   where t.value <> 'null'::jsonb
     and t.key in (select cv.campo from catastro_campos_visibles cv
                    where cv.organizacion_id = mi_org() and cv.rol = mi_rol()
                      and case when p_pdf then cv.en_pdf else cv.en_pantalla end);
  v_ficha := jsonb_build_object('clave', p.clave, 'municipio', p.municipio, 'geometria', p.geometria,
                                'latitud', p.latitud, 'longitud', p.longitud, 'consultado_en', p.consultado_en,
                                'expediente', p.expediente, 'campos', v_campos);
  if catastro_veo_privados() then
    select jsonb_build_object('propietarios', cp.propietarios, 'valor_operacion', cp.valor_operacion, 'escritura', cp.escritura,
                              'notario', cp.notario, 'numero_contrato', cp.numero_contrato, 'actualizado_en', cp.actualizado_en)
      into v_privados
      from catastro_propietarios cp where cp.organizacion_id = mi_org() and cp.clave = p.clave;
    v_ficha := v_ficha || jsonb_build_object('privados', v_privados,
      'historial', (select coalesce(jsonb_agg(jsonb_build_object('consultado_en', v.consultado_en, 'reemplazada_en', v.reemplazada_en,
                                                                  'cambios', v.cambios) order by v.reemplazada_en desc), '[]')
                      from catastro_versiones v where v.clave = p.clave));
  end if;
  return v_ficha;
end;
$$;

-- Y por omisión, apagados en la configuración de comisionista y admin_marca.
update catastro_campos_visibles set en_pantalla = false, en_pdf = false
 where rol in ('comisionista', 'admin_marca') and campo in ('cacoct', 'vacopt', 'vatrct', 'vatrpt');

revoke all on function catastro_permiso_mosaico(), catastro_ficha_para(text, boolean) from public, anon, authenticated;
grant execute on function catastro_permiso_mosaico() to authenticated;
