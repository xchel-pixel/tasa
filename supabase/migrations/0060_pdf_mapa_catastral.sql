-- ============================================================
-- 0060 — PDF DEL MAPA CATASTRAL
--
-- La ficha del predio en PDF, sin marca. Sale de la base, no del
-- navegador: catastro_pdf() regresa exactamente los campos que el rol
-- tiene marcados para PDF en catastro_campos_visibles (columna en_pdf).
-- Propietario y operación solo para admin_org, finanzas y equipo, aunque
-- la configuración se cambie por error.
--
-- · Herramienta 'mapa_catastral_pdf' en el catálogo: nace apagada como el
--   mapa, y en las organizaciones de hoy copia el estado del mapa (en XG,
--   encendida solo para admin_org). Solo sirve si además tienen el mapa.
--   Con ella, admin_org ajusta el cupo en Catálogos y la apaga aparte.
-- · Cupo al mes: Enlace 3, Aliado 8, Socio 20, Socio Plus y Élite sin
--   límite; equipo y administración sin límite. Bajar otra vez el PDF del
--   mismo predio en el mes no cuenta. Nunca consulta la fuente: sale de
--   lo guardado en Tasa.
-- · usos_herramienta.referencia: de qué predio fue el PDF.
-- ============================================================

alter table herramientas drop constraint herramientas_clave_check;
alter table herramientas add constraint herramientas_clave_check check (clave in (
  'mi_tarjeta', 'calculadora_traslado', 'calculadora_traslado_completa', 'para_tus_clientes', 'invitar', 'mapa_catastral',
  'mapa_catastral_pdf'));

create or replace function sembrar_herramientas(p_org uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into herramientas (organizacion_id, clave, nombre, activa, roles, niveles, en_menu, orden)
  values
    (p_org, 'mi_tarjeta', 'Mi tarjeta', true, array['comisionista'], null, true, 30),
    (p_org, 'para_tus_clientes', 'Para tus clientes', true,
     array['admin_org', 'finanzas', 'admin_marca', 'equipo', 'comisionista'], null, false, 32),
    (p_org, 'invitar', 'Invita a un comisionista', true,
     array['admin_org', 'finanzas', 'admin_marca', 'equipo', 'comisionista'], null, false, 34),
    (p_org, 'calculadora_traslado', 'Calculadora de traslado', false,
     array['admin_org', 'finanzas', 'admin_marca', 'equipo', 'comisionista'], null, true, 40),
    (p_org, 'calculadora_traslado_completa', 'Calculadora completa', false,
     array['admin_org', 'finanzas', 'admin_marca', 'equipo', 'comisionista'],
     coalesce((select array_agg(id order by orden) from niveles
                where organizacion_id = p_org and (es_forzado or nombre in ('Socio', 'Socio Plus'))), '{}'), false, 41),
    (p_org, 'mapa_catastral', 'Mapa catastral', false,
     array['admin_org', 'finanzas', 'admin_marca', 'equipo', 'comisionista'], null, true, 45),
    -- Apagada al nacer, como el mapa; solo sirve con el mapa encendido.
    (p_org, 'mapa_catastral_pdf', 'PDF del mapa catastral', false,
     array['admin_org', 'finanzas', 'admin_marca', 'equipo', 'comisionista'], null, false, 46)
  on conflict (organizacion_id, clave) do nothing;
end;
$$;
select sembrar_herramientas(id) from organizaciones;
-- En las organizaciones de hoy, el PDF queda como esté el mapa.
update herramientas pdf set activa = m.activa, roles = m.roles, niveles = m.niveles
  from herramientas m
 where pdf.clave = 'mapa_catastral_pdf' and m.clave = 'mapa_catastral' and m.organizacion_id = pdf.organizacion_id;

create or replace function sembrar_cupos(p_org uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into cupos_herramienta (organizacion_id, herramienta, nivel_id, cantidad)
  select p_org, c.herramienta, n.id, c.cantidad
    from niveles n
    join (values ('calculadora_traslado', 'Enlace', 15), ('calculadora_traslado', 'Aliado', 30), ('calculadora_traslado', 'Socio', 60),
                 ('calculadora_traslado', 'Socio Plus', null), ('calculadora_traslado_completa', 'Enlace', 2),
                 ('calculadora_traslado_completa', 'Aliado', 5), ('calculadora_traslado_completa', 'Socio', 15),
                 ('calculadora_traslado_completa', 'Socio Plus', null),
                 ('mapa_catastral', 'Enlace', 20), ('mapa_catastral', 'Aliado', 40), ('mapa_catastral', 'Socio', 80),
                 ('mapa_catastral', 'Socio Plus', null),
                 ('mapa_catastral_pdf', 'Enlace', 3), ('mapa_catastral_pdf', 'Aliado', 8), ('mapa_catastral_pdf', 'Socio', 20),
                 ('mapa_catastral_pdf', 'Socio Plus', null)) as c(herramienta, nivel, cantidad)
      on c.nivel = n.nombre
   where n.organizacion_id = p_org
  union all
  select p_org, h, n.id, null from niveles n,
         unnest(array['calculadora_traslado', 'calculadora_traslado_completa', 'mapa_catastral', 'mapa_catastral_pdf']) h
   where n.organizacion_id = p_org and n.es_forzado
  on conflict (organizacion_id, herramienta, nivel_id) do nothing;
end;
$$;
select sembrar_cupos(id) from organizaciones;

alter table usos_herramienta add column referencia text check (referencia is null or char_length(referencia) <= 40);

-- ------------------------------------------------------------
-- La ficha filtrada por rol, para pantalla o para PDF
-- ------------------------------------------------------------

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
  select coalesce(jsonb_object_agg(t.key, t.value), '{}') into v_campos
    from jsonb_each(v_todo) t
   where t.value <> 'null'::jsonb
     and t.key in (select cv.campo from catastro_campos_visibles cv
                    where cv.organizacion_id = mi_org() and cv.rol = mi_rol()
                      and case when p_pdf then cv.en_pdf else cv.en_pantalla end);
  v_ficha := jsonb_build_object('clave', p.clave, 'municipio', p.municipio, 'geometria', p.geometria,
                                'latitud', p.latitud, 'longitud', p.longitud, 'consultado_en', p.consultado_en,
                                'expediente', p.expediente, 'campos', v_campos);
  -- Propietario y operación: por el rol, nunca por la configuración.
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

create or replace function catastro_ficha(p_clave text)
returns jsonb language sql stable security definer set search_path = public as $$
  select catastro_ficha_para(p_clave, false);
$$;

-- El PDF: la ficha con los campos de PDF del rol. Cuenta en el cupo la primera vez en el mes por predio.
create or replace function catastro_pdf(p_clave text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_ficha jsonb;
  c       record;
begin
  if not exists (select 1 from mis_herramientas() where clave = 'mapa_catastral_pdf') then
    raise exception 'El PDF del mapa catastral no está disponible para ti';
  end if;
  v_ficha := catastro_ficha_para(p_clave, true);
  if v_ficha is null then
    raise exception 'Ese predio no está guardado en Tasa; consúltalo primero en el mapa';
  end if;
  if not exists (select 1 from usos_herramienta u where u.organizacion_id = mi_org() and u.persona_id = mi_persona_id()
                   and u.herramienta = 'mapa_catastral_pdf' and u.referencia = p_clave and mes_mx(u.creado_en) = mes_mx(now())) then
    select * into c from mi_cupo('mapa_catastral_pdf');
    if c.disponibles is not null and c.disponibles <= 0 then
      raise exception 'Llegaste a tu límite de PDF del mes. Sube de nivel o pide más.';
    end if;
    insert into usos_herramienta (organizacion_id, persona_id, herramienta, modo, referencia)
    values (mi_org(), mi_persona_id(), 'mapa_catastral_pdf', 'pdf', p_clave);
  end if;
  return v_ficha;
end;
$$;

revoke all on function catastro_ficha_para(text, boolean), catastro_ficha(text), catastro_pdf(text), sembrar_herramientas(uuid), sembrar_cupos(uuid)
  from public, anon, authenticated;
grant execute on function catastro_ficha(text), catastro_pdf(text) to authenticated;
