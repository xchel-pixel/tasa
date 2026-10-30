-- ============================================================
-- 0046 — TARJETA DIGITAL DEL COMISIONISTA
--
-- Página pública /t/<org>/<slug o código> con su foto, nombre para
-- mostrar, frase, WhatsApp, correo opcional, zona y el botón a su liga
-- de clientes. Leyenda fija "Asesor afiliado". El texto libre no puede
-- decir perito, valuador ni las marcas (MGP, AP73, ARQOS).
--
-- Por nivel del mes (`nivel_tarjeta`, 1–4; Élite = 4):
--   1 Enlace: básica + QR · 2 Aliado: + logo y color · 3 Socio: +
--   estadísticas · 4 Socio Plus: + servicios destacados y testimonios.
-- Si baja de nivel, lo extra se oculta (no se borra).
--
-- Estado: borrador → publicada ↔ pausada (la pausa y la reactiva él);
-- despublicada (solo admin_org, con motivo, y solo él la vuelve a
-- publicar). Comisionista inactivo → "no disponible".
--
-- Foto y logo en el bucket PÚBLICO `tarjetas` (para la vista previa de
-- WhatsApp): solo lo que él publica, con nombres no adivinables.
-- Estadísticas: contador por día, sin datos de quien visita.
-- ============================================================

-- ------------------------------------------------------------
-- 1. PALABRAS PROHIBIDAS
-- ------------------------------------------------------------

-- La palabra prohibida que aparezca (perito, valuador, MGP, AP73, ARQOS…), o nulo.
create or replace function palabra_prohibida(p_texto text)
returns text language sql immutable set search_path = public as $$
  select (regexp_match(
    translate(lower(coalesce(p_texto, '')), 'áéíóúüñ', 'aeiouun'),
    '(perit[oa]s?|pericial(es)?|valuador(a|es|as)?|mgp|ap ?73|arqos)'))[1];
$$;

-- ------------------------------------------------------------
-- 2. TABLAS
-- ------------------------------------------------------------

create table tarjetas (
  organizacion_id   uuid not null default mi_org() references organizaciones(id) on delete restrict,
  comisionista_id   uuid not null,
  frase             text check (char_length(frase) <= 140),
  telefono          text check (telefono ~ '^[0-9]{10}$'),
  correo            text check (correo ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' and char_length(correo) <= 120),
  mostrar_correo    boolean not null default false,
  zona              text check (char_length(zona) <= 80),
  foto_ruta         text,
  logo_ruta         text,
  color             text check (color ~ '^#[0-9a-fA-F]{6}$'),
  servicios         uuid[] not null default '{}' check (coalesce(array_length(servicios, 1), 0) <= 6),
  estado            text not null default 'borrador' check (estado in ('borrador', 'publicada', 'pausada', 'despublicada')),
  motivo_estado     text check (char_length(motivo_estado) <= 300),
  actualizado_en    timestamptz not null default now(),
  primary key (organizacion_id, comisionista_id),
  foreign key (organizacion_id, comisionista_id) references comisionistas(organizacion_id, persona_id) on delete cascade
);

create table testimonios (
  id              uuid primary key default gen_random_uuid(),
  organizacion_id uuid not null default mi_org() references organizaciones(id) on delete restrict,
  comisionista_id uuid not null,
  cliente         text not null check (char_length(trim(cliente)) between 2 and 60),
  texto           text not null check (char_length(trim(texto)) between 5 and 300),
  estado          text not null default 'pendiente' check (estado in ('pendiente', 'aprobado', 'rechazado')),
  motivo          text check (char_length(motivo) <= 300),
  decidido_por    uuid references personas(id) on delete set null,
  decidido_en     timestamptz,
  creado_en       timestamptz not null default now(),
  unique (organizacion_id, id),
  foreign key (organizacion_id, comisionista_id) references comisionistas(organizacion_id, persona_id) on delete cascade
);
create index on testimonios (organizacion_id, estado);

create table tarjeta_eventos (
  organizacion_id uuid not null references organizaciones(id) on delete restrict,
  comisionista_id uuid not null,
  dia             date not null,
  visitas         integer not null default 0,
  whatsapp        integer not null default 0,
  primary key (organizacion_id, comisionista_id, dia),
  foreign key (organizacion_id, comisionista_id) references comisionistas(organizacion_id, persona_id) on delete cascade
);

alter table tarjetas enable row level security;
alter table testimonios enable row level security;
alter table tarjeta_eventos enable row level security;
revoke all on tarjetas, testimonios, tarjeta_eventos from anon;
grant select on tarjetas, testimonios, tarjeta_eventos to authenticated;
grant insert on testimonios to authenticated;
create policy leer_tarjetas on tarjetas for select
  using (organizacion_id = (select mi_org()) and ((select soy_staff()) or comisionista_id = (select mi_persona_id())));
create policy leer_testimonios on testimonios for select
  using (organizacion_id = (select mi_org()) and ((select soy_staff()) or comisionista_id = (select mi_persona_id())));
create policy capturar_testimonio on testimonios for insert
  with check (organizacion_id = (select mi_org()) and comisionista_id = (select mi_persona_id()) and estado = 'pendiente'
              and (select mi_rol()) = 'comisionista' and palabra_prohibida(cliente || ' ' || texto) is null);
create policy leer_eventos_tarjeta on tarjeta_eventos for select
  using (organizacion_id = (select mi_org()) and ((select soy_staff()) or comisionista_id = (select mi_persona_id())));
create trigger bitacora after insert or update or delete on tarjetas for each row execute function registrar_bitacora();
create trigger bitacora after insert or update or delete on testimonios for each row execute function registrar_bitacora();

-- El texto libre no dice perito, valuador ni las marcas.
create or replace function revisar_texto_tarjeta()
returns trigger language plpgsql set search_path = public as $$
declare
  v text := palabra_prohibida(coalesce(new.frase, '') || ' ' || coalesce(new.zona, ''));
begin
  if v is not null then
    raise exception 'La tarjeta no puede decir "%": eres asesor afiliado (sin perito, valuador ni marcas)', v;
  end if;
  new.actualizado_en := now();
  return new;
end;
$$;
revoke all on function revisar_texto_tarjeta() from public, anon, authenticated;
create trigger al_guardar_tarjeta before insert or update on tarjetas for each row execute function revisar_texto_tarjeta();

-- ------------------------------------------------------------
-- 3. NIVEL
-- ------------------------------------------------------------

-- 1 Enlace, 2 Aliado, 3 Socio, 4 Socio Plus (Élite cuenta como 4). Lee el nivel del mes.
create or replace function nivel_tarjeta(p_org uuid, p_comisionista uuid)
returns integer language sql stable security definer set search_path = public as $$
  select least(4, greatest(1, coalesce(
    (select case when n.es_forzado then 4 else n.orden end from niveles n
      where n.organizacion_id = p_org and n.nombre = nivel_vigente(p_org, p_comisionista, hoy_mx()) limit 1),
    1)));
$$;

-- ------------------------------------------------------------
-- 4. LO QUE HACE EL COMISIONISTA
-- ------------------------------------------------------------

create or replace function guardar_mi_tarjeta(
  p_frase text, p_telefono text, p_correo text, p_mostrar_correo boolean, p_zona text, p_color text, p_servicios uuid[]
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_tel text := nullif(regexp_replace(coalesce(p_telefono, ''), '\D', '', 'g'), '');
begin
  if mi_rol() is distinct from 'comisionista' then
    raise exception 'La tarjeta es del comisionista';
  end if;
  if v_tel is not null and char_length(v_tel) = 12 and v_tel like '52%' then
    v_tel := substr(v_tel, 3);
  end if;
  if v_tel is not null and char_length(v_tel) <> 10 then
    raise exception 'El teléfono va a 10 dígitos';
  end if;
  if exists (select 1 from unnest(coalesce(p_servicios, '{}')) s
              where not exists (select 1 from servicios x where x.id = s and x.organizacion_id = mi_org() and x.activo)) then
    raise exception 'Un servicio ya no está en el catálogo; recarga la página';
  end if;
  insert into tarjetas (organizacion_id, comisionista_id, frase, telefono, correo, mostrar_correo, zona, color, servicios)
  values (mi_org(), mi_persona_id(), nullif(trim(p_frase), ''), v_tel, nullif(lower(trim(p_correo)), ''), coalesce(p_mostrar_correo, false),
          nullif(trim(p_zona), ''), nullif(trim(p_color), ''), coalesce(p_servicios, '{}'))
  on conflict (organizacion_id, comisionista_id) do update
     set frase = excluded.frase, telefono = excluded.telefono, correo = excluded.correo, mostrar_correo = excluded.mostrar_correo,
         zona = excluded.zona, color = excluded.color, servicios = excluded.servicios;
end;
$$;

-- Foto o logo ya subidos al bucket: se anota la ruta (la anterior la borra la pantalla).
create or replace function poner_imagen_tarjeta(p_tipo text, p_ruta text)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_anterior text;
begin
  if mi_rol() is distinct from 'comisionista' then
    raise exception 'La tarjeta es del comisionista';
  end if;
  if p_tipo not in ('foto', 'logo') then
    raise exception 'Tipo de imagen no válido';
  end if;
  if p_ruta is not null and p_ruta !~ ('^' || mi_org() || '/' || mi_persona_id() || '/[0-9a-f-]{36}\.(jpg|png|webp)$') then
    raise exception 'Ruta de imagen no válida';
  end if;
  insert into tarjetas (organizacion_id, comisionista_id) values (mi_org(), mi_persona_id()) on conflict do nothing;
  if p_tipo = 'foto' then
    select foto_ruta into v_anterior from tarjetas where organizacion_id = mi_org() and comisionista_id = mi_persona_id();
    update tarjetas set foto_ruta = p_ruta where organizacion_id = mi_org() and comisionista_id = mi_persona_id();
  else
    select logo_ruta into v_anterior from tarjetas where organizacion_id = mi_org() and comisionista_id = mi_persona_id();
    update tarjetas set logo_ruta = p_ruta where organizacion_id = mi_org() and comisionista_id = mi_persona_id();
  end if;
  return v_anterior;
end;
$$;

-- Publicar o pausar la suya. Una despublicada por admin_org no la puede volver a publicar él.
create or replace function publicar_mi_tarjeta(p_publicar boolean)
returns void language plpgsql security definer set search_path = public as $$
declare
  t tarjetas%rowtype;
begin
  if mi_rol() is distinct from 'comisionista' then
    raise exception 'La tarjeta es del comisionista';
  end if;
  select * into t from tarjetas where organizacion_id = mi_org() and comisionista_id = mi_persona_id() for update;
  if not found then
    raise exception 'Primero guarda tu tarjeta';
  end if;
  if t.estado = 'despublicada' then
    raise exception 'Administración despublicó tu tarjeta: %', coalesce(t.motivo_estado, 'escríbele para revisarla');
  end if;
  if p_publicar and t.telefono is null then
    raise exception 'Para publicarla escribe tu teléfono de WhatsApp';
  end if;
  update tarjetas set estado = case when p_publicar then 'publicada' else 'pausada' end, motivo_estado = null
   where organizacion_id = t.organizacion_id and comisionista_id = t.comisionista_id;
end;
$$;

-- ------------------------------------------------------------
-- 5. LO QUE HACE ADMINISTRACIÓN
-- ------------------------------------------------------------

create or replace function moderar_tarjeta(p_comisionista uuid, p_accion text, p_motivo text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not soy_admin_org() then
    raise exception 'Solo admin_org pausa o despublica tarjetas';
  end if;
  if p_accion not in ('pausar', 'despublicar', 'publicar') then
    raise exception 'Acción no válida';
  end if;
  if p_accion <> 'publicar' and char_length(trim(coalesce(p_motivo, ''))) < 3 then
    raise exception 'Escribe el motivo';
  end if;
  perform set_config('tasa.motivo', 'Tarjeta: ' || p_accion || coalesce(' · ' || nullif(trim(p_motivo), ''), ''), true);
  update tarjetas
     set estado = case p_accion when 'pausar' then 'pausada' when 'despublicar' then 'despublicada' else 'publicada' end,
         motivo_estado = case when p_accion = 'publicar' then null else trim(p_motivo) end
   where organizacion_id = mi_org() and comisionista_id = p_comisionista;
  if not found then
    raise exception 'Ese comisionista no tiene tarjeta';
  end if;
  perform set_config('tasa.motivo', '', true);
end;
$$;

create or replace function decidir_testimonio(p_testimonio uuid, p_aprobar boolean, p_motivo text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not soy_admin_org() then
    raise exception 'Solo admin_org aprueba testimonios';
  end if;
  if not p_aprobar and char_length(trim(coalesce(p_motivo, ''))) < 3 then
    raise exception 'Escribe por qué se rechaza';
  end if;
  update testimonios
     set estado = case when p_aprobar then 'aprobado' else 'rechazado' end, motivo = nullif(trim(p_motivo), ''),
         decidido_por = mi_persona_id(), decidido_en = now()
   where id = p_testimonio and organizacion_id = mi_org() and estado = 'pendiente';
  if not found then
    raise exception 'Ese testimonio ya no está pendiente';
  end if;
end;
$$;

-- ------------------------------------------------------------
-- 6. LA PÁGINA PÚBLICA (sin sesión)
-- ------------------------------------------------------------

-- Lo que la tarjeta publica, según su nivel. Nada si no existe; "no disponible" si no está publicada
-- o el comisionista está inactivo.
create or replace function datos_tarjeta(p_org text, p_clave text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  o       organizaciones%rowtype;
  c       comisionistas%rowtype;
  t       tarjetas%rowtype;
  p       personas%rowtype;
  v_nivel integer;
begin
  select * into o from organizaciones where slug = lower(trim(p_org)) and activa;
  if not found then
    return null;
  end if;
  select * into c from comisionistas
   where organizacion_id = o.id and (slug = lower(trim(p_clave)) or codigo_referido = upper(trim(p_clave)));
  if not found then
    return null;
  end if;
  select * into t from tarjetas where organizacion_id = o.id and comisionista_id = c.persona_id;
  select * into p from personas where id = c.persona_id;
  if t.comisionista_id is null or t.estado <> 'publicada' or not p.activo
     or not exists (select 1 from membresias m where m.organizacion_id = o.id and m.persona_id = c.persona_id and m.activa) then
    return jsonb_build_object('disponible', false, 'organizacion', o.nombre);
  end if;
  v_nivel := nivel_tarjeta(o.id, c.persona_id);
  return jsonb_build_object(
    'disponible', true,
    'organizacion', o.nombre,
    'org', o.slug,
    'codigo', c.codigo_referido,
    'slug', c.slug,
    'nivel', v_nivel,
    'nombre', nombre_visible(p),
    'frase', t.frase,
    'telefono', t.telefono,
    'correo', case when t.mostrar_correo then t.correo end,
    'zona', t.zona,
    'foto', t.foto_ruta,
    'logo', case when v_nivel >= 2 then t.logo_ruta end,
    'color', case when v_nivel >= 2 then t.color end,
    'servicios', case when v_nivel >= 4 then
       (select coalesce(jsonb_agg(s.nombre order by s.orden, s.nombre), '[]') from servicios s
         where s.organizacion_id = o.id and s.activo and s.id = any (t.servicios)) else '[]'::jsonb end,
    'testimonios', case when v_nivel >= 4 then
       (select coalesce(jsonb_agg(jsonb_build_object('cliente', x.cliente, 'texto', x.texto) order by x.decidido_en desc), '[]')
          from (select * from testimonios where organizacion_id = o.id and comisionista_id = c.persona_id and estado = 'aprobado'
                 order by decidido_en desc limit 6) x) else '[]'::jsonb end);
end;
$$;

-- Una visita o un clic en WhatsApp de hoy. Solo números (sin IP ni cookies).
create or replace function registrar_evento_tarjeta(p_org text, p_clave text, p_tipo text)
returns void language plpgsql security definer set search_path = public as $$
declare
  o organizaciones%rowtype;
  c comisionistas%rowtype;
begin
  if p_tipo not in ('visita', 'whatsapp') then
    return;
  end if;
  select * into o from organizaciones where slug = lower(trim(p_org)) and activa;
  if not found then
    return;
  end if;
  select * into c from comisionistas
   where organizacion_id = o.id and (slug = lower(trim(p_clave)) or codigo_referido = upper(trim(p_clave)));
  if not found or not exists (select 1 from tarjetas t where t.organizacion_id = o.id and t.comisionista_id = c.persona_id and t.estado = 'publicada') then
    return;
  end if;
  -- El propio comisionista viendo su tarjeta no cuenta.
  if auth.uid() is not null and mi_persona_id() = c.persona_id then
    return;
  end if;
  insert into tarjeta_eventos (organizacion_id, comisionista_id, dia, visitas, whatsapp)
  values (o.id, c.persona_id, hoy_mx(), case when p_tipo = 'visita' then 1 else 0 end, case when p_tipo = 'whatsapp' then 1 else 0 end)
  on conflict (organizacion_id, comisionista_id, dia) do update
     set visitas = tarjeta_eventos.visitas + excluded.visitas, whatsapp = tarjeta_eventos.whatsapp + excluded.whatsapp;
end;
$$;

-- Estadísticas por mes (Socio o más): visitas, clics en WhatsApp y solicitudes por su liga.
create or replace function mis_estadisticas_tarjeta(p_meses integer default 6)
returns table (mes date, visitas bigint, whatsapp bigint, solicitudes bigint)
language sql stable security definer set search_path = public as $$
  with meses as (
    select (mes_de(hoy_mx()) - make_interval(months => g))::date as mes from generate_series(0, greatest(p_meses, 1) - 1) g
  )
  select m.mes,
         coalesce((select sum(e.visitas) from tarjeta_eventos e where e.organizacion_id = mi_org() and e.comisionista_id = mi_persona_id()
                    and mes_de(e.dia) = m.mes), 0),
         coalesce((select sum(e.whatsapp) from tarjeta_eventos e where e.organizacion_id = mi_org() and e.comisionista_id = mi_persona_id()
                    and mes_de(e.dia) = m.mes), 0),
         (select count(*) from solicitudes s where s.organizacion_id = mi_org() and s.liga_de = mi_persona_id()
           and s.origen = 'liga_cliente' and mes_de(s.creado_en::date) = m.mes)
    from meses m
   where nivel_tarjeta(mi_org(), mi_persona_id()) >= 3
   order by m.mes desc;
$$;

create or replace function mi_nivel_tarjeta()
returns integer language sql stable security definer set search_path = public as $$
  select nivel_tarjeta(mi_org(), mi_persona_id());
$$;

-- ------------------------------------------------------------
-- 7. STORAGE: BUCKET PÚBLICO SOLO PARA FOTO Y LOGO
-- ------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('tarjetas', 'tarjetas', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- Cada comisionista sube y borra solo en su carpeta <org>/<persona>/.
create policy tarjetas_subir on storage.objects for insert to authenticated
  with check (bucket_id = 'tarjetas' and (storage.foldername(name))[1] = (select public.mi_org())::text
              and (storage.foldername(name))[2] = (select public.mi_persona_id())::text
              and (select public.mi_rol()) = 'comisionista');
create policy tarjetas_borrar on storage.objects for delete to authenticated
  using (bucket_id = 'tarjetas' and (storage.foldername(name))[1] = (select public.mi_org())::text
         and (storage.foldername(name))[2] = (select public.mi_persona_id())::text);

-- ------------------------------------------------------------
-- 8. PERMISOS
-- ------------------------------------------------------------

revoke all on function palabra_prohibida(text), nivel_tarjeta(uuid, uuid), guardar_mi_tarjeta(text, text, text, boolean, text, text, uuid[]),
  poner_imagen_tarjeta(text, text), publicar_mi_tarjeta(boolean), moderar_tarjeta(uuid, text, text), decidir_testimonio(uuid, boolean, text),
  datos_tarjeta(text, text), registrar_evento_tarjeta(text, text, text), mis_estadisticas_tarjeta(integer), mi_nivel_tarjeta()
  from public, anon;
grant execute on function palabra_prohibida(text), guardar_mi_tarjeta(text, text, text, boolean, text, text, uuid[]),
  poner_imagen_tarjeta(text, text), publicar_mi_tarjeta(boolean), moderar_tarjeta(uuid, text, text), decidir_testimonio(uuid, boolean, text),
  mis_estadisticas_tarjeta(integer), mi_nivel_tarjeta()
  to authenticated;
-- La página pública: sin sesión.
grant execute on function datos_tarjeta(text, text), registrar_evento_tarjeta(text, text, text) to anon, authenticated;
