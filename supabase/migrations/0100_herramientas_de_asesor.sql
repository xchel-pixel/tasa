-- ============================================================
-- 0100 — FICHA DE CAPTACIÓN Y CHECKLIST DE DOCUMENTOS (fase 2)
--
-- 1. Dos herramientas nuevas del catálogo: ficha_captacion y
--    checklist_documentos (grupo Comercialización). Como todo el catálogo
--    (0053): por rol y, para comisionistas, por nivel. Encendidas en XG y
--    DEMO para todos los roles (admin_org las limita por nivel en
--    Configuración); en las demás organizaciones nacen apagadas.
--    Contrato y acta (fase 3) quedan ya en la lista de claves válidas.
-- 2. Su uso en eventos_uso (abrir y PDF), con registrar_uso_herramienta().
-- 3. Tres servicios nuevos en XG, para el botón "Solicitar a MGP" de los
--    consejos: Certificado de libertad de gravamen, Justipreciación de
--    rentas y Régimen en condominio, con su nombre en Notion.
-- 4. ajustes.checklist_revisado: la fecha en que se revisaron los
--    requisitos del checklist. La herramienta la muestra; a los 90 días sin
--    actualizar, Hoy avisa a admin_org.
-- ============================================================

alter table herramientas drop constraint herramientas_clave_check;
alter table herramientas add constraint herramientas_clave_check check (clave in (
  'mi_tarjeta', 'calculadora_traslado', 'calculadora_traslado_completa', 'para_tus_clientes', 'invitar', 'mapa_catastral',
  'mapa_catastral_pdf', 'agenda', 'ficha_captacion', 'checklist_documentos', 'contrato_arrendamiento', 'acta_entrega'));

create or replace function sembrar_herramientas_de_asesor(p_org uuid)
returns void language sql security definer set search_path = public as $$
  insert into herramientas (organizacion_id, clave, nombre, activa, roles, niveles, en_menu, orden)
  values (p_org, 'ficha_captacion', 'Ficha de captación', false, array['admin_org', 'finanzas', 'equipo', 'comisionista'], null, false, 50),
         (p_org, 'checklist_documentos', 'Checklist de documentos', false, array['admin_org', 'finanzas', 'equipo', 'comisionista'], null, false, 51)
  on conflict (organizacion_id, clave) do nothing;
$$;
revoke all on function sembrar_herramientas_de_asesor(uuid) from public, anon, authenticated;
select sembrar_herramientas_de_asesor(id) from organizaciones;

create or replace function sembrar_herramientas_de_asesor_al_crear()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform sembrar_herramientas_de_asesor(new.id);
  return null;
end;
$$;
create trigger sembrar_herramientas_de_asesor_al_crear after insert on organizaciones
  for each row execute function sembrar_herramientas_de_asesor_al_crear();
revoke all on function sembrar_herramientas_de_asesor_al_crear() from public, anon, authenticated;

update herramientas set activa = true
 where clave in ('ficha_captacion', 'checklist_documentos')
   and organizacion_id in (select id from organizaciones where nombre = 'XG' or demo);

-- El uso: abrir y bajar el PDF.
alter table eventos_uso drop constraint eventos_uso_herramienta_check;
alter table eventos_uso add constraint eventos_uso_herramienta_check
  check (herramienta in ('mapa_catastral', 'mapa_catastral_pdf', 'mapa_catastral_dxf', 'mapa_catastral_mosaicos', 'mapa_catastral_zona',
                         'calculadora_traslado', 'calculadora_traslado_completa', 'acceso',
                         'ficha_captacion', 'checklist_documentos', 'contrato_arrendamiento', 'acta_entrega'));

-- La persona registra su propio uso, solo de una herramienta que tiene. Nada del contenido: solo qué y cuándo.
create or replace function registrar_uso_herramienta(p_clave text, p_evento text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_evento not in ('acceso', 'pdf')
     or p_clave not in ('ficha_captacion', 'checklist_documentos', 'contrato_arrendamiento', 'acta_entrega')
     or not exists (select 1 from mis_herramientas() h where h.clave = p_clave) then
    return;
  end if;
  perform registrar_evento(mi_org(), mi_persona_id(), p_clave, p_evento, null, null, 'ok', null, null, p_evento = 'pdf');
end;
$$;
revoke all on function registrar_uso_herramienta(text, text) from public, anon, authenticated;
grant execute on function registrar_uso_herramienta(text, text) to authenticated;

-- Servicios nuevos de XG (los textos los aprobó Xchel el 27-nov-2026; el nombre en Notion es la opción de "Tipo de Trámite").
insert into servicios (organizacion_id, nombre, orden, activo, alcance, tiempo_entrega, documentos, nombre_notion)
select o.id, v.nombre, (select coalesce(max(s.orden), 0) from servicios s where s.organizacion_id = o.id) + v.n, true,
       v.alcance, v.entrega, v.documentos, v.notion
  from organizaciones o,
       (values
         (1, 'Certificado de libertad de gravamen',
          'Gestión del certificado de libertad o de existencia de gravámenes del inmueble ante el Registro Público de la Propiedad de Querétaro y entrega del certificado.',
          '3 a 7 días hábiles a partir del pago de derechos y de contar con el folio real.',
          E'Folio real o datos de inscripción de la escritura.\nClave catastral y ubicación del inmueble.\nPago de derechos del Registro Público.',
          'Certificado de Libertad de Gravamen'),
         (2, 'Justipreciación de rentas',
          'Estudio de mercado de rentas comparables y dictamen del monto de renta mensual justo del inmueble.',
          '5 días hábiles a partir de recibir el anticipo, la información completa y la visita.',
          E'Ubicación del inmueble y, de preferencia, clave catastral.\nSuperficies de terreno y construcción.\nUso del inmueble (habitacional, comercial u otro).',
          'Justipreciación de Rentas'),
         (3, 'Régimen en condominio',
          'Planos de matematización, memoria descriptiva, tabla de indivisos y plantilla para el Registro Público para constituir el régimen en condominio.',
          'Se cotiza por proyecto, según el número de unidades.',
          E'Escritura del inmueble.\nPlanos arquitectónicos o licencias.\nClave catastral.\nNúmero de unidades del condominio.',
          'Régimen en Condominio')
       ) as v(n, nombre, alcance, entrega, documentos, notion)
 where o.nombre = 'XG'
on conflict do nothing;

-- Fecha de revisión de requisitos del checklist.
alter table ajustes add column checklist_revisado date not null default date '2026-11-27';

create or replace function guardar_checklist_revisado(p_fecha date)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not soy_admin_org() then
    raise exception 'Solo admin_org';
  end if;
  if p_fecha is null or p_fecha > (now() at time zone 'America/Mexico_City')::date or p_fecha < date '2026-01-01' then
    raise exception 'La fecha de revisión no puede ser futura';
  end if;
  perform set_config('tasa.motivo', 'Requisitos del checklist revisados', true);
  update ajustes set checklist_revisado = p_fecha where organizacion_id = mi_org();
  perform set_config('tasa.motivo', '', true);
end;
$$;
revoke all on function guardar_checklist_revisado(date) from public, anon, authenticated;
grant execute on function guardar_checklist_revisado(date) to authenticated;
