-- ============================================================
-- 0020 — EL CRON Y EL CONECTOR NOTION
--
-- `/api/cron` (cada 15 min, con la llave secreta de Supabase) hace por
-- cada conector externo activo:
--   1. crear en el sistema externo los trámites aceptados que aún no
--      tienen registro (`reclamar_por_crear` + `registrar_registro_externo`);
--   2. leer lo que cambió afuera (`registrar_lectura`, 0018);
--   3. dejar el conector en "activo" o en "error" con su alerta.
--
-- Solo se crean registros de lo aceptado DESPUÉS de activar el conector:
-- encender Notion no sube de golpe los trabajos que ya existían (los de
-- prueba, por ejemplo).
--
-- El cron lo programa pg_cron + pg_net; el secreto vive en Vault
-- ("cron_secret"), no en este archivo. En las pruebas locales esas
-- extensiones no existen y esta parte se salta.
-- ============================================================

-- ------------------------------------------------------------
-- 1. CUÁNDO SE ACTIVÓ Y QUÉ ESTÁ EN CAMINO
-- ------------------------------------------------------------

alter table conectores add column activado_en timestamptz;
update conectores set activado_en = now() where activo;

-- Un trámite "reclamado" lo está creando una corrida del cron. Si esa
-- corrida falla, a los 10 minutos otra lo vuelve a intentar; nunca dos
-- a la vez (así no nacen páginas duplicadas).
alter table solicitudes add column externo_reclamado_en timestamptz;

create or replace function activar_conector(p_tipo text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := mi_org();
  v_id  uuid;
begin
  if not soy_admin_org() then
    raise exception 'Solo admin_org cambia el conector';
  end if;
  if p_tipo not in ('manual', 'notion', 'sheets', 'webhook') then
    raise exception 'Tipo de conector no válido';
  end if;
  select id into v_id from conectores where organizacion_id = v_org and tipo = p_tipo;
  update conectores set activo = false where organizacion_id = v_org and activo and id is distinct from v_id;
  if v_id is null then
    insert into conectores (organizacion_id, tipo, activado_en) values (v_org, p_tipo, now()) returning id into v_id;
  else
    update conectores set activo = true, activado_en = now(), estado = 'activo' where id = v_id and not activo;
  end if;
  return v_id;
end;
$$;

-- ------------------------------------------------------------
-- 2. LO QUE EL CRON NECESITA
-- ------------------------------------------------------------

-- Los conectores que el cron debe correr: externos, activos y con
-- credencial guardada.
create or replace function conectores_para_sincronizar()
returns table (id uuid, organizacion_id uuid, tipo text, configuracion jsonb, mapeo_campos jsonb,
               ultimo_sync timestamptz, prefijo_folio text)
language sql stable security definer set search_path = public as $$
  select k.id, k.organizacion_id, k.tipo, k.configuracion, k.mapeo_campos, k.ultimo_sync, o.prefijo_folio
    from conectores k join organizaciones o on o.id = k.organizacion_id and o.activa
   where k.activo and k.tipo <> 'manual' and k.credencial_id is not null;
$$;

-- Uno solo, aunque no esté activo: "Probar conexión" antes de activar.
create or replace function conector_para_probar(p_conector uuid)
returns table (id uuid, organizacion_id uuid, tipo text, configuracion jsonb, mapeo_campos jsonb,
               ultimo_sync timestamptz, prefijo_folio text)
language sql stable security definer set search_path = public as $$
  select k.id, k.organizacion_id, k.tipo, k.configuracion, k.mapeo_campos, k.ultimo_sync, o.prefijo_folio
    from conectores k join organizaciones o on o.id = k.organizacion_id
   where k.id = p_conector and k.tipo <> 'manual' and k.credencial_id is not null;
$$;

-- Reclama hasta `p_limite` trámites por crear afuera y regresa lo que
-- hace falta para crear el registro. Solo los aceptados después de
-- activar el conector.
create or replace function reclamar_por_crear(p_conector uuid, p_limite integer default 20)
returns table (
  solicitud_id uuid, cliente_nombre text, cliente_telefono text, cliente_correo text, servicio text,
  inmueble_direccion text, inmueble_municipio text, inmueble_clave_catastral text, inmueble_descripcion text,
  requiere_factura boolean, monto_honorarios numeric, monto_terceros numeric, aceptada_en timestamptz,
  comisionista text, marca text
) language plpgsql security definer set search_path = public as $$
declare
  k conectores%rowtype;
begin
  if not puede_operar_conector(p_conector) then
    raise exception 'Solo admin_org sincroniza el conector';
  end if;
  select * into k from conectores where id = p_conector;

  return query
  with elegidos as (
    select s.id from solicitudes s
     where s.organizacion_id = k.organizacion_id
       and s.estado = 'tramite' and s.externo_id is null
       and s.aceptada_en >= coalesce(k.activado_en, now())
       and (s.externo_reclamado_en is null or s.externo_reclamado_en < now() - interval '10 minutes')
     order by s.aceptada_en
     limit p_limite
     for update skip locked
  ), marcados as (
    update solicitudes s set externo_reclamado_en = now()
      from elegidos e where s.id = e.id
    returning s.*
  )
  select m.id, m.cliente_nombre, m.cliente_telefono, m.cliente_correo, sv.nombre,
         m.inmueble_direccion, m.inmueble_municipio, m.inmueble_clave_catastral, m.inmueble_descripcion,
         m.requiere_factura, m.monto_honorarios, m.monto_terceros, m.aceptada_en,
         p.nombre, mc.nombre
    from marcados m
    join servicios sv on sv.id = m.servicio_id
    join personas p on p.id = m.comisionista_id
    left join marcas mc on mc.id = m.marca_id;
end;
$$;

-- Si crear afuera falló, el trámite se libera para el siguiente intento.
create or replace function liberar_por_crear(p_conector uuid, p_solicitud uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not puede_operar_conector(p_conector) then
    raise exception 'Solo admin_org sincroniza el conector';
  end if;
  update solicitudes s set externo_reclamado_en = null
    from conectores k
   where k.id = p_conector and s.id = p_solicitud and s.organizacion_id = k.organizacion_id;
end;
$$;

-- Vencer cotizaciones también corre en el cron.
-- (vencer_cotizaciones ya es de service_role desde 0010.)

revoke all on function conectores_para_sincronizar(), conector_para_probar(uuid), reclamar_por_crear(uuid, integer),
  liberar_por_crear(uuid, uuid) from public, anon, authenticated;
grant execute on function conectores_para_sincronizar(), conector_para_probar(uuid), reclamar_por_crear(uuid, integer),
  liberar_por_crear(uuid, uuid) to service_role;
grant execute on function vencer_cotizaciones() to service_role;

-- ------------------------------------------------------------
-- 3. EL CONECTOR NOTION DE XG, CON LOS NOMBRES REALES
-- ------------------------------------------------------------
-- La base 📝 Trámites (MGP / ÁREA TÉCNICA). El título se llama
-- "Projects". "Honorario" no se toca: es el costo interno de AP73.

update conectores
   set configuracion = jsonb_build_object(
         'base_de_datos', 'b322ff3b-dadb-4934-9595-3f95c781bc72',
         'valor_cancelado', 'Cancelado',
         'etapa_inicial', 'Por asignar',
         'clasificacion', 'Trámite',
         'medio', 'Tasa'),
       mapeo_campos = jsonb_build_object(
         'titulo', 'Projects',
         'etapa', 'Etapa',
         'fecha_visita', 'Fecha de visita',
         'tipo_tramite', 'Tipo de Trámite',
         'clasificacion', 'Clasificación',
         'medio', 'Medio de solicitud',
         'fecha_aceptacion', 'Fecha de aceptación',
         'requiere_factura', 'Requiere factura',
         'solicitado_por', 'Solicitado por',
         'clave_catastral', 'Clave Catastral',
         'descripcion', 'Descripción',
         'contacto_nombre', 'Nombre Contacto',
         'contacto_telefono', '# Contacto',
         'contacto_correo', 'Correro Contacto',
         'cotizacion', 'Cotización')
 where id = 'a0000000-0000-4000-8000-0000000000c2';

-- ------------------------------------------------------------
-- 4. PG_CRON: CADA 15 MINUTOS A /api/cron
-- ------------------------------------------------------------

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron')
     and exists (select 1 from pg_available_extensions where name = 'pg_net') then
    execute 'create extension if not exists pg_cron';
    execute 'create extension if not exists pg_net with schema extensions';
    execute $sql$
      select cron.schedule(
        'tasa-conectores',
        '*/15 * * * *',
        $job$
          select net.http_post(
            url := 'https://tasa.xgplataform.com/api/cron',
            headers := jsonb_build_object(
              'Content-Type', 'application/json',
              'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')),
            body := '{}'::jsonb,
            timeout_milliseconds := 55000)
        $job$)
    $sql$;
  end if;
end;
$$;
