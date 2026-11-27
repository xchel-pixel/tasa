-- ============================================================
-- 0099 — CORREO CUANDO LA FUENTE NOS BLOQUEA
--
-- Al abrirse una alerta de bloqueo (0098: la fuente respondió 403 o 429),
-- además de Hoy sale un correo a XG: la cuenta admin_org de la
-- organización XG con super_plataforma (Xchel). Máximo uno al día (hora
-- de México), sin importar cuántas alertas se abran ni en qué
-- organización: el bloqueo es de la fuente y nos afecta a todos.
-- catastro_aviso_fuente() devuelve a quién y qué mandar; el servidor lo
-- manda (Resend) y nunca detiene la consulta.
-- ============================================================

create table catastro_bloqueo_correos (
  dia        date primary key,
  servicio   text not null,
  estado     integer not null,
  creado_en  timestamptz not null default now()
);
alter table catastro_bloqueo_correos enable row level security;
revoke all on catastro_bloqueo_correos from anon;
revoke all on catastro_bloqueo_correos from authenticated;

-- 0098 + el correo. Devuelve {correo, nombre, mensaje} solo cuando toca mandarlo; si no, nulo.
drop function catastro_aviso_fuente(text, integer);
create function catastro_aviso_fuente(p_servicio text, p_estado integer)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_org     uuid := mi_org();
  v_persona uuid := mi_persona_id();
  v_abierta boolean := false;
  v_mensaje text;
  v_para    record;
begin
  if v_org is null or not catastro_tiene_herramienta(v_org, v_persona) or p_servicio is null
     or p_servicio not in ('mapa', 'expediente', 'folio', 'mosaicos', 'parcela', 'construcciones', 'zona') then
    return null;
  end if;
  if p_estado not in (403, 429) then
    perform catastro_registrar_falla(v_org, v_persona, p_servicio);
    return null;
  end if;

  insert into catastro_fallas (organizacion_id, persona_id, servicio) values (v_org, v_persona, p_servicio);
  v_mensaje := 'La fuente catastral respondió ' || p_estado || (case when p_estado = 429 then ' (demasiadas peticiones)' else ' (acceso negado)' end)
            || ' en ' || p_servicio || ' a las ' || to_char(now() at time zone 'America/Mexico_City', 'HH24:MI') || ' del '
            || to_char(now() at time zone 'America/Mexico_City', 'DD/MM/YYYY')
            || '. Puede que nos estén limitando: revisa el mapa y, si sigue, baja el uso de capas y zonas. Ciérrala cuando vuelva a responder.';
  insert into alertas (organizacion_id, tipo, codigo, mensaje)
  values (v_org, 'catastro_bloqueo', 'fuente', v_mensaje)
  on conflict do nothing
  returning true into v_abierta;

  -- Solo al abrirse una alerta, y uno al día.
  if not coalesce(v_abierta, false) then
    return null;
  end if;
  insert into catastro_bloqueo_correos (dia, servicio, estado)
  values ((now() at time zone 'America/Mexico_City')::date, p_servicio, p_estado)
  on conflict (dia) do nothing;
  if not found then
    return null;
  end if;
  select p.correo, p.nombre, o.slug into v_para
    from membresias m join personas p on p.id = m.persona_id join organizaciones o on o.id = m.organizacion_id
   where m.organizacion_id = 'a0000000-0000-4000-8000-000000000001' and m.rol = 'admin_org' and m.activa and p.super_plataforma
   order by p.creado_en limit 1;
  if not found or v_para.correo is null then
    return null;
  end if;
  return jsonb_build_object('correo', v_para.correo, 'nombre', v_para.nombre, 'slug', v_para.slug, 'mensaje', v_mensaje);
end;
$$;
revoke all on function catastro_aviso_fuente(text, integer) from public, anon, authenticated;
grant execute on function catastro_aviso_fuente(text, integer) to authenticated;
