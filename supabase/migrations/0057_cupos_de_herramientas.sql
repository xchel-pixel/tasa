-- ============================================================
-- 0057 — CUPOS MENSUALES POR HERRAMIENTA
--
-- Mecanismo general (la calculadora de traslado primero; después la
-- consulta catastral, la OV express…): cada herramienta que "consume"
-- tiene un cupo por nivel de comisionista al mes; equipo y
-- administración, sin límite. Solo cuenta un uso nuevo (un cálculo
-- nuevo); reabrir, editar o descargar no consume. Se reinicia el día 1
-- de cada mes, hora de México.
--
-- · cupos_herramienta: (herramienta, nivel) → cantidad; nulo = sin
--   límite. Sin renglón para un nivel: sin límite (admin_org lo ajusta).
-- · extras_herramienta: cálculos extra que admin_org libera a un
--   comisionista para el mes en curso, con motivo y bitácora.
-- · usos_herramienta: ya existía (0055); la Completa se cuenta aparte
--   (herramienta = su clave) y el uso guarda su cálculo y, si terminó en
--   solicitud de avalúo, la solicitud (para la conversión del reporte).
-- · "Pedir más": alerta para admin_org, una abierta por persona,
--   herramienta y mes; se cierra al liberar.
-- · La Completa queda abierta a todos los niveles (su cupo la limita).
-- ============================================================

create table cupos_herramienta (
  id              uuid primary key default gen_random_uuid(),
  organizacion_id uuid not null default mi_org() references organizaciones(id) on delete restrict,
  herramienta     text not null,
  nivel_id        uuid not null references niveles(id) on delete cascade,
  cantidad        integer check (cantidad >= 0),
  unique (organizacion_id, herramienta, nivel_id)
);
alter table cupos_herramienta enable row level security;
revoke all on cupos_herramienta from anon;
create policy leer_cupos on cupos_herramienta for select using (organizacion_id = (select mi_org()));
create policy admin_cupos on cupos_herramienta for all
  using (organizacion_id = (select mi_org()) and (select soy_admin_org()))
  with check (organizacion_id = (select mi_org()) and (select soy_admin_org()));
grant select, insert, update, delete on cupos_herramienta to authenticated;
create trigger bitacora after insert or update or delete on cupos_herramienta
  for each row execute function registrar_bitacora();

create table extras_herramienta (
  id              uuid primary key default gen_random_uuid(),
  organizacion_id uuid not null default mi_org() references organizaciones(id) on delete restrict,
  persona_id      uuid not null references personas(id) on delete cascade,
  herramienta     text not null,
  mes             date not null check (mes = mes_de(mes)),
  cantidad        integer not null check (cantidad between 1 and 500),
  motivo          text not null check (char_length(trim(motivo)) between 3 and 300),
  otorgado_por    uuid references personas(id) on delete set null,
  creado_en       timestamptz not null default now()
);
create index on extras_herramienta (organizacion_id, persona_id, herramienta, mes);
alter table extras_herramienta enable row level security;
revoke all on extras_herramienta from anon;
create policy leer_extras on extras_herramienta for select
  using (organizacion_id = (select mi_org()) and ((select soy_staff()) or persona_id = (select mi_persona_id())));
grant select on extras_herramienta to authenticated;
create trigger bitacora after insert or update or delete on extras_herramienta
  for each row execute function registrar_bitacora();

alter table usos_herramienta add column calculo_id uuid, add column solicitud_id uuid;
update usos_herramienta set herramienta = 'calculadora_traslado_completa' where herramienta = 'calculadora_traslado' and modo = 'completa';

-- Valores iniciales: Rápida 15/30/60/sin límite; Completa 2/5/15/sin límite (Socio Plus y Élite).
create or replace function sembrar_cupos(p_org uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into cupos_herramienta (organizacion_id, herramienta, nivel_id, cantidad)
  select p_org, c.herramienta, n.id, c.cantidad
    from niveles n
    join (values ('calculadora_traslado', 'Enlace', 15), ('calculadora_traslado', 'Aliado', 30), ('calculadora_traslado', 'Socio', 60),
                 ('calculadora_traslado', 'Socio Plus', null), ('calculadora_traslado_completa', 'Enlace', 2),
                 ('calculadora_traslado_completa', 'Aliado', 5), ('calculadora_traslado_completa', 'Socio', 15),
                 ('calculadora_traslado_completa', 'Socio Plus', null)) as c(herramienta, nivel, cantidad)
      on c.nivel = n.nombre
   where n.organizacion_id = p_org
  union all
  select p_org, h, n.id, null from niveles n, unnest(array['calculadora_traslado', 'calculadora_traslado_completa']) h
   where n.organizacion_id = p_org and n.es_forzado
  on conflict (organizacion_id, herramienta, nivel_id) do nothing;
end;
$$;
select sembrar_cupos(id) from organizaciones;

update herramientas set niveles = null where clave = 'calculadora_traslado_completa';

-- ------------------------------------------------------------
-- Cálculo del cupo
-- ------------------------------------------------------------

create or replace function mes_mx(p_t timestamptz)
returns date language sql immutable as $$
  select date_trunc('month', p_t at time zone 'America/Mexico_City')::date;
$$;

-- El nivel con el que cuenta un comisionista en un mes (guardado al cerrar el anterior o calculado).
create or replace function nivel_del_mes(p_org uuid, p_persona uuid, p_mes date)
returns uuid language sql stable security definer set search_path = public as $$
  select coalesce(
    (select nm.nivel_id from niveles_mensuales nm where nm.organizacion_id = p_org and nm.comisionista_id = p_persona and nm.mes = p_mes),
    (select n.nivel_id from calcular_nivel(p_org, p_persona, p_mes) n));
$$;

-- limite nulo = sin límite. disponibles nulo = sin límite.
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
  usados := (select count(*) from usos_herramienta u where u.organizacion_id = p_org and u.persona_id = p_persona
              and u.herramienta = p_herramienta and mes_mx(u.creado_en) = v_mes);
  limite := v_lim;
  disponibles := case when v_lim is null then null else greatest(0, v_lim + extras - usados) end;
  return next;
end;
$$;

create or replace function mi_cupo(p_herramienta text)
returns table (limite integer, extras integer, usados integer, disponibles integer)
language sql stable security definer set search_path = public as $$
  select * from cupo_de(mi_org(), mi_persona_id(), p_herramienta);
$$;

-- Consume un uso (lo llama cada herramienta al hacer algo nuevo); sin cupo, se detiene.
create or replace function consumir_cupo(p_herramienta text, p_modo text, p_calculo uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  c record;
begin
  select * into c from cupo_de(mi_org(), mi_persona_id(), p_herramienta);
  if c.disponibles is not null and c.disponibles <= 0 then
    raise exception 'Llegaste a tu límite del mes. Sube de nivel o pide más cálculos.';
  end if;
  insert into usos_herramienta (organizacion_id, persona_id, herramienta, modo, calculo_id)
  values (mi_org(), mi_persona_id(), p_herramienta, p_modo, p_calculo);
end;
$$;

-- La calculadora consume su cupo (Rápida o Completa por separado).
create or replace function guardar_calculo_traslado(p_modo text, p_referencia text, p_municipio text, p_lado text, p_entrada jsonb, p_resultado jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id   uuid;
  v_herr text := case when p_modo = 'completa' then 'calculadora_traslado_completa' else 'calculadora_traslado' end;
begin
  if not exists (select 1 from mis_herramientas() where clave = v_herr) then
    raise exception 'Ese modo de la calculadora no está disponible para ti';
  end if;
  insert into calculos_traslado (modo, referencia, municipio, lado, entrada, resultado)
  values (p_modo, nullif(left(trim(coalesce(p_referencia, '')), 80), ''), p_municipio, p_lado, p_entrada, p_resultado)
  returning id into v_id;
  perform consumir_cupo(v_herr, p_modo, v_id);
  return v_id;
end;
$$;

-- Al encargar el avalúo desde el cálculo, el uso queda convertido (para el reporte).
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
  update usos_herramienta set solicitud_id = p_solicitud where calculo_id = p_calculo and organizacion_id = mi_org() and solicitud_id is null;
end;
$$;

-- ------------------------------------------------------------
-- Pedir más y liberar (admin_org)
-- ------------------------------------------------------------

alter table alertas drop constraint alertas_tipo_check;
alter table alertas drop constraint alertas_tipo_completo;
alter table alertas
  add constraint alertas_tipo_check check (tipo in ('cancelado_externo', 'externo_borrado', 'liga_inactiva', 'conector',
                                                    'estimado_sin_final', 'liga_limite', 'pago_por_entregar', 'externo_solicitado',
                                                    'perfil_por_aprobar', 'externo_comision', 'notion_sin_pagina', 'notion_pago',
                                                    'parametros_fiscales', 'cupo_agotado')),
  add constraint alertas_tipo_completo check (
    (tipo in ('cancelado_externo', 'externo_borrado', 'liga_inactiva', 'estimado_sin_final', 'pago_por_entregar',
              'externo_solicitado', 'externo_comision')
     and solicitud_id is not null)
    or (tipo = 'conector' and conector_id is not null and codigo is not null)
    or (tipo in ('liga_limite', 'perfil_por_aprobar', 'notion_sin_pagina', 'notion_pago', 'parametros_fiscales', 'cupo_agotado') and codigo is not null));
drop index if exists alertas_codigo_una_abierta;
create unique index alertas_codigo_una_abierta
  on alertas (organizacion_id, tipo, codigo) where resuelta_en is null
  and tipo in ('notion_sin_pagina', 'notion_pago', 'parametros_fiscales', 'cupo_agotado');

create or replace function nombre_herramienta(p_org uuid, p_herramienta text)
returns text language sql stable security definer set search_path = public as $$
  select coalesce((select nombre from herramientas where organizacion_id = p_org and clave = p_herramienta), p_herramienta);
$$;

-- codigo = persona:herramienta:AAAA-MM (una abierta por mes).
create or replace function pedir_mas_cupo(p_herramienta text)
returns void language plpgsql security definer set search_path = public as $$
declare
  c record;
begin
  select * into c from mi_cupo(p_herramienta);
  if c.disponibles is null or c.disponibles > 0 then
    raise exception 'Todavía tienes cupo este mes';
  end if;
  insert into alertas (organizacion_id, tipo, codigo, mensaje)
  values (mi_org(), 'cupo_agotado', mi_persona_id() || ':' || p_herramienta || ':' || to_char(mes_mx(now()), 'YYYY-MM'),
          (select nombre from personas where id = mi_persona_id()) || ' llegó a su límite de ' || nombre_herramienta(mi_org(), p_herramienta)
          || ' este mes (' || c.usados || ' de ' || (c.limite + c.extras) || ') y pide más.')
  on conflict do nothing;
end;
$$;

create or replace function liberar_cupo(p_persona uuid, p_herramienta text, p_cantidad integer, p_motivo text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_mes date := mes_mx(now());
begin
  if not soy_admin_org() then
    raise exception 'Solo admin_org libera cálculos extra';
  end if;
  if not exists (select 1 from comisionistas where organizacion_id = mi_org() and persona_id = p_persona) then
    raise exception 'No existe ese comisionista';
  end if;
  if coalesce(p_cantidad, 0) not between 1 and 500 then
    raise exception 'La cantidad va de 1 a 500';
  end if;
  if char_length(trim(coalesce(p_motivo, ''))) < 3 then
    raise exception 'Escribe el motivo';
  end if;
  perform set_config('tasa.motivo', 'Cálculos extra: ' || trim(p_motivo), true);
  insert into extras_herramienta (persona_id, herramienta, mes, cantidad, motivo, otorgado_por)
  values (p_persona, p_herramienta, v_mes, p_cantidad, trim(p_motivo), mi_persona_id());
  update alertas set resuelta_en = now(), resuelta_por = mi_persona_id(), resolucion = 'Se liberaron ' || p_cantidad || ' más'
   where organizacion_id = mi_org() and tipo = 'cupo_agotado' and resuelta_en is null
     and codigo = p_persona || ':' || p_herramienta || ':' || to_char(v_mes, 'YYYY-MM');
  perform set_config('tasa.motivo', '', true);
end;
$$;

revoke all on function sembrar_cupos(uuid), mes_mx(timestamptz), nivel_del_mes(uuid, uuid, date), cupo_de(uuid, uuid, text),
  mi_cupo(text), consumir_cupo(text, text, uuid), nombre_herramienta(uuid, text), pedir_mas_cupo(text),
  liberar_cupo(uuid, text, integer, text)
  from public, anon, authenticated;
grant execute on function mi_cupo(text), pedir_mas_cupo(text), liberar_cupo(uuid, text, integer, text), mes_mx(timestamptz) to authenticated;
-- Para la ficha del comisionista (staff) y el reporte.
create or replace function cupo_de_comisionista(p_persona uuid, p_herramienta text)
returns table (limite integer, extras integer, usados integer, disponibles integer)
language plpgsql stable security definer set search_path = public as $$
begin
  if not soy_staff() then raise exception 'Solo administración'; end if;
  return query select * from cupo_de(mi_org(), p_persona, p_herramienta);
end;
$$;
revoke all on function cupo_de_comisionista(uuid, text) from public, anon;
grant execute on function cupo_de_comisionista(uuid, text) to authenticated;
