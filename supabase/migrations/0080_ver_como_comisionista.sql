-- ============================================================
-- 0080 — "VER COMO ESTE COMISIONISTA" (SOLO LECTURA) Y RESUMEN
--
-- admin_org o finanzas abren una vista de una hora (vistas_como, queda
-- en la bitácora quién y cuándo). Mientras dura, las peticiones de esa
-- persona traen el encabezado x-tasa-ver-como con el comisionista:
-- · mi_persona_id() responde el comisionista (todo el RLS lo ve como
--   él), solo si hay una vista abierta, vigente y de esa misma persona
--   de administración. Con el encabezado y sin vista válida: nadie.
-- · Antes de cada petición (pgrst.db_pre_request) la transacción pasa a
--   solo lectura si viene el encabezado: la base niega TODA escritura,
--   aunque sea de una función security definer.
-- · Nada de lo que se ve cuenta como acceso ni uso del comisionista
--   (no se escribe nada).
-- ============================================================

create table vistas_como (
  id              uuid primary key default gen_random_uuid(),
  organizacion_id uuid not null references organizaciones(id) on delete restrict,
  staff_id        uuid not null references personas(id) on delete cascade,
  persona_id      uuid not null references personas(id) on delete cascade,
  abierta_en      timestamptz not null default now(),
  expira_en       timestamptz not null default now() + interval '1 hour',
  cerrada_en      timestamptz
);
create index on vistas_como (staff_id) where cerrada_en is null;
alter table vistas_como enable row level security;
revoke all on vistas_como from anon;
create policy leer_vistas_como on vistas_como for select
  using (organizacion_id = (select mi_org()) and (select soy_admin_org()));
grant select on vistas_como to authenticated;
create trigger bitacora after insert or update or delete on vistas_como for each row execute function registrar_bitacora();

-- Quién es de verdad (lo de 0069), sin "ver como".
create or replace function mi_persona_real()
returns uuid language sql stable security definer set search_path = public as $$
  select p.id from personas p
   where p.user_id = auth.uid() and p.activo
     and (p.super_plataforma
          or exists (select 1 from membresias m join organizaciones o on o.id = m.organizacion_id and o.activa
                      where m.persona_id = p.id and m.activa
                        and (p.organizacion_activa is null or m.organizacion_id = p.organizacion_activa)));
$$;

-- ¿La petición trae el encabezado de "ver como"? (con cualquier valor: así la petición ya es de solo lectura)
create or replace function ver_como_activo()
returns boolean language sql stable as $$
  select coalesce(nullif(current_setting('request.headers', true), '')::jsonb ->> 'x-tasa-ver-como', '') <> '';
$$;

create or replace function ver_como_pedido()
returns uuid language plpgsql stable as $$
declare
  v text := nullif(current_setting('request.headers', true), '')::jsonb ->> 'x-tasa-ver-como';
begin
  return v::uuid;
exception when others then
  return null;
end;
$$;

-- 0069 + "ver como": con el encabezado, el comisionista de una vista válida (o nadie).
create or replace function mi_persona_id()
returns uuid language plpgsql stable security definer set search_path = public as $$
declare
  v_obj uuid;
begin
  if not ver_como_activo() then
    return mi_persona_real();
  end if;
  v_obj := ver_como_pedido();
  return (select vc.persona_id from vistas_como vc
           where vc.persona_id = v_obj and vc.staff_id = mi_persona_real() and vc.cerrada_en is null and vc.expira_en > now()
             and exists (select 1 from membresias m where m.persona_id = vc.staff_id and m.organizacion_id = vc.organizacion_id
                            and m.activa and m.rol in ('admin_org', 'finanzas'))
           limit 1);
end;
$$;

-- 0016 + en "ver como" nadie es super plataforma (se ve exactamente lo del comisionista).
create or replace function soy_super_plataforma()
returns boolean language sql stable security definer set search_path = public as $$
  select not ver_como_activo() and coalesce((select super_plataforma from personas where user_id = auth.uid() and activo), false);
$$;

-- Antes de cada petición: con el encabezado, solo lectura.
create or replace function solo_lectura_si_ver_como()
returns void language plpgsql as $$
declare
  v boolean;
begin
  begin
    v := ver_como_activo();
  exception when others then
    v := false;
  end;
  if v then
    perform set_config('transaction_read_only', 'on', true);
  end if;
end;
$$;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticator') then
    execute 'alter role authenticator set pgrst.db_pre_request = ''public.solo_lectura_si_ver_como''';
    perform pg_notify('pgrst', 'reload config');
  end if;
end;
$$;

-- Abrir y cerrar (sin el encabezado: con la sesión normal de administración).
create or replace function iniciar_ver_como(p_persona uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_yo uuid := mi_persona_real();
  v_id uuid;
begin
  if ver_como_activo() then
    raise exception 'Ya estás viendo como alguien: sal primero';
  end if;
  if mi_rol() not in ('admin_org', 'finanzas') then
    raise exception 'Solo administración';
  end if;
  if not exists (select 1 from membresias where persona_id = p_persona and organizacion_id = mi_org() and rol = 'comisionista') then
    raise exception 'Esa persona no es comisionista de tu organización';
  end if;
  update vistas_como set cerrada_en = now() where staff_id = v_yo and cerrada_en is null;
  perform set_config('tasa.motivo', 'Ver como comisionista (solo lectura)', true);
  insert into vistas_como (organizacion_id, staff_id, persona_id) values (mi_org(), v_yo, p_persona) returning id into v_id;
  perform set_config('tasa.motivo', '', true);
  return v_id;
end;
$$;

create or replace function cerrar_ver_como()
returns void language sql security definer set search_path = public as $$
  update vistas_como set cerrada_en = now() where staff_id = mi_persona_real() and cerrada_en is null;
$$;

-- ------------------------------------------------------------
-- Resumen en la ficha del comisionista (admin_org y finanzas)
-- ------------------------------------------------------------
create or replace function resumen_comisionista(p_persona uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_org   uuid := mi_org();
  v_mes   date := mes_de(hoy_mx());
  v_ant   date := (mes_de(hoy_mx()) - interval '1 month')::date;
  c       comisionistas;
  p       record;
  v_sig   niveles;
  v_paq   paquetes;
  v_motivo text;
begin
  if mi_rol() not in ('admin_org', 'finanzas') then
    raise exception 'Solo administración';
  end if;
  select * into c from comisionistas where organizacion_id = v_org and persona_id = p_persona;
  if c.persona_id is null then
    return null;
  end if;
  select * into p from calcular_nivel(v_org, p_persona, (v_mes + interval '1 month')::date);
  select * into v_sig from niveles
   where organizacion_id = v_org and not es_forzado and umbral_minimo > coalesce(p.promedio, 0) order by umbral_minimo limit 1;
  v_paq := paquete_vigente(v_org, p_persona);
  v_motivo := (select motivo from niveles_mensuales where organizacion_id = v_org and comisionista_id = p_persona and mes = v_mes);
  return jsonb_build_object(
    'nivel', (select nombre from niveles where id = nivel_del_mes(v_org, p_persona, v_mes)),
    'nivel_anterior', (select nombre from niveles where id = nivel_del_mes(v_org, p_persona, v_ant)),
    'porcentaje', porcentaje_vigente(v_org, p_persona, v_mes),
    'provisional', porcentaje_es_provisional(v_org, p_persona, v_mes),
    'motivo', v_motivo,
    'trato', case when c.trato_hasta is not null and v_mes between c.trato_desde and mes_de(c.trato_hasta)
                  then jsonb_build_object('tipo', c.trato_inicial, 'hasta', c.trato_hasta,
                                          'nivel', (select nombre from niveles where id = c.trato_nivel_id)) end,
    'elite', case when c.porcentaje_forzado is not null and (c.elite_vence is null or c.elite_vence >= hoy_mx())
                  then jsonb_build_object('porcentaje', c.porcentaje_forzado, 'hasta', c.elite_vence) end,
    'volumen_mes', (select coalesce(sum(monto_honorarios), 0) from solicitudes
                     where organizacion_id = v_org and comisionista_id = p_persona and mes_cierre = v_mes
                       and estado <> 'cancelada' and comision_regla <> 'ninguna'),
    'promedio', coalesce(p.promedio, 0),
    'meses', coalesce(p.meses_considerados, 0),
    'nivel_proyectado', (select nombre from niveles where id = p.nivel_id),
    'siguiente', case when v_sig.id is not null then jsonb_build_object('nombre', v_sig.nombre, 'porcentaje', v_sig.porcentaje,
                   'umbral', v_sig.umbral_minimo,
                   'falta', greatest(0, round((v_sig.umbral_minimo - coalesce(p.promedio, 0)) * greatest(coalesce(p.meses_considerados, 1), 1), 2))) end,
    'comision_mes', (select coalesce(sum(monto), 0) from comisiones
                      where organizacion_id = v_org and comisionista_id = p_persona and mes = v_mes and not cobrada_directo),
    'por_pagar', (select coalesce(sum(monto - pagado), 0) from pendientes_comision
                   where organizacion_id = v_org and comisionista_id = p_persona and pagado < monto),
    'paquete', v_paq.nombre,
    'paquete_vence', (select max(vence) from lotes_vigentes(v_org, p_persona)),
    'saldo', saldo_credito(v_org, p_persona),
    'actividad', inactividad_de(v_org, p_persona),
    'tramites', coalesce((select jsonb_agg(x order by x.creado_en desc) from (
        select s.id, s.folio, s.cliente_nombre, s.estado, s.estatus_publico, s.monto_honorarios, s.creado_en
          from solicitudes s where s.organizacion_id = v_org and s.comisionista_id = p_persona
         order by s.creado_en desc limit 5) x), '[]'));
end;
$$;

revoke all on function mi_persona_real(), ver_como_pedido(), iniciar_ver_como(uuid), cerrar_ver_como(), resumen_comisionista(uuid) from public, anon;
revoke all on function ver_como_activo(), solo_lectura_si_ver_como() from public;
-- La corre PostgREST antes de cada petición con el rol de quien pide (anon o authenticated).
grant execute on function ver_como_activo(), solo_lectura_si_ver_como() to anon, authenticated, service_role;
grant execute on function mi_persona_real(), ver_como_pedido() to authenticated, service_role;
grant execute on function iniciar_ver_como(uuid), cerrar_ver_como(), resumen_comisionista(uuid) to authenticated;
