-- ============================================================
-- 0056 — PORTADA SOLO CON HERRAMIENTAS Y CÁLCULO LIGADO A LA SOLICITUD
--
-- 1. "Para tus clientes" (liga y QR) e "Invita a un comisionista" dejan
--    de ser bloques del inicio: son herramientas del catálogo (0053), cada
--    una con su pantalla. Activas para quien ya las tenía (comisionistas,
--    equipo, finanzas, admin de marca y admin_org).
-- 2. Al encargar el avalúo desde la calculadora de traslado, la solicitud
--    queda ligada al cálculo (de dónde vino). Si el cálculo se borra a los
--    90 días, la liga queda vacía; el resumen sigue en la descripción.
-- ============================================================

alter table herramientas drop constraint herramientas_clave_check;
alter table herramientas add constraint herramientas_clave_check check (clave in (
  'mi_tarjeta', 'calculadora_traslado', 'calculadora_traslado_completa', 'para_tus_clientes', 'invitar'));

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
                where organizacion_id = p_org and (es_forzado or nombre in ('Socio', 'Socio Plus'))), '{}'), false, 41)
  on conflict (organizacion_id, clave) do nothing;
end;
$$;

select sembrar_herramientas(id) from organizaciones;

alter table solicitudes
  add column calculo_traslado_id uuid references calculos_traslado(id) on delete set null;

-- El comisionista liga su cálculo a la solicitud que acaba de pedir (las dos tienen que ser suyas).
create or replace function ligar_calculo_a_solicitud(p_solicitud uuid, p_calculo uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from calculos_traslado where id = p_calculo and organizacion_id = mi_org() and persona_id = mi_persona_id()) then
    raise exception 'Ese cálculo no es tuyo';
  end if;
  update solicitudes set calculo_traslado_id = p_calculo
   where id = p_solicitud and organizacion_id = mi_org() and comisionista_id = mi_persona_id() and estado = 'solicitada';
  if not found then
    raise exception 'Esa solicitud no es tuya';
  end if;
end;
$$;

revoke all on function ligar_calculo_a_solicitud(uuid, uuid) from public, anon;
grant execute on function ligar_calculo_a_solicitud(uuid, uuid) to authenticated;
