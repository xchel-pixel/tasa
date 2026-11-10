-- ============================================================
-- 0076 — LÍMITE DE EQUIPOS CONECTADOS
--
-- · Cada rol tiene un máximo de equipos (sesiones) a la vez, editable
--   por admin_org en Ajustes (queda en la bitácora de ajustes). Por
--   omisión: comisionista, equipo, finanzas y admin_marca 3; admin_org
--   sin límite (no es editable).
-- · Al entrar, si ya tenía el máximo, se cierra la sesión de último uso
--   más antiguo. Queda como evento en eventos_uso ('cierre_limite', con
--   el navegador resumido de la sesión cerrada) y la app le dice en el
--   equipo nuevo qué sesión se cerró.
-- · Las sesiones de humo (abiertas con el encabezado de humo) quedan
--   anotadas en sesiones_humo: no cuentan para el límite, no se cierran
--   por él y no salen en el conteo de Accesos.
-- · El cron cierra las sesiones sin uso en 30 días (cualquier rol),
--   para que Accesos cuente equipos reales.
-- ============================================================

alter table ajustes add column limite_equipos jsonb not null
  default '{"comisionista": 3, "equipo": 3, "finanzas": 3, "admin_marca": 3}'::jsonb;

create table sesiones_humo (
  session_id uuid primary key,
  creado_en  timestamptz not null default now()
);
alter table sesiones_humo enable row level security;
revoke all on sesiones_humo from anon, authenticated;

-- El evento nuevo: una sesión cerrada por el límite.
alter table eventos_uso drop constraint eventos_uso_evento_check;
alter table eventos_uso add constraint eventos_uso_evento_check
  check (evento in ('consulta', 'pdf', 'dxf', 'calculo', 'acceso', 'denegado', 'cierre_limite'));

-- "Chrome en Android", como lib/navegador.ts, sin expresiones regulares.
create or replace function resumen_navegador(p_ua text)
returns text language plpgsql immutable as $$
declare
  t  text := lower(coalesce(p_ua, ''));
  so text;
  nv text;
begin
  if trim(t) = '' then return 'Desconocido'; end if;
  so := case when strpos(t, 'iphone') > 0 then 'iPhone' when strpos(t, 'ipad') > 0 then 'iPad'
             when strpos(t, 'android') > 0 then 'Android' when strpos(t, 'windows') > 0 then 'Windows'
             when strpos(t, 'mac os') > 0 or strpos(t, 'macintosh') > 0 then 'Mac' when strpos(t, 'linux') > 0 then 'Linux' end;
  nv := case when strpos(t, 'edg/') > 0 or strpos(t, 'edga/') > 0 or strpos(t, 'edgios/') > 0 then 'Edge'
             when strpos(t, 'opr/') > 0 or strpos(t, 'opera') > 0 then 'Opera'
             when strpos(t, 'samsungbrowser') > 0 then 'Samsung Internet'
             when strpos(t, 'crios/') > 0 or strpos(t, 'chrome/') > 0 then 'Chrome'
             when strpos(t, 'fxios/') > 0 or strpos(t, 'firefox/') > 0 then 'Firefox'
             when strpos(t, 'safari/') > 0 then 'Safari'
             when left(t, 4) = 'node' or strpos(t, 'undici') > 0 then 'Servidor' end;
  if nv is not null and so is not null then return nv || ' en ' || so; end if;
  return coalesce(nv, so, 'Otro');
end;
$$;

-- Último uso de una sesión.
create or replace function uso_de_sesion(s auth.sessions)
returns timestamptz language sql stable as $$
  select coalesce(s.refreshed_at::timestamptz, s.updated_at, s.created_at);
$$;

-- El máximo de equipos de una persona en una organización; nulo = sin límite.
create or replace function limite_equipos_de(p_org uuid, p_persona uuid)
returns integer language sql stable security definer set search_path = public as $$
  select case when m.rol = 'admin_org' then null
              else (select (a.limite_equipos ->> m.rol)::integer from ajustes a where a.organizacion_id = p_org) end
    from membresias m where m.organizacion_id = p_org and m.persona_id = p_persona;
$$;

-- Equipos que cuentan (sin humo).
create or replace function equipos_abiertos(p_persona uuid)
returns integer language sql stable security definer set search_path = public as $$
  select count(*)::integer from auth.sessions s join personas p on p.user_id = s.user_id
   where p.id = p_persona and not exists (select 1 from sesiones_humo h where h.session_id = s.id);
$$;

-- Al entrar (la app la llama después de verificar el código): registra el acceso y aplica el límite.
-- Devuelve las sesiones que cerró (navegador resumido) y el máximo, para avisar en el equipo nuevo.
create or replace function al_entrar(p_navegador text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_org     uuid := mi_org();
  v_persona uuid := mi_persona_id();
  v_sesion  uuid := nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'session_id', '')::uuid;
  v_max     integer;
  v_sobran  integer;
  s         record;
  v_cerr    text[] := '{}';
begin
  if v_persona is null then
    return jsonb_build_object('cerradas', '[]'::jsonb, 'maximo', null);
  end if;
  perform registrar_acceso(p_navegador);
  if es_humo() then
    if v_sesion is not null then
      insert into sesiones_humo (session_id) values (v_sesion) on conflict do nothing;
    end if;
    return jsonb_build_object('cerradas', '[]'::jsonb, 'maximo', null);
  end if;
  v_max := limite_equipos_de(v_org, v_persona);
  if v_max is null then
    return jsonb_build_object('cerradas', '[]'::jsonb, 'maximo', null);
  end if;
  v_sobran := equipos_abiertos(v_persona) - v_max;
  if v_sobran > 0 then
    for s in
      select se.id, se.user_agent from auth.sessions se join personas p on p.user_id = se.user_id
       where p.id = v_persona and se.id is distinct from v_sesion
         and not exists (select 1 from sesiones_humo h where h.session_id = se.id)
       order by uso_de_sesion(se), se.created_at
       limit v_sobran
    loop
      delete from auth.sessions where id = s.id;
      v_cerr := v_cerr || resumen_navegador(s.user_agent);
      perform registrar_evento(v_org, v_persona, 'acceso', 'cierre_limite', null, null, 'ok', 'limite_equipos', null, false, null,
                               left(resumen_navegador(s.user_agent), 80));
    end loop;
  end if;
  return jsonb_build_object('cerradas', to_jsonb(v_cerr), 'maximo', v_max);
end;
$$;

-- El cron: sesiones sin uso en 30 días, y las anotaciones de humo de sesiones que ya no existen.
create or replace function cerrar_sesiones_sin_uso()
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_n integer;
begin
  delete from auth.sessions s where uso_de_sesion(s) < now() - interval '30 days';
  get diagnostics v_n = row_count;
  delete from sesiones_humo h where not exists (select 1 from auth.sessions s where s.id = h.session_id);
  return v_n;
end;
$$;

-- Ajustes: admin_org cambia los máximos (entero de 1 a 20, o nulo = sin límite). Queda en la bitácora de ajustes.
create or replace function guardar_limite_equipos(p_limites jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  r      text;
  v      jsonb := '{}';
  v_val  jsonb;
begin
  if not soy_admin_org() then
    raise exception 'Solo admin_org';
  end if;
  foreach r in array array['comisionista', 'equipo', 'finanzas', 'admin_marca'] loop
    v_val := p_limites -> r;
    if v_val is null or jsonb_typeof(v_val) = 'null' then
      continue;
    end if;
    if jsonb_typeof(v_val) <> 'number' or (v_val #>> '{}')::numeric not between 1 and 20 or (v_val #>> '{}')::numeric <> trunc((v_val #>> '{}')::numeric) then
      raise exception 'El máximo de equipos va de 1 a 20 (o vacío, sin límite)';
    end if;
    v := v || jsonb_build_object(r, (v_val #>> '{}')::integer);
  end loop;
  perform set_config('tasa.motivo', 'Límite de equipos', true);
  update ajustes set limite_equipos = v where organizacion_id = mi_org();
  perform set_config('tasa.motivo', '', true);
end;
$$;

-- Accesos: equipos (sin humo), máximo y cierres por límite en el mes, por persona.
create or replace function equipos_org()
returns table (persona_id uuid, equipos integer, maximo integer, cierres_mes integer)
language plpgsql stable security definer set search_path = public as $$
begin
  if not soy_admin_org() then
    raise exception 'Solo admin_org';
  end if;
  return query
  select m.persona_id, equipos_abiertos(m.persona_id), limite_equipos_de(m.organizacion_id, m.persona_id),
         (select count(*)::integer from eventos_uso e where e.organizacion_id = m.organizacion_id and e.persona_id = m.persona_id
             and e.evento = 'cierre_limite' and not e.humo and mes_mx(e.creado_en) = mes_mx(now()))
    from membresias m where m.organizacion_id = mi_org();
end;
$$;

-- El detalle de Accesos marca las sesiones de humo (no se cuentan). 0072 + humo en cada sesión.
create or replace function accesos_persona(p_persona uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_org uuid := mi_org();
  m     membresias;
  p     personas;
begin
  if not soy_admin_org() then
    raise exception 'Solo admin_org';
  end if;
  select * into m from membresias where persona_id = p_persona and organizacion_id = v_org;
  if not found then
    return null;
  end if;
  select * into p from personas where id = p_persona;
  return jsonb_build_object(
    'persona', jsonb_build_object('id', p.id, 'nombre', p.nombre, 'correo', p.correo),
    'rol', m.rol,
    'activa', m.activa,
    'yo', p.id = mi_persona_id(),
    'nivel', case when m.rol = 'comisionista' then (select n.nombre from niveles n where n.id = nivel_del_mes(v_org, p.id, mes_mx(now()))) end,
    'ultimo_acceso', ultimo_acceso_de(p.id),
    'sesiones', coalesce((select jsonb_agg(jsonb_build_object(
                   'creada', s.created_at, 'actividad', coalesce(s.refreshed_at::timestamptz, s.updated_at, s.created_at),
                   'navegador', s.user_agent, 'ip', ip_recortada(s.ip),
                   'humo', exists (select 1 from sesiones_humo h where h.session_id = s.id)) order by coalesce(s.refreshed_at::timestamptz, s.updated_at, s.created_at) desc)
                   from auth.sessions s where s.user_id = p.user_id), '[]'),
    'cupos', (select jsonb_object_agg(h, (select to_jsonb(c) from cupo_de(v_org, p.id, h) c))
                from unnest(array['mapa_catastral', 'mapa_catastral_pdf', 'calculadora_traslado', 'calculadora_traslado_completa']) h),
    'eventos', coalesce((select jsonb_agg(to_jsonb(e) - 'organizacion_id' - 'persona_id' order by e.creado_en desc)
                          from (select * from eventos_uso where organizacion_id = v_org and persona_id = p.id and not humo
                                 order by creado_en desc limit 80) e), '[]'),
    'bitacora', coalesce((select jsonb_agg(jsonb_build_object(
                   'creado_en', b.creado_en, 'tabla', b.tabla, 'accion', b.accion, 'motivo', nullif(b.motivo, ''),
                   'quien', (select q.nombre from personas q where q.id = b.persona_id),
                   'cambios', (select coalesce(jsonb_agg(k order by k), '[]') from (
                                 select key k from jsonb_each(coalesce(b.despues, '{}')) union select key from jsonb_each(coalesce(b.antes, '{}'))) x
                               where b.antes -> k is distinct from b.despues -> k
                                 and k not in ('actualizado_en', 'creado_en', 'id', 'organizacion_id', 'persona_id')),
                   'activa', b.despues -> 'activa') order by b.creado_en desc)
                   from (select * from bitacora b
                          where (b.registro_id = p.id::text or b.despues ->> 'persona_id' = p.id::text or b.antes ->> 'persona_id' = p.id::text)
                            and coalesce(b.despues ->> 'organizacion_id', b.antes ->> 'organizacion_id', v_org::text) = v_org::text
                          order by b.creado_en desc limit 60) b), '[]')
  );
end;
$$;

revoke all on function resumen_navegador(text), uso_de_sesion(auth.sessions), limite_equipos_de(uuid, uuid), equipos_abiertos(uuid),
  al_entrar(text), cerrar_sesiones_sin_uso(), guardar_limite_equipos(jsonb), equipos_org() from public, anon;
revoke all on function limite_equipos_de(uuid, uuid), equipos_abiertos(uuid), cerrar_sesiones_sin_uso() from authenticated;
grant execute on function al_entrar(text), guardar_limite_equipos(jsonb), equipos_org() to authenticated;
grant execute on function cerrar_sesiones_sin_uso() to service_role;
