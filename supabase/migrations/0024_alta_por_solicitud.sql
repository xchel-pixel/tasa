-- ============================================================
-- 0024 — ALTA DE COMISIONISTAS POR SOLICITUD
--
-- Desde producción toda alta nace de una solicitud que aprueba
-- admin_org, con RFC (formato y dígito verificador del SAT) y
-- Constancia de Situación Fiscal (CSF) en PDF.
--
-- 1. RFC: `rfc_valido()` en la base. Todo comisionista nuevo, o al que
--    se le cambie el RFC, lo trae válido, salvo "RFC revisado a mano"
--    (RFC antiguo cuyo dígito no cuadra, comprobado contra la CSF).
--    Es un trigger y no un check para no trabar los comisionistas de
--    la base de pruebas que nacieron sin RFC: en producción no hay.
-- 2. Solicitudes: llegan sin sesión por `/alta/<org>` (anon solo pasa
--    por funciones security definer) o las captura finanzas. La CSF se
--    sube directo al bucket privado `altas`; la política solo deja subir
--    la de una solicitud que está "subiendo" y tiene menos de 30 minutos.
-- 3. Aprobar y rechazar: solo admin_org. Aprobar crea persona,
--    membresía y comisionista con su trato inicial.
-- 4. Alta directa: solo admin_org (finanzas ya no), con CSF o "CSF
--    pendiente"; con "RFC revisado a mano" la CSF es obligatoria.
-- 5. Aviso de privacidad versionado (como los términos) y público en
--    /privacidad. Los textos de los correos, editables en Ajustes.
-- 6. La CSF de una solicitud rechazada se borra a los 90 días
--    (/api/cron); la solicitud se queda.
-- ============================================================

-- ------------------------------------------------------------
-- 1. RFC
-- ------------------------------------------------------------

-- Dígito verificador del SAT sobre los primeros 11 (empresa) o 12
-- (persona) caracteres: el de empresa se completa con un espacio al
-- frente, pesos 13 a 2, módulo 11; 10 es "A".
create or replace function rfc_digito(p_base text)
returns text language sql immutable as $$
  with s as (select lpad(p_base, 12, ' ') as b),
       suma as (
         select sum((strpos('0123456789ABCDEFGHIJKLMN&OPQRSTUVWXYZ Ñ', substr(b, i, 1)) - 1) * (14 - i)) as t
           from s, generate_series(1, 12) i
       )
  select case when t % 11 = 0 then '0' when 11 - t % 11 = 10 then 'A' else (11 - t % 11)::text end from suma;
$$;

create or replace function rfc_valido(p_rfc text)
returns boolean language sql immutable as $$
  select coalesce(p_rfc ~ '^[A-ZÑ&]{3,4}[0-9]{6}[A-Z0-9]{3}$'
                  and right(p_rfc, 1) = rfc_digito(left(p_rfc, char_length(p_rfc) - 1)), false);
$$;

alter table comisionistas
  add column rfc_revisado_a_mano boolean not null default false,
  -- Bucket `altas`. Nula = "CSF pendiente".
  add column csf_ruta text,
  add column csf_subida_en timestamptz;

create or replace function revisar_rfc_comisionista()
returns trigger language plpgsql as $$
begin
  new.rfc := nullif(upper(trim(new.rfc)), '');
  if new.rfc is null then
    raise exception 'El RFC es obligatorio';
  end if;
  -- Cambiar el RFC pierde la revisión a mano: el nuevo tiene que cuadrar.
  if tg_op = 'UPDATE' and new.rfc is distinct from old.rfc and new.rfc_revisado_a_mano = old.rfc_revisado_a_mano then
    new.rfc_revisado_a_mano := false;
  end if;
  if not new.rfc_revisado_a_mano and not rfc_valido(new.rfc) then
    raise exception 'El RFC no es válido: revisa el dígito verificador (el último carácter)';
  end if;
  return new;
end;
$$;

create trigger al_guardar_rfc
  before insert or update of rfc, rfc_revisado_a_mano on comisionistas
  for each row execute function revisar_rfc_comisionista();

-- ------------------------------------------------------------
-- 2. AJUSTES: AVISO VERSIONADO Y TEXTOS DE LOS CORREOS
-- ------------------------------------------------------------

alter table ajustes
  add column aviso_version integer not null default 0,
  add column aviso_actualizado_en timestamptz,
  add column correo_bienvenida text check (char_length(correo_bienvenida) <= 5000) default $t$Asunto: Te damos la bienvenida a Tasa

Hola, [NOMBRE]:

Tu solicitud para Tasa fue aprobada. Desde hoy puedes encargarnos cotizaciones y trámites de valuación, ver el estatus de cada trabajo y llevar tus comisiones en un solo lugar.

Cómo entrar:
1. Abre tasa.xgplataform.com.
2. Escribe tu correo y te llegará un código de 6 dígitos (revisa también no deseados).
3. La primera vez acepta los términos.

Tip: agrégalo a la pantalla de inicio de tu celular para tenerlo como app.

Tu nivel inicial: [NIVEL Y %] hasta el [FECHA].

Si tienes dudas, escríbenos a [CONTACTO DE SOPORTE].

Te damos la bienvenida.$t$,
  add column correo_rechazo text check (char_length(correo_rechazo) <= 2000) default $t$Asunto: Tu solicitud para Tasa

Hola, [NOMBRE]: revisamos tu solicitud para Tasa y por ahora no pudimos aprobarla. [MOTIVO OPCIONAL] Si crees que es un error, escríbenos a [CONTACTO DE SOPORTE].$t$;

update ajustes set
  aviso_version = case when nullif(trim(aviso_privacidad), '') is not null then 1 else 0 end,
  aviso_actualizado_en = case when nullif(trim(aviso_privacidad), '') is not null then actualizado_en end;

create or replace function versionar_aviso()
returns trigger language plpgsql as $$
begin
  if coalesce(new.aviso_privacidad, '') is distinct from coalesce(old.aviso_privacidad, '') and nullif(trim(new.aviso_privacidad), '') is not null then
    new.aviso_version := old.aviso_version + 1;
    new.aviso_actualizado_en := now();
  end if;
  return new;
end;
$$;

create trigger al_cambiar_aviso
  before update of aviso_privacidad on ajustes
  for each row execute function versionar_aviso();

-- Quien acepta los términos acepta también el aviso vigente (así lo
-- acepta quien llegó por una solicitud capturada por finanzas).
alter table aceptaciones_terminos add column aviso_version integer;

create or replace function aceptar_terminos(p_version integer)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_actual integer;
  v_aviso  integer;
begin
  if mi_persona_id() is null or mi_org() is null then
    raise exception 'Sin sesión';
  end if;
  select terminos_version, nullif(aviso_version, 0) into v_actual, v_aviso from ajustes where organizacion_id = mi_org();
  if v_actual is distinct from p_version then
    raise exception 'Los términos cambiaron mientras los leías: revisa la versión nueva';
  end if;
  insert into aceptaciones_terminos (organizacion_id, persona_id, version, aviso_version)
  values (mi_org(), mi_persona_id(), p_version, v_aviso)
  on conflict do nothing;
end;
$$;

-- Lo que se ve sin sesión en /privacidad. Sin slug: la primera
-- organización que publicó su aviso (en producción, XG).
create or replace function aviso_privacidad_publico(p_slug text default null)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('organizacion', o.nombre, 'slug', o.slug, 'texto', a.aviso_privacidad,
                            'version', a.aviso_version, 'actualizado_en', a.aviso_actualizado_en)
    from organizaciones o join ajustes a on a.organizacion_id = o.id
   where o.activa and nullif(trim(a.aviso_privacidad), '') is not null
     and (p_slug is null or o.slug = p_slug)
   order by o.creado_en
   limit 1;
$$;

-- ------------------------------------------------------------
-- 3. SOLICITUDES DE ALTA
-- ------------------------------------------------------------

create table solicitudes_alta (
  organizacion_id     uuid not null references organizaciones(id) on delete restrict,
  id                  uuid not null default gen_random_uuid(),
  nombre              text not null check (char_length(nombre) between 1 and 120),
  correo              text not null check (char_length(correo) <= 120),
  telefono            text not null check (char_length(telefono) <= 20),
  rfc                 text not null check (rfc ~ '^[A-ZÑ&]{3,4}[0-9]{6}[A-Z0-9]{3}$'),
  -- {organización}/{solicitud}/csf.pdf; nula mientras sube y después de borrarla.
  csf_ruta            text,
  csf_borrada_en      timestamptz,
  referidor_id        uuid,
  aviso_version       integer,
  aviso_aceptado_en   timestamptz,
  capturada_por       uuid references personas(id) on delete restrict,
  estado              text not null default 'subiendo'
                        check (estado in ('subiendo', 'pendiente', 'aprobada', 'rechazada')),
  posible_duplicado   boolean not null default false,
  rfc_por_revisar     boolean not null default false,
  coincidencias       text[] not null default '{}',
  decidida_por        uuid references personas(id) on delete restrict,
  decidida_en         timestamptz,
  motivo              text check (char_length(motivo) <= 500),
  rfc_revisado_a_mano boolean not null default false,
  persona_id          uuid references personas(id) on delete restrict,
  correo_enviado_en   timestamptz,
  correo_error        text,
  ip_resumen          text,
  creada_en           timestamptz not null default now(),
  primary key (organizacion_id, id),
  unique (id),
  foreign key (organizacion_id, referidor_id) references comisionistas (organizacion_id, persona_id)
    on delete set null (referidor_id)
);

create index on solicitudes_alta (organizacion_id, estado, creada_en desc);
create index on solicitudes_alta (organizacion_id, rfc);
create index on solicitudes_alta (ip_resumen, creada_en);

create trigger bitacora after insert or update or delete on solicitudes_alta
  for each row execute function registrar_bitacora();

alter table solicitudes_alta enable row level security;
revoke all on solicitudes_alta from anon;
revoke all on solicitudes_alta from authenticated;
grant select on solicitudes_alta to authenticated;
create policy leer_solicitudes_alta on solicitudes_alta for select to authenticated
  using (organizacion_id = (select mi_org()) and (select mi_rol()) in ('admin_org', 'finanzas'));

-- Lo que la pantalla pública necesita de la organización. Nada más.
create or replace function datos_alta_publica(p_slug text)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    -- El id arma la ruta de la CSF ({organización}/{solicitud}/csf.pdf).
    'id', o.id, 'organizacion', o.nombre, 'slug', o.slug,
    'aviso_version', nullif(a.aviso_version, 0),
    'contacto', coalesce(nullif(trim(a.contacto_soporte), ''), (select nullif(trim(contacto_soporte), '') from ajustes_plataforma)))
    from organizaciones o left join ajustes a on a.organizacion_id = o.id
   where o.slug = p_slug and o.activa;
$$;

-- "(442) 123-45 67" → "4421234567"; conserva el + de un número internacional.
create or replace function limpiar_telefono(p text)
returns text language sql immutable as $$
  select case when left(trim(p), 1) = '+' then '+' else '' end || regexp_replace(coalesce(p, ''), '\D', '', 'g');
$$;

-- Valida lo que llega del formulario; los mensajes ya están escritos
-- para leerse.
create or replace function validar_datos_alta(p_nombre text, p_correo text, p_telefono text, p_rfc text)
returns void language plpgsql immutable as $$
begin
  if nullif(trim(p_nombre), '') is null then
    raise exception 'Falta el nombre';
  end if;
  if lower(trim(p_correo)) !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'El correo no es válido';
  end if;
  if char_length(regexp_replace(coalesce(p_telefono, ''), '\D', '', 'g')) not between 10 and 13 then
    raise exception 'El teléfono debe tener 10 dígitos';
  end if;
  if coalesce(p_rfc, '') !~ '^[A-ZÑ&]{3,4}[0-9]{6}[A-Z0-9]{3}$' then
    raise exception 'El RFC no tiene el formato correcto: letras, fecha AAMMDD y homoclave';
  end if;
end;
$$;

-- Con quién podría estar repetida: RFC o correo de un comisionista
-- activo, o RFC de otra solicitud pendiente. No bloquea: avisa.
create or replace function marcar_coincidencias(p_org uuid, p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  s  solicitudes_alta;
  v  text[];
begin
  select * into s from solicitudes_alta where organizacion_id = p_org and id = p_id;
  v := array(
    select 'RFC de ' || p.nombre || ' (comisionista)'
      from comisionistas c join personas p on p.id = c.persona_id
      join membresias m on m.persona_id = c.persona_id and m.organizacion_id = c.organizacion_id and m.activa
     where c.organizacion_id = p_org and c.rfc = s.rfc
    union all
    select 'Correo de ' || p.nombre || ' (comisionista)'
      from personas p join membresias m on m.persona_id = p.id and m.organizacion_id = p_org and m.rol = 'comisionista' and m.activa
     where lower(p.correo) = s.correo
    union all
    select 'RFC de otra solicitud pendiente (' || o.nombre || ')'
      from solicitudes_alta o
     where o.organizacion_id = p_org and o.id <> p_id and o.estado = 'pendiente' and o.rfc = s.rfc);
  update solicitudes_alta set coincidencias = v, posible_duplicado = cardinality(v) > 0
   where organizacion_id = p_org and id = p_id;
end;
$$;

-- Sin sesión. Límites: 5 por IP (resumida) y 100 por organización en
-- 24 horas. Regresa el id con el que se sube la CSF.
create or replace function pedir_alta(
  p_org_slug text, p_nombre text, p_correo text, p_telefono text, p_rfc text,
  p_ref text, p_aviso_version integer, p_ip_resumen text
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_org      uuid;
  v_aviso    integer;
  v_contacto text;
  v_rfc      text := upper(regexp_replace(coalesce(p_rfc, ''), '[\s.\-]', '', 'g'));
  v_ref      uuid;
  v_id       uuid;
begin
  select o.id, nullif(a.aviso_version, 0),
         coalesce(nullif(trim(a.contacto_soporte), ''), (select nullif(trim(contacto_soporte), '') from ajustes_plataforma))
    into v_org, v_aviso, v_contacto
    from organizaciones o left join ajustes a on a.organizacion_id = o.id
   where o.slug = p_org_slug and o.activa;
  if v_org is null then
    raise exception 'Esta liga de alta no existe';
  end if;
  if v_aviso is null then
    raise exception 'Esta organización todavía no recibe solicitudes';
  end if;
  if p_aviso_version is distinct from v_aviso then
    raise exception 'El aviso de privacidad cambió mientras llenabas el formulario: recarga la página y revísalo';
  end if;
  perform validar_datos_alta(p_nombre, p_correo, p_telefono, v_rfc);
  if not rfc_valido(v_rfc) then
    raise exception 'Revisa tu RFC.%', coalesce(' Si está bien escrito, escríbenos a ' || v_contacto || '.', '');
  end if;
  if (select count(*) from solicitudes_alta
       where ip_resumen = p_ip_resumen and creada_en > now() - interval '24 hours') >= 5
     or (select count(*) from solicitudes_alta
          where organizacion_id = v_org and capturada_por is null and creada_en > now() - interval '24 hours') >= 100 then
    raise exception 'Recibimos demasiadas solicitudes desde aquí. Inténtalo mañana';
  end if;

  select c.persona_id into v_ref
    from comisionistas c join membresias m on m.persona_id = c.persona_id and m.organizacion_id = c.organizacion_id and m.activa
   where c.organizacion_id = v_org and c.slug = lower(trim(p_ref));

  insert into solicitudes_alta (organizacion_id, nombre, correo, telefono, rfc, referidor_id,
                                aviso_version, aviso_aceptado_en, ip_resumen)
  values (v_org, trim(p_nombre), lower(trim(p_correo)), limpiar_telefono(p_telefono), v_rfc, v_ref,
          v_aviso, now(), p_ip_resumen)
  returning id into v_id;
  return v_id;
end;
$$;

-- Finanzas o admin_org, en nombre de alguien. Si el dígito del RFC no
-- cuadra se captura igual, marcada "RFC por revisar". El aviso lo acepta
-- la persona en su primer acceso, con los términos.
create or replace function capturar_alta(
  p_nombre text, p_correo text, p_telefono text, p_rfc text, p_ref text
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_rfc text := upper(regexp_replace(coalesce(p_rfc, ''), '[\s.\-]', '', 'g'));
  v_ref uuid;
  v_id  uuid;
begin
  if not soy_staff() then
    raise exception 'Solo finanzas o admin_org capturan solicitudes de alta';
  end if;
  perform validar_datos_alta(p_nombre, p_correo, p_telefono, v_rfc);
  select persona_id into v_ref from comisionistas where organizacion_id = mi_org() and slug = lower(trim(p_ref));
  insert into solicitudes_alta (organizacion_id, nombre, correo, telefono, rfc, referidor_id, capturada_por, rfc_por_revisar)
  values (mi_org(), trim(p_nombre), lower(trim(p_correo)), limpiar_telefono(p_telefono), v_rfc, v_ref,
          mi_persona_id(), not rfc_valido(v_rfc))
  returning id into v_id;
  return v_id;
end;
$$;

-- La política del bucket: solo la CSF de una solicitud que está
-- subiendo y tiene menos de 30 minutos, en su ruta exacta.
create or replace function alta_admite_csf(p_name text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from solicitudes_alta s
                  where s.estado = 'subiendo' and s.creada_en > now() - interval '30 minutes'
                    and p_name = s.organizacion_id || '/' || s.id || '/csf.pdf');
$$;

-- Ya subió la CSF: pasa a pendiente y se buscan coincidencias.
create or replace function confirmar_alta(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  s solicitudes_alta;
  v_ruta text;
begin
  select * into s from solicitudes_alta where id = p_id and estado = 'subiendo' for update;
  if not found then
    raise exception 'Esa solicitud ya no está esperando su constancia';
  end if;
  v_ruta := s.organizacion_id || '/' || s.id || '/csf.pdf';
  if not exists (select 1 from storage.objects where bucket_id = 'altas' and name = v_ruta) then
    raise exception 'No llegó la constancia: vuelve a subirla';
  end if;
  update solicitudes_alta set estado = 'pendiente', csf_ruta = v_ruta where organizacion_id = s.organizacion_id and id = p_id;
  perform marcar_coincidencias(s.organizacion_id, p_id);
end;
$$;

-- ------------------------------------------------------------
-- 4. ALTA (directa o por solicitud)
-- ------------------------------------------------------------

-- La que hace el trabajo. Nadie la alcanza desde el navegador.
create or replace function ejecutar_alta_comisionista(
  p_org uuid, p_nombre text, p_correo text, p_telefono text, p_rfc text, p_slug text,
  p_referido_por uuid, p_emite_factura boolean, p_bienvenida boolean, p_meses_bienvenida integer,
  p_csf_ruta text, p_rfc_revisado boolean
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id    uuid;
  v_corr  text := lower(trim(p_correo));
begin
  if nullif(trim(p_nombre), '') is null then
    raise exception 'Falta el nombre';
  end if;
  if v_corr !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'El correo no es válido';
  end if;
  if exists (select 1 from comisionistas where organizacion_id = p_org and slug = p_slug) then
    raise exception 'Esa liga (slug) ya la usa otra persona';
  end if;
  if p_rfc_revisado and p_csf_ruta is null then
    raise exception 'Con "RFC revisado a mano" hace falta la CSF';
  end if;

  select id into v_id from personas where lower(correo) = v_corr;
  if v_id is null then
    insert into personas (nombre, correo, telefono, organizacion_activa)
    values (trim(p_nombre), v_corr, nullif(trim(p_telefono), ''), p_org)
    returning id into v_id;
    update personas p set user_id = u.id
      from auth.users u
     where p.id = v_id and lower(u.email) = v_corr
       and not exists (select 1 from personas o where o.user_id = u.id);
  elsif exists (select 1 from membresias where persona_id = v_id and organizacion_id = p_org) then
    raise exception 'Ese correo ya está dado de alta en esta organización';
  end if;

  insert into membresias (persona_id, organizacion_id, rol) values (v_id, p_org, 'comisionista');
  insert into comisionistas (organizacion_id, persona_id, slug, rfc, rfc_revisado_a_mano, referido_por, emite_factura,
                             csf_ruta, csf_subida_en)
  values (p_org, v_id, p_slug, upper(trim(p_rfc)), coalesce(p_rfc_revisado, false), p_referido_por,
          coalesce(p_emite_factura, false), p_csf_ruta, case when p_csf_ruta is not null then now() end);

  -- Todo alta nace con su trato: bienvenida si se pidió; si no, arranque.
  perform poner_trato_inicial(v_id, case when coalesce(p_bienvenida, false) then 'bienvenida' else 'arranque' end,
                              case when coalesce(p_bienvenida, false) then p_meses_bienvenida end, hoy_mx());
  return v_id;
end;
$$;

drop function alta_comisionista(text, text, text, text, text, uuid, boolean, boolean, integer);

-- Alta directa (e importación): solo admin_org. CSF o "CSF pendiente".
create function alta_comisionista(
  p_nombre text, p_correo text, p_telefono text, p_rfc text, p_slug text,
  p_referido_por uuid, p_emite_factura boolean,
  p_bienvenida boolean default false, p_meses_bienvenida integer default null,
  p_csf_ruta text default null, p_rfc_revisado boolean default false
) returns uuid language plpgsql security definer set search_path = public as $$
begin
  if not soy_admin_org() then
    raise exception 'Solo admin_org da de alta comisionistas directamente; finanzas captura una solicitud de alta';
  end if;
  if p_csf_ruta is not null and p_csf_ruta not like mi_org() || '/directa/%' then
    raise exception 'La CSF no es de esta organización';
  end if;
  return ejecutar_alta_comisionista(mi_org(), p_nombre, p_correo, p_telefono, p_rfc, p_slug, p_referido_por,
                                    p_emite_factura, p_bienvenida, p_meses_bienvenida, p_csf_ruta,
                                    coalesce(p_rfc_revisado, false) and not rfc_valido(upper(trim(p_rfc))));
end;
$$;

create or replace function aprobar_alta(
  p_id uuid, p_slug text, p_emite_factura boolean, p_bienvenida boolean,
  p_meses_bienvenida integer, p_rfc_revisado boolean
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  s          solicitudes_alta;
  v_revisado boolean;
  v_id       uuid;
begin
  if not soy_admin_org() then
    raise exception 'Solo admin_org aprueba solicitudes de alta';
  end if;
  select * into s from solicitudes_alta where organizacion_id = mi_org() and id = p_id for update;
  if not found then
    raise exception 'No existe esa solicitud';
  end if;
  if s.estado <> 'pendiente' then
    raise exception 'Esa solicitud ya no está pendiente';
  end if;
  if s.csf_ruta is null then
    raise exception 'La solicitud no tiene CSF';
  end if;
  v_revisado := not rfc_valido(s.rfc);
  if v_revisado and not coalesce(p_rfc_revisado, false) then
    raise exception 'El dígito verificador del RFC no cuadra: marca "RFC revisado a mano" si ya lo comprobaste con la CSF';
  end if;

  v_id := ejecutar_alta_comisionista(s.organizacion_id, s.nombre, s.correo, s.telefono, s.rfc, p_slug, s.referidor_id,
                                     p_emite_factura, p_bienvenida, p_meses_bienvenida, s.csf_ruta, v_revisado);
  update solicitudes_alta
     set estado = 'aprobada', decidida_por = mi_persona_id(), decidida_en = now(), persona_id = v_id,
         rfc_revisado_a_mano = v_revisado
   where organizacion_id = s.organizacion_id and id = p_id;
  return v_id;
end;
$$;

create or replace function rechazar_alta(p_id uuid, p_motivo text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not soy_admin_org() then
    raise exception 'Solo admin_org rechaza solicitudes de alta';
  end if;
  update solicitudes_alta
     set estado = 'rechazada', decidida_por = mi_persona_id(), decidida_en = now(), motivo = nullif(trim(p_motivo), '')
   where organizacion_id = mi_org() and id = p_id and estado = 'pendiente';
  if not found then
    raise exception 'Esa solicitud ya no está pendiente';
  end if;
end;
$$;

-- Lo que pasó con el correo de bienvenida o rechazo (nulo = se envió).
create or replace function registrar_correo_alta(p_id uuid, p_error text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not soy_admin_org() then
    raise exception 'Solo admin_org';
  end if;
  update solicitudes_alta
     set correo_enviado_en = case when p_error is null then now() end, correo_error = p_error
   where organizacion_id = mi_org() and id = p_id;
end;
$$;

-- El comisionista con "CSF pendiente" la sube desde su inicio.
create or replace function subir_mi_csf(p_ruta text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if mi_rol() is distinct from 'comisionista' then
    raise exception 'Solo el comisionista sube su constancia';
  end if;
  if p_ruta not like mi_org() || '/' || mi_persona_id() || '/%.pdf'
     or not exists (select 1 from storage.objects where bucket_id = 'altas' and name = p_ruta) then
    raise exception 'No llegó la constancia: vuelve a subirla';
  end if;
  update comisionistas set csf_ruta = p_ruta, csf_subida_en = now()
   where organizacion_id = mi_org() and persona_id = mi_persona_id();
end;
$$;

-- ------------------------------------------------------------
-- 5. LIMPIEZA (la corre /api/cron con la llave del servidor)
-- ------------------------------------------------------------

-- CSF de solicitudes rechazadas hace 90 días o más.
create or replace function csf_por_borrar()
returns table (organizacion_id uuid, id uuid, ruta text) language sql stable security definer set search_path = public as $$
  select s.organizacion_id, s.id, s.csf_ruta from solicitudes_alta s
   where s.estado = 'rechazada' and s.csf_ruta is not null and s.decidida_en <= now() - interval '90 days';
$$;

create or replace function marcar_csf_borrada(p_id uuid)
returns void language sql security definer set search_path = public as $$
  update solicitudes_alta set csf_ruta = null, csf_borrada_en = now() where id = p_id and estado = 'rechazada';
$$;

-- Solicitudes que nunca terminaron de subir su CSF.
create or replace function borrar_altas_abandonadas()
returns integer language sql security definer set search_path = public as $$
  with b as (delete from solicitudes_alta where estado = 'subiendo' and creada_en < now() - interval '1 day' returning 1)
  select count(*)::integer from b;
$$;

-- ------------------------------------------------------------
-- 6. STORAGE: BUCKET PRIVADO `altas`
-- ------------------------------------------------------------
--   {org}/{solicitud}/csf.pdf   la de una solicitud (anon o finanzas)
--   {org}/directa/{uuid}.pdf    la de un alta directa (admin_org)
--   {org}/{persona}/{uuid}.pdf  la que sube el comisionista con "CSF pendiente"

insert into storage.buckets (id, name, public) values ('altas', 'altas', false)
on conflict (id) do nothing;

create policy altas_solicitud on storage.objects
  for insert to anon, authenticated
  with check (bucket_id = 'altas' and public.alta_admite_csf(name));

create policy altas_directa on storage.objects
  for insert to authenticated
  with check (bucket_id = 'altas'
              and (storage.foldername(name))[1] = (select public.mi_org())::text
              and (storage.foldername(name))[2] = 'directa'
              and (select public.soy_admin_org()));

create policy altas_propia on storage.objects
  for insert to authenticated
  with check (bucket_id = 'altas'
              and (storage.foldername(name))[1] = (select public.mi_org())::text
              and (storage.foldername(name))[2] = (select public.mi_persona_id())::text
              and (select public.mi_rol()) = 'comisionista');

create policy altas_leer on storage.objects
  for select to authenticated
  using (bucket_id = 'altas'
         and (storage.foldername(name))[1] = (select public.mi_org())::text
         and (select public.mi_rol()) in ('admin_org', 'finanzas'));

-- ------------------------------------------------------------
-- 7. PERMISOS
-- ------------------------------------------------------------

revoke all on function
  rfc_digito(text), rfc_valido(text), revisar_rfc_comisionista(), versionar_aviso(),
  aceptar_terminos(integer), aviso_privacidad_publico(text), datos_alta_publica(text),
  limpiar_telefono(text), validar_datos_alta(text, text, text, text), marcar_coincidencias(uuid, uuid),
  pedir_alta(text, text, text, text, text, text, integer, text), capturar_alta(text, text, text, text, text),
  alta_admite_csf(text), confirmar_alta(uuid),
  ejecutar_alta_comisionista(uuid, text, text, text, text, text, uuid, boolean, boolean, integer, text, boolean),
  alta_comisionista(text, text, text, text, text, uuid, boolean, boolean, integer, text, boolean),
  aprobar_alta(uuid, text, boolean, boolean, integer, boolean), rechazar_alta(uuid, text),
  registrar_correo_alta(uuid, text), subir_mi_csf(text),
  csf_por_borrar(), marcar_csf_borrada(uuid), borrar_altas_abandonadas()
  from public, anon;

-- Lo que se usa sin sesión: la pantalla de alta, la política del bucket
-- y el aviso público. Ninguna lee una tabla para anon.
grant execute on function
  aviso_privacidad_publico(text), datos_alta_publica(text),
  pedir_alta(text, text, text, text, text, text, integer, text), alta_admite_csf(text), confirmar_alta(uuid)
  to anon, authenticated;

grant execute on function
  rfc_digito(text), rfc_valido(text), aceptar_terminos(integer), capturar_alta(text, text, text, text, text),
  alta_comisionista(text, text, text, text, text, uuid, boolean, boolean, integer, text, boolean),
  aprobar_alta(uuid, text, boolean, boolean, integer, boolean), rechazar_alta(uuid, text),
  registrar_correo_alta(uuid, text), subir_mi_csf(text)
  to authenticated;

grant execute on function csf_por_borrar(), marcar_csf_borrada(uuid), borrar_altas_abandonadas() to service_role;
