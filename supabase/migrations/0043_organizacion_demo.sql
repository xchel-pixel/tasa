-- ============================================================
-- 0043 — ORGANIZACIÓN DE DEMOSTRACIÓN
--
-- `organizaciones.demo` marca una organización con datos sintéticos
-- (DEMO), que existe para que la prueba de humo recorra las pantallas
-- con datos. Nada de ella sale de Tasa:
--   · Notion y otros conectores: no se activan ni se sincronizan.
--   · Cron: no le vence cotizaciones ni le limpia solicitudes de alta.
--   · Correos: la aplicación pregunta `organizacion_es_demo` antes de
--     mandar y no manda (lib/correo.ts).
-- Como toda organización, sus datos solo los ven sus miembros (RLS);
-- en Plataforma solo la ve super_plataforma.
--
-- Los datos se crean y se regeneran con supabase/produccion/demo.sql
-- (npm run demo), que solo toca filas de la organización DEMO.
-- ============================================================

alter table organizaciones add column demo boolean not null default false;

create or replace function organizacion_es_demo(p_slug text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select demo from organizaciones where slug = lower(trim(p_slug))), false);
$$;
revoke all on function organizacion_es_demo(text) from public, anon;
grant execute on function organizacion_es_demo(text) to authenticated, service_role;

create or replace function conectores_para_sincronizar()
returns table (id uuid, organizacion_id uuid, tipo text, configuracion jsonb, mapeo_campos jsonb,
               ultimo_sync timestamptz, prefijo_folio text)
language sql stable security definer set search_path = public as $$
  select k.id, k.organizacion_id, k.tipo, k.configuracion, k.mapeo_campos, k.ultimo_sync, o.prefijo_folio
    from conectores k join organizaciones o on o.id = k.organizacion_id and o.activa and not o.demo
   where k.activo and k.tipo <> 'manual' and k.credencial_id is not null;
$$;

create or replace function conector_para_probar(p_conector uuid)
returns table (id uuid, organizacion_id uuid, tipo text, configuracion jsonb, mapeo_campos jsonb,
               ultimo_sync timestamptz, prefijo_folio text)
language sql stable security definer set search_path = public as $$
  select k.id, k.organizacion_id, k.tipo, k.configuracion, k.mapeo_campos, k.ultimo_sync, o.prefijo_folio
    from conectores k join organizaciones o on o.id = k.organizacion_id and not o.demo
   where k.id = p_conector and k.tipo <> 'manual' and k.credencial_id is not null;
$$;

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
  if p_tipo <> 'manual' and (select demo from organizaciones where id = v_org) then
    raise exception 'La organización de demostración no se conecta a sistemas externos';
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

create or replace function vencer_cotizaciones()
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_total integer;
begin
  with vencidas as (
    update cotizaciones
       set estado = 'vencida', respondida_en = now()
     where estado = 'emitida' and vigente_hasta < hoy_mx()
       and organizacion_id not in (select id from organizaciones where demo)
    returning solicitud_id
  )
  update solicitudes s
     set estado = 'vencida', estatus_publico = 'vencida'
    from vencidas v
   where s.id = v.solicitud_id and s.estado = 'cotizada';

  get diagnostics v_total = row_count;
  return v_total;
end;
$$;

create or replace function csf_por_limpiar(p_espera interval default interval '1 day')
returns table (tipo text, ref uuid, ruta text)
language sql stable security definer set search_path = public as $$
  with en_uso as (
    select csf_ruta as ruta from comisionistas where csf_ruta is not null
    union
    select csf_ruta from solicitudes_alta where csf_ruta is not null and estado in ('pendiente', 'aprobada')
  ), demo as (
    select id from organizaciones where demo
  )
  select 'rechazada', s.id, s.csf_ruta from solicitudes_alta s
   where s.estado = 'rechazada' and s.csf_ruta is not null and s.decidida_en <= now() - interval '90 days'
     and s.csf_ruta not in (select ruta from en_uso)
     and s.organizacion_id not in (select id from demo)
  union all
  select 'reemplazada', r.id, r.ruta from csf_reemplazadas r
   where r.borrada_en is null and r.reemplazada_en <= now() - interval '30 days'
     and r.ruta not in (select csf_ruta from comisionistas where csf_ruta is not null)
  union all
  select 'abandonada', s.id, s.organizacion_id || '/' || s.id || '/csf.pdf' from solicitudes_alta s
   where s.estado = 'subiendo' and s.creada_en < now() - interval '1 day'
     and s.organizacion_id not in (select id from demo)
  union all
  select 'huerfana', null, o.name from storage.objects o
   where o.bucket_id = 'altas' and o.created_at < now() - greatest(p_espera, interval '1 hour')
     and o.name not in (select ruta from en_uso)
     and not exists (select 1 from solicitudes_alta s where s.csf_ruta = o.name or o.name = s.organizacion_id || '/' || s.id || '/csf.pdf')
     and not exists (select 1 from csf_reemplazadas r where r.ruta = o.name and r.borrada_en is null);
$$;

-- ------------------------------------------------------------
-- Regenerar DEMO. Los candados de cierres y meses cerrados se abren
-- SOLO para borrar filas de una organización demo y SOLO si el script
-- lo pide en su transacción (`tasa.regenerar_demo = 'si'`). Para
-- cualquier otra organización, o sin esa marca, siguen como siempre.
-- ------------------------------------------------------------

create or replace function regenerando_demo(p_org uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(current_setting('tasa.regenerar_demo', true), '') = 'si'
     and exists (select 1 from organizaciones where id = p_org and demo);
$$;
revoke all on function regenerando_demo(uuid) from public, anon, authenticated;

create or replace function proteger_cierre()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    if old.estado = 'aprobado' and not regenerando_demo(old.organizacion_id) then
      raise exception 'El cierre de % está aprobado: no se borra', to_char(old.mes, 'YYYY-MM');
    end if;
    return old;
  end if;

  if old.estado = 'aprobado' then
    raise exception 'El cierre de % está aprobado: no se reabre ni se modifica', to_char(old.mes, 'YYYY-MM');
  end if;
  return new;
end;
$$;

create or replace function proteger_mes_cerrado()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if mes_aprobado(new.organizacion_id, new.mes) then
      raise exception 'El mes % ya está cerrado: va en %',
        to_char(new.mes, 'YYYY-MM'), to_char(mes_abierto_desde(new.organizacion_id, new.mes), 'YYYY-MM');
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    if mes_aprobado(old.organizacion_id, old.mes) and not regenerando_demo(old.organizacion_id) then
      raise exception 'El mes % ya está cerrado: esto no se borra; registra un cargo',
        to_char(old.mes, 'YYYY-MM');
    end if;
    return old;
  end if;

  if mes_aprobado(old.organizacion_id, old.mes) then
    if (to_jsonb(new) - array['estado', 'pagada_en', 'cierre_id'])
       is distinct from (to_jsonb(old) - array['estado', 'pagada_en', 'cierre_id']) then
      raise exception 'El mes % ya está cerrado: solo se puede marcar como pagada',
        to_char(old.mes, 'YYYY-MM');
    end if;
    if old.cierre_id is not null and new.cierre_id is distinct from old.cierre_id then
      raise exception 'No se cambia el cierre de una comisión ya cerrada';
    end if;
  elsif mes_aprobado(new.organizacion_id, new.mes) then
    raise exception 'No se puede mover una comisión a un mes cerrado';
  end if;

  if new.estado = 'pagada' and not mes_aprobado(new.organizacion_id, new.mes) then
    raise exception 'Solo se marca pagado lo de un cierre aprobado';
  end if;

  return new;
end;
$$;
