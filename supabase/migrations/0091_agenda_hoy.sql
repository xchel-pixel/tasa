-- ============================================================
-- 0091 — AGENDA HOY (fases 1a, 1b y 1c)
--
-- 1b · Fechas de Notion en el trámite: "Fecha de visita" (con hora si
--      la trae) y "Fecha compromiso". Antes la de visita solo movía el
--      estatus a "visita agendada" y no se guardaba.
-- 1a · Agenda privada de cada persona: tareas (hoy / después; las no
--      hechas siguen apareciendo hasta marcarse), citas por hora (no se
--      arrastran) y contactos de seguimiento. PRIVADA: solo su dueño la
--      lee y la escribe, con su sesión real (en "ver como" no se ve: la
--      base usa mi_persona_real(), no la persona que se está viendo).
--      Sin bitácora a propósito: la bitácora la lee administración.
--      Administración solo ve conteos (agenda_metricas), sin contenido.
-- 1c · Liga privada de calendario (iCal): un token por persona,
--      guardado solo como huella (sha256); al regenerar, el anterior
--      deja de servir. Solo lo de Tasa, con folio y municipio.
-- La herramienta "agenda" nace apagada; en XG solo para admin_org y en
-- DEMO para admin_org y comisionistas.
-- Retención: tareas hechas y citas de hace más de 12 meses se borran;
-- contactos de cuentas suspendidas, 12 meses después de su último cambio.
-- ============================================================

-- ------------------------------------------------------------
-- 1b. Fechas de visita y compromiso desde Notion
-- ------------------------------------------------------------
alter table solicitudes
  add column visita_en        timestamptz,
  add column visita_con_hora  boolean not null default false,
  add column fecha_compromiso date;

-- El sync las escribe tal como vienen de Notion (nulo = la borraron allá). Solo cambia si son distintas.
create or replace function registrar_fechas_afuera(p_conector uuid, p_externo_id text, p_visita text, p_compromiso date)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_org      uuid := (select organizacion_id from conectores where id = p_conector);
  v_visita   timestamptz;
  v_con_hora boolean := false;
  v_texto    text := nullif(trim(coalesce(p_visita, '')), '');
begin
  if not puede_operar_conector(p_conector) then
    raise exception 'Solo admin_org sincroniza el conector';
  end if;
  if v_texto is not null then
    if char_length(v_texto) = 10 then
      v_visita := (v_texto::date)::timestamp at time zone 'America/Mexico_City';
    else
      v_visita := v_texto::timestamptz;
      v_con_hora := true;
    end if;
  end if;
  perform set_config('tasa.motivo', 'Notion: fechas de visita y compromiso', true);
  update solicitudes s
     set visita_en = v_visita, visita_con_hora = v_con_hora, fecha_compromiso = p_compromiso
   where s.organizacion_id = v_org and replace(s.externo_id, '-', '') = replace(p_externo_id, '-', '')
     and (s.visita_en is distinct from v_visita or s.visita_con_hora is distinct from v_con_hora
          or s.fecha_compromiso is distinct from p_compromiso);
  perform set_config('tasa.motivo', '', true);
end;
$$;
revoke all on function registrar_fechas_afuera(uuid, text, text, date) from public, anon;
grant execute on function registrar_fechas_afuera(uuid, text, text, date) to authenticated, service_role;

-- ------------------------------------------------------------
-- La herramienta
-- ------------------------------------------------------------
alter table herramientas drop constraint herramientas_clave_check;
alter table herramientas add constraint herramientas_clave_check check (clave in (
  'mi_tarjeta', 'calculadora_traslado', 'calculadora_traslado_completa', 'para_tus_clientes', 'invitar', 'mapa_catastral',
  'mapa_catastral_pdf', 'agenda'));

create or replace function sembrar_herramienta_agenda(p_org uuid)
returns void language sql security definer set search_path = public as $$
  insert into herramientas (organizacion_id, clave, nombre, activa, roles, niveles, en_menu, orden)
  values (p_org, 'agenda', 'Agenda', false, array['comisionista'], null, true, 35)
  on conflict (organizacion_id, clave) do nothing;
$$;
revoke all on function sembrar_herramienta_agenda(uuid) from public, anon, authenticated;
select sembrar_herramienta_agenda(id) from organizaciones;

-- Las organizaciones nuevas también la reciben (apagada), junto con el resto del catálogo.
create or replace function sembrar_agenda_al_crear()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform sembrar_herramienta_agenda(new.id);
  return null;
end;
$$;
create trigger sembrar_agenda_al_crear after insert on organizaciones for each row execute function sembrar_agenda_al_crear();
revoke all on function sembrar_agenda_al_crear() from public, anon, authenticated;

-- Encendida solo para probar: XG (admin_org) y DEMO (admin_org y comisionistas).
update herramientas set activa = true, roles = array['admin_org']
 where clave = 'agenda' and organizacion_id = (select id from organizaciones where nombre = 'XG');
update herramientas set activa = true, roles = array['admin_org', 'comisionista']
 where clave = 'agenda' and organizacion_id in (select id from organizaciones where demo);

-- ¿Esa persona tiene la agenda? (la misma regla que mis_herramientas, para la liga que entra sin sesión).
create or replace function agenda_disponible_de(p_org uuid, p_persona uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from herramientas h join membresias m on m.organizacion_id = h.organizacion_id and m.persona_id = p_persona and m.activa
     where h.organizacion_id = p_org and h.clave = 'agenda' and h.activa and m.rol = any (h.roles));
$$;
create or replace function agenda_disponible()
returns boolean language sql stable security definer set search_path = public as $$
  select agenda_disponible_de(mi_org(), mi_persona_real());
$$;
revoke all on function agenda_disponible_de(uuid, uuid), agenda_disponible() from public, anon;
grant execute on function agenda_disponible() to authenticated;

-- ------------------------------------------------------------
-- 1a. Tablas privadas
-- ------------------------------------------------------------
create table agenda_contactos (
  id              uuid primary key default gen_random_uuid(),
  organizacion_id uuid not null default mi_org() references organizaciones(id) on delete cascade,
  persona_id      uuid not null default mi_persona_real() references personas(id) on delete cascade,
  nombre          text not null check (char_length(trim(nombre)) between 1 and 120),
  telefono        text check (telefono is null or char_length(telefono) <= 30),
  nota            text check (nota is null or char_length(nota) <= 1000),
  seguimiento_en  date,
  archivado_en    timestamptz,
  creado_en       timestamptz not null default now(),
  actualizado_en  timestamptz not null default now()
);
create index on agenda_contactos (persona_id, seguimiento_en) where archivado_en is null;

create table agenda_citas (
  id              uuid primary key default gen_random_uuid(),
  organizacion_id uuid not null default mi_org() references organizaciones(id) on delete cascade,
  persona_id      uuid not null default mi_persona_real() references personas(id) on delete cascade,
  inicia          timestamptz not null,
  termina         timestamptz,
  titulo          text not null check (char_length(trim(titulo)) between 1 and 120),
  lugar           text check (lugar is null or char_length(lugar) <= 200),
  clave_catastral text check (clave_catastral is null or clave_catastral ~ '^(0[1-9]|1[0-8])[0-9]{13}$'),
  contacto_id     uuid references agenda_contactos(id) on delete set null,
  solicitud_id    uuid references solicitudes(id) on delete set null,
  alarma_min      integer check (alarma_min is null or alarma_min in (0, 15, 30, 60, 1440)),
  estatus         text not null default 'pendiente' check (estatus in ('pendiente', 'hecha', 'no_hecha')),
  notas           text check (notas is null or char_length(notas) <= 2000),
  creado_en       timestamptz not null default now(),
  actualizado_en  timestamptz not null default now(),
  check (termina is null or termina >= inicia)
);
create index on agenda_citas (persona_id, inicia);

create table agenda_tareas (
  id              uuid primary key default gen_random_uuid(),
  organizacion_id uuid not null default mi_org() references organizaciones(id) on delete cascade,
  persona_id      uuid not null default mi_persona_real() references personas(id) on delete cascade,
  texto           text not null check (char_length(trim(texto)) between 1 and 200),
  -- Nula = "para después".
  fecha           date,
  hecha_en        timestamptz,
  contacto_id     uuid references agenda_contactos(id) on delete set null,
  solicitud_id    uuid references solicitudes(id) on delete set null,
  creado_en       timestamptz not null default now()
);
create index on agenda_tareas (persona_id, fecha);

-- Lo ligado (contacto, trámite) tiene que ser de la misma persona y de un trámite que esa persona ve.
create or replace function agenda_revisar_ligas()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.contacto_id is not null
     and not exists (select 1 from agenda_contactos c where c.id = new.contacto_id and c.persona_id = new.persona_id) then
    raise exception 'Ese contacto no es tuyo';
  end if;
  if new.solicitud_id is not null and not exists (
       select 1 from solicitudes s where s.id = new.solicitud_id and s.organizacion_id = new.organizacion_id
          and (s.comisionista_id = new.persona_id
               or exists (select 1 from membresias m where m.organizacion_id = s.organizacion_id and m.persona_id = new.persona_id
                            and m.activa and m.rol in ('admin_org', 'finanzas', 'equipo')))) then
    raise exception 'Ese trámite no es tuyo';
  end if;
  if tg_table_name in ('agenda_citas', 'agenda_contactos') then
    new.actualizado_en := now();
  end if;
  return new;
end;
$$;
create trigger agenda_revisar_ligas before insert or update on agenda_citas for each row execute function agenda_revisar_ligas();
create trigger agenda_revisar_ligas before insert or update on agenda_tareas for each row execute function agenda_revisar_ligas();
create or replace function agenda_tocar_contacto()
returns trigger language plpgsql as $$
begin
  new.actualizado_en := now();
  return new;
end;
$$;
create trigger agenda_tocar_contacto before update on agenda_contactos for each row execute function agenda_tocar_contacto();
revoke all on function agenda_revisar_ligas(), agenda_tocar_contacto() from public, anon, authenticated;

-- Privada: solo el dueño (sesión real), en su organización y con la herramienta encendida. Nadie más, ni staff.
alter table agenda_contactos enable row level security;
alter table agenda_citas enable row level security;
alter table agenda_tareas enable row level security;
revoke all on agenda_contactos, agenda_citas, agenda_tareas from anon;
create policy solo_el_dueno on agenda_contactos for all
  using (persona_id = (select mi_persona_real()) and organizacion_id = (select mi_org()) and (select agenda_disponible()))
  with check (persona_id = (select mi_persona_real()) and organizacion_id = (select mi_org()) and (select agenda_disponible()));
create policy solo_el_dueno on agenda_citas for all
  using (persona_id = (select mi_persona_real()) and organizacion_id = (select mi_org()) and (select agenda_disponible()))
  with check (persona_id = (select mi_persona_real()) and organizacion_id = (select mi_org()) and (select agenda_disponible()));
create policy solo_el_dueno on agenda_tareas for all
  using (persona_id = (select mi_persona_real()) and organizacion_id = (select mi_org()) and (select agenda_disponible()))
  with check (persona_id = (select mi_persona_real()) and organizacion_id = (select mi_org()) and (select agenda_disponible()));
grant select, insert, update, delete on agenda_contactos, agenda_citas, agenda_tareas to authenticated;

-- ------------------------------------------------------------
-- Eventos de Tasa (solo lectura)
-- ------------------------------------------------------------
-- comisionista: lo suyo. admin_org, finanzas y equipo: las visitas y entregas de toda la organización (para la oficina).
-- titulo: lo corto (folio y municipio, lo único que va a la liga de calendario); detalle: el cliente (solo en Tasa).
create or replace function agenda_eventos_de(p_org uuid, p_persona uuid, p_desde date, p_hasta date)
returns table (tipo text, dia date, hora time, titulo text, detalle text, solicitud_id uuid, uid text)
language plpgsql stable security definer set search_path = public as $$
declare
  v_rol  text := (select rol from membresias where organizacion_id = p_org and persona_id = p_persona and activa);
  v_toda boolean := v_rol in ('admin_org', 'finanzas', 'equipo');
  v_dia  integer := coalesce((select dia_limite_pago_comision from ajustes where organizacion_id = p_org), 10);
  m      date;
begin
  if v_rol is null or p_hasta < p_desde or p_hasta - p_desde > 400 then
    return;
  end if;
  return query
  select 'visita', (s.visita_en at time zone 'America/Mexico_City')::date,
         case when s.visita_con_hora then (s.visita_en at time zone 'America/Mexico_City')::time end,
         'Visita ' || coalesce(s.folio, 'sin folio') || coalesce(' · ' || nullif(trim(s.inmueble_municipio), ''), ''),
         s.cliente_nombre, s.id, 'visita-' || s.id
    from solicitudes s
   where s.organizacion_id = p_org and s.visita_en is not null and s.estado <> 'cancelada'
     and (v_toda or s.comisionista_id = p_persona)
     and (s.visita_en at time zone 'America/Mexico_City')::date between p_desde and p_hasta;
  return query
  select 'entrega', s.fecha_compromiso, null::time,
         'Entrega ' || coalesce(s.folio, 'sin folio') || coalesce(' · ' || nullif(trim(s.inmueble_municipio), ''), ''),
         s.cliente_nombre, s.id, 'entrega-' || s.id
    from solicitudes s
   where s.organizacion_id = p_org and s.fecha_compromiso between p_desde and p_hasta and s.estado = 'tramite'
     and s.estatus_publico not in ('entregado', 'pagado', 'cancelada')
     and (v_toda or s.comisionista_id = p_persona);
  -- Por cobrar: un solo renglón, hoy (sin fecha propia).
  if v_rol = 'comisionista' and hoy_mx() between p_desde and p_hasta then
    return query
    select 'cobrar', hoy_mx(), null::time, 'Por cobrar: ' || count(*) || ' trámite' || case when count(*) = 1 then '' else 's' end,
           null::text, null::uuid, 'cobrar-' || hoy_mx()
      from solicitudes s
     where s.organizacion_id = p_org and s.comisionista_id = p_persona and s.estado = 'tramite'
       and s.estatus_publico = 'entregado' and s.pagado_en is null
    having count(*) > 0;
  end if;
  -- Cierre (último día del mes) y pago de comisiones (día límite del mes siguiente), para comisionistas y staff.
  if v_rol in ('comisionista', 'admin_org', 'finanzas') then
    m := date_trunc('month', p_desde)::date;
    while m <= p_hasta loop
      if (m + interval '1 month' - interval '1 day')::date between p_desde and p_hasta then
        return query select 'cierre', (m + interval '1 month' - interval '1 day')::date, null::time,
          'Cierre de comisiones de ' || (array['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre',
                                                    'octubre', 'noviembre', 'diciembre'])[extract(month from m)::int], null::text, null::uuid, 'cierre-' || to_char(m, 'YYYY-MM');
      end if;
      if (m + (v_dia - 1))::date between p_desde and p_hasta then
        return query select 'pago_comisiones', (m + (v_dia - 1))::date, null::time, 'Pago de comisiones', null::text, null::uuid,
          'pago-' || to_char(m, 'YYYY-MM');
      end if;
      m := (m + interval '1 month')::date;
    end loop;
  end if;
  -- Paquete por vencer.
  return query
  select 'paquete', c.vence, null::time, 'Vence tu paquete', null::text, null::uuid, 'paquete-' || c.id
    from compras_paquete c
   where c.organizacion_id = p_org and c.persona_id = p_persona and c.estado = 'confirmada' and c.vence between p_desde and p_hasta;
end;
$$;
revoke all on function agenda_eventos_de(uuid, uuid, date, date) from public, anon, authenticated;

create or replace function agenda_eventos_tasa(p_desde date, p_hasta date)
returns table (tipo text, dia date, hora time, titulo text, detalle text, solicitud_id uuid, uid text)
language sql stable security definer set search_path = public as $$
  select * from agenda_eventos_de(mi_org(), mi_persona_real(), p_desde, p_hasta) where agenda_disponible();
$$;
revoke all on function agenda_eventos_tasa(date, date) from public, anon;
grant execute on function agenda_eventos_tasa(date, date) to authenticated;

-- ------------------------------------------------------------
-- 1c. Liga de calendario
-- ------------------------------------------------------------
create table calendario_ligas (
  id              uuid primary key default gen_random_uuid(),
  organizacion_id uuid not null references organizaciones(id) on delete cascade,
  persona_id      uuid not null references personas(id) on delete cascade,
  token_huella    text not null unique check (token_huella ~ '^[0-9a-f]{64}$'),
  creada_en       timestamptz not null default now(),
  revocada_en     timestamptz,
  ultimo_uso_en   timestamptz
);
create unique index calendario_ligas_una_activa on calendario_ligas (organizacion_id, persona_id) where revocada_en is null;
alter table calendario_ligas enable row level security;
revoke all on calendario_ligas from anon, authenticated;

-- La liga nueva: regresa el token UNA vez (solo se guarda su huella) y revoca la anterior.
create or replace function generar_liga_calendario()
returns text language plpgsql security definer set search_path = public as $$
declare
  -- Dos uuid v4 (244 bits al azar), sin guiones: no hace falta pgcrypto.
  v_token text := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
begin
  if not agenda_disponible() then
    raise exception 'La agenda no está disponible para ti';
  end if;
  update calendario_ligas set revocada_en = now()
   where organizacion_id = mi_org() and persona_id = mi_persona_real() and revocada_en is null;
  insert into calendario_ligas (organizacion_id, persona_id, token_huella)
  values (mi_org(), mi_persona_real(), encode(sha256(convert_to(v_token, 'UTF8')), 'hex'));
  return v_token;
end;
$$;
create or replace function revocar_liga_calendario()
returns void language sql security definer set search_path = public as $$
  update calendario_ligas set revocada_en = now()
   where organizacion_id = mi_org() and persona_id = mi_persona_real() and revocada_en is null;
$$;
create or replace function mi_liga_calendario()
returns table (creada_en timestamptz, ultimo_uso_en timestamptz)
language sql stable security definer set search_path = public as $$
  select creada_en, ultimo_uso_en from calendario_ligas
   where organizacion_id = mi_org() and persona_id = mi_persona_real() and revocada_en is null;
$$;
revoke all on function generar_liga_calendario(), revocar_liga_calendario(), mi_liga_calendario() from public, anon;
grant execute on function generar_liga_calendario(), revocar_liga_calendario(), mi_liga_calendario() to authenticated;

-- Lo que lee la liga (sin sesión, solo el servidor): de 30 días atrás a 180 adelante. Nulo si el token no sirve.
create or replace function agenda_ics(p_token text)
returns table (tipo text, dia date, hora time, titulo text, uid text)
language plpgsql security definer set search_path = public as $$
declare
  l calendario_ligas;
begin
  select * into l from calendario_ligas
   where token_huella = encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex') and revocada_en is null;
  if not found or not agenda_disponible_de(l.organizacion_id, l.persona_id) then
    return;
  end if;
  update calendario_ligas set ultimo_uso_en = now() where id = l.id and (ultimo_uso_en is null or ultimo_uso_en < now() - interval '10 minutes');
  return query
  select e.tipo, e.dia, e.hora, e.titulo, e.uid
    from agenda_eventos_de(l.organizacion_id, l.persona_id, hoy_mx() - 30, hoy_mx() + 180) e
   where e.tipo <> 'cobrar';
end;
$$;
revoke all on function agenda_ics(text) from public, anon, authenticated;
grant execute on function agenda_ics(text) to service_role;

-- ------------------------------------------------------------
-- Métricas sin contenido (administración) y limpieza
-- ------------------------------------------------------------
create or replace function agenda_metricas(p_desde date, p_hasta date)
returns table (persona_id uuid, nombre text, rol text, citas integer, tareas integer, contactos integer, ultimo_uso timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not soy_staff() then
    raise exception 'Solo administración';
  end if;
  return query
  select p.id, p.nombre, m.rol,
         (select count(*)::int from agenda_citas c where c.persona_id = p.id and c.organizacion_id = mi_org()
            and (c.inicia at time zone 'America/Mexico_City')::date between p_desde and p_hasta),
         (select count(*)::int from agenda_tareas t where t.persona_id = p.id and t.organizacion_id = mi_org()
            and (t.creado_en at time zone 'America/Mexico_City')::date between p_desde and p_hasta),
         (select count(*)::int from agenda_contactos k where k.persona_id = p.id and k.organizacion_id = mi_org() and k.archivado_en is null),
         greatest((select max(c.actualizado_en) from agenda_citas c where c.persona_id = p.id and c.organizacion_id = mi_org()),
                  (select max(t.creado_en) from agenda_tareas t where t.persona_id = p.id and t.organizacion_id = mi_org()),
                  (select max(k.actualizado_en) from agenda_contactos k where k.persona_id = p.id and k.organizacion_id = mi_org()))
    from membresias m join personas p on p.id = m.persona_id
   where m.organizacion_id = mi_org() and not m.es_demo
     and (exists (select 1 from agenda_citas c where c.persona_id = p.id and c.organizacion_id = mi_org())
          or exists (select 1 from agenda_tareas t where t.persona_id = p.id and t.organizacion_id = mi_org())
          or exists (select 1 from agenda_contactos k where k.persona_id = p.id and k.organizacion_id = mi_org()))
   order by p.nombre;
end;
$$;
revoke all on function agenda_metricas(date, date) from public, anon;
grant execute on function agenda_metricas(date, date) to authenticated;

create or replace function limpiar_agenda()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_t integer; v_c integer; v_k integer; v_l integer;
begin
  delete from agenda_tareas where hecha_en < now() - interval '12 months';
  get diagnostics v_t = row_count;
  delete from agenda_citas where inicia < now() - interval '12 months';
  get diagnostics v_c = row_count;
  delete from agenda_contactos k
   where k.actualizado_en < now() - interval '12 months'
     and not exists (select 1 from membresias m where m.organizacion_id = k.organizacion_id and m.persona_id = k.persona_id and m.activa);
  get diagnostics v_k = row_count;
  delete from calendario_ligas where revocada_en < now() - interval '90 days';
  get diagnostics v_l = row_count;
  return jsonb_build_object('tareas', v_t, 'citas', v_c, 'contactos', v_k, 'ligas', v_l);
end;
$$;
revoke all on function limpiar_agenda() from public, anon, authenticated;
grant execute on function limpiar_agenda() to service_role;
