-- ============================================================
-- 0030 — LIMPIEZA DE CSF AMPLIADA
--
-- La CSF es un dato fiscal: lo que nadie usa se borra. Una sola lista,
-- `csf_por_limpiar()`, con cuatro casos; `/api/cron` (la llave del
-- servidor) borra cada archivo de Storage y luego llama a
-- `cerrar_limpieza_csf()`, que deja la entrada en la bitácora con su
-- motivo. Si Storage falla, no se cierra y se reintenta.
--
--   rechazada    solicitud rechazada hace 90 días o más (como en 0024)
--   reemplazada  la CSF anterior de un comisionista, 30 días después de
--                reemplazarla (por si hay que revisar un error de carga)
--   abandonada   solicitud que nunca terminó de subir su CSF: se borra
--                con su archivo al día siguiente
--   huerfana     un archivo del bucket que no está ligado a nada, con más
--                de un día (para no tocar una subida en curso)
--
-- Nunca entra a la lista: la CSF vigente de un comisionista, la de una
-- solicitud pendiente o aprobada que sigue vigente, ni nada de menos de
-- un día.
-- ============================================================

-- La CSF anterior queda registrada al reemplazarla.
create table csf_reemplazadas (
  organizacion_id  uuid not null references organizaciones(id) on delete restrict,
  id               uuid not null default gen_random_uuid() primary key,
  persona_id       uuid not null references personas(id) on delete restrict,
  ruta             text not null,
  reemplazada_en   timestamptz not null default now(),
  borrada_en       timestamptz
);

create trigger bitacora after insert or update or delete on csf_reemplazadas
  for each row execute function registrar_bitacora();

alter table csf_reemplazadas enable row level security;
revoke all on csf_reemplazadas from anon;
revoke all on csf_reemplazadas from authenticated;
grant select on csf_reemplazadas to authenticated;
create policy leer_csf_reemplazadas on csf_reemplazadas for select to authenticated
  using (organizacion_id = (select mi_org())
         and (persona_id = (select mi_persona_id()) or (select mi_rol()) in ('admin_org', 'finanzas')));

create or replace function subir_mi_csf(p_ruta text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_anterior text;
begin
  if mi_rol() is distinct from 'comisionista' then
    raise exception 'Solo el comisionista sube su constancia';
  end if;
  if p_ruta not like mi_org() || '/' || mi_persona_id() || '/%.pdf'
     or not exists (select 1 from storage.objects where bucket_id = 'altas' and name = p_ruta) then
    raise exception 'No llegó la constancia: vuelve a subirla';
  end if;
  select csf_ruta into v_anterior from comisionistas where organizacion_id = mi_org() and persona_id = mi_persona_id();
  if v_anterior is not null and v_anterior <> p_ruta then
    insert into csf_reemplazadas (organizacion_id, persona_id, ruta) values (mi_org(), mi_persona_id(), v_anterior);
  end if;
  update comisionistas set csf_ruta = p_ruta, csf_subida_en = now()
   where organizacion_id = mi_org() and persona_id = mi_persona_id();
end;
$$;

-- Lo que el cron tiene que borrar ahora. `p_espera`: cuánto tiene que tener
-- un archivo sin dueño antes de borrarlo (un día; el barrido único usa una hora).
create or replace function csf_por_limpiar(p_espera interval default interval '1 day')
returns table (tipo text, ref uuid, ruta text)
language sql stable security definer set search_path = public as $$
  with en_uso as (
    select csf_ruta as ruta from comisionistas where csf_ruta is not null
    union
    select csf_ruta from solicitudes_alta where csf_ruta is not null and estado in ('pendiente', 'aprobada')
  )
  select 'rechazada', s.id, s.csf_ruta from solicitudes_alta s
   where s.estado = 'rechazada' and s.csf_ruta is not null and s.decidida_en <= now() - interval '90 days'
     and s.csf_ruta not in (select ruta from en_uso)
  union all
  select 'reemplazada', r.id, r.ruta from csf_reemplazadas r
   where r.borrada_en is null and r.reemplazada_en <= now() - interval '30 days'
     and r.ruta not in (select csf_ruta from comisionistas where csf_ruta is not null)
  union all
  select 'abandonada', s.id, s.organizacion_id || '/' || s.id || '/csf.pdf' from solicitudes_alta s
   where s.estado = 'subiendo' and s.creada_en < now() - interval '1 day'
  union all
  select 'huerfana', null, o.name from storage.objects o
   where o.bucket_id = 'altas' and o.created_at < now() - greatest(p_espera, interval '1 hour')
     and o.name not in (select ruta from en_uso)
     and not exists (select 1 from solicitudes_alta s where s.csf_ruta = o.name or o.name = s.organizacion_id || '/' || s.id || '/csf.pdf')
     and not exists (select 1 from csf_reemplazadas r where r.ruta = o.name and r.borrada_en is null);
$$;

-- Ya se borró el archivo: lo que queda en la base y en la bitácora.
create or replace function cerrar_limpieza_csf(p_tipo text, p_ref uuid, p_ruta text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := nullif(split_part(p_ruta, '/', 1), '')::uuid;
begin
  if p_tipo = 'rechazada' then
    perform set_config('tasa.motivo', 'Limpieza: CSF de solicitud rechazada hace 90 días', true);
    update solicitudes_alta set csf_ruta = null, csf_borrada_en = now() where id = p_ref and estado = 'rechazada';
  elsif p_tipo = 'reemplazada' then
    perform set_config('tasa.motivo', 'Limpieza: CSF reemplazada hace 30 días', true);
    update csf_reemplazadas set borrada_en = now() where id = p_ref;
    -- La solicitud aprobada que apuntaba a ese archivo ya no lo tiene.
    update solicitudes_alta set csf_ruta = null, csf_borrada_en = now() where csf_ruta = p_ruta;
  elsif p_tipo = 'abandonada' then
    perform set_config('tasa.motivo', 'Limpieza: solicitud abandonada sin terminar, con su CSF', true);
    delete from solicitudes_alta where id = p_ref and estado = 'subiendo';
  elsif p_tipo = 'huerfana' then
    insert into bitacora (organizacion_id, persona_id, rol, accion, tabla, registro_id, antes, despues, motivo)
    values (v_org, null, null, 'DELETE', 'storage.altas', p_ruta, jsonb_build_object('ruta', p_ruta), null,
            'Limpieza: archivo de CSF sin solicitud ni comisionista');
  else
    raise exception 'Tipo de limpieza desconocido: %', p_tipo;
  end if;
end;
$$;

drop function csf_por_borrar();
drop function marcar_csf_borrada(uuid);
drop function borrar_altas_abandonadas();

revoke all on function csf_por_limpiar(interval), cerrar_limpieza_csf(text, uuid, text), subir_mi_csf(text) from public, anon;
grant execute on function csf_por_limpiar(interval), cerrar_limpieza_csf(text, uuid, text) to service_role;
grant execute on function subir_mi_csf(text) to authenticated;
