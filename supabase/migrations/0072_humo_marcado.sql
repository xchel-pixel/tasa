-- ============================================================
-- 0072 — HUMO MARCADO
--
-- Lo que hace humo (accesos, consultas, PDF, DXF, cálculos y
-- denegaciones) queda marcado como prueba y no cuenta: ni en
-- estadísticas, ni en "Mi uso", ni en el historial de Accesos, ni en los
-- cupos.
--
-- · Humo manda una clave en el encabezado x-tasa-humo; el servidor de
--   Tasa la reenvía a la base, y la base solo la acepta si su huella
--   sha256 coincide con la guardada aquí (la clave vive en .env.local de
--   quien corre humo; en el repositorio solo va la huella). Sin la clave
--   exacta, nadie puede hacer pasar un evento normal por humo.
-- · eventos_uso.humo y usos_herramienta.humo nacen de es_humo().
-- · Los eventos que humo ya generó hoy (cuentas de humo) se marcan.
-- ============================================================

create table humo_huella (huella text not null check (char_length(huella) = 64));
alter table humo_huella enable row level security;
revoke all on humo_huella from public, anon, authenticated, service_role;
insert into humo_huella values ('2b92606e6fab4465ed920eae421a6f9f18f057bfa6f53c0a692799820df78f05');

-- ¿Esta petición viene de humo? Lee el encabezado que reenvía el servidor y compara su huella.
create or replace function es_humo()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(
    encode(sha256(convert_to(nullif(current_setting('request.headers', true), '')::json ->> 'x-tasa-humo', 'UTF8')), 'hex')
      = (select huella from humo_huella limit 1),
    false);
$$;

alter table eventos_uso add column humo boolean not null default false;
alter table eventos_uso alter column humo set default es_humo();
alter table usos_herramienta add column humo boolean not null default false;
alter table usos_herramienta alter column humo set default es_humo();
create index on eventos_uso (organizacion_id, creado_en desc) where not humo;

-- Lo que humo ya generó: todo lo de las cuentas de humo en eventos_uso (existe desde hoy y solo lo han usado las
-- corridas de humo y sus pruebas, revisado) y los PDF de las cuentas dedicadas a humo (la semilla de DEMO no crea PDF).
update eventos_uso e set humo = true
  from personas p
 where p.id = e.persona_id
   and lower(p.correo) in ('xchel@arqosuv.com', 'xchel+finanzas@arqosuv.com', 'xchel+demo-admin@arqosuv.com',
                           'xchel+demo-finanzas@arqosuv.com', 'xchel+demo-equipo@arqosuv.com', 'xchel+demo-ana@arqosuv.com');
update usos_herramienta u set humo = true
  from personas p
 where p.id = u.persona_id and u.herramienta = 'mapa_catastral_pdf'
   and lower(p.correo) in ('xchel+finanzas@arqosuv.com', 'xchel+demo-admin@arqosuv.com', 'xchel+demo-finanzas@arqosuv.com',
                           'xchel+demo-equipo@arqosuv.com', 'xchel+demo-ana@arqosuv.com');

revoke all on function es_humo() from public, anon;
grant execute on function es_humo() to authenticated, service_role;

-- Los cupos no cuentan lo de humo (0057 sin otro cambio).
create or replace function cupo_de(p_org uuid, p_persona uuid, p_herramienta text)
returns table (limite integer, extras integer, usados integer, disponibles integer)
language plpgsql stable security definer set search_path = public as $$
declare
  v_mes   date := mes_mx(now());
  v_rol   text := (select rol from membresias where organizacion_id = p_org and persona_id = p_persona and activa limit 1);
  v_lim   integer;
  v_hay   boolean := false;
begin
  if v_rol is distinct from 'comisionista' then
    v_lim := null;
  else
    select true, c.cantidad into v_hay, v_lim from cupos_herramienta c
     where c.organizacion_id = p_org and c.herramienta = p_herramienta and c.nivel_id = nivel_del_mes(p_org, p_persona, v_mes);
    if not coalesce(v_hay, false) then v_lim := null; end if;
  end if;
  extras := coalesce((select sum(e.cantidad) from extras_herramienta e where e.organizacion_id = p_org and e.persona_id = p_persona
                       and e.herramienta = p_herramienta and e.mes = v_mes), 0);
  usados := (select count(*) from usos_herramienta u where u.organizacion_id = p_org and u.persona_id = p_persona and not u.humo
              and u.herramienta = p_herramienta and mes_mx(u.creado_en) = v_mes);
  limite := v_lim;
  disponibles := case when v_lim is null then null else greatest(0, v_lim + extras - usados) end;
  return next;
end;
$$;

-- El último acceso y el historial de Accesos, sin humo (0071 sin otro cambio).
create or replace function ultimo_acceso_de(p_persona uuid)
returns timestamptz language sql stable security definer set search_path = public as $$
  select nullif(greatest(
    coalesce((select u.last_sign_in_at from auth.users u join personas p on p.user_id = u.id where p.id = p_persona), '-infinity'),
    coalesce((select max(e.creado_en) from eventos_uso e where e.persona_id = p_persona and e.evento = 'acceso' and not e.humo), '-infinity'),
    coalesce((select max(coalesce(s.refreshed_at::timestamptz, s.updated_at, s.created_at)) from auth.sessions s
                join personas p on p.user_id = s.user_id where p.id = p_persona), '-infinity')), '-infinity');
$$;

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
                   'navegador', s.user_agent, 'ip', ip_recortada(s.ip)) order by coalesce(s.refreshed_at::timestamptz, s.updated_at, s.created_at) desc)
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
