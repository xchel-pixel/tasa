-- ============================================================
-- 0025 — SOLICITUD DE ALTA: CSF OPCIONAL Y RFC O CURP
--
-- 1. Lo obligatorio de una solicitud: nombre, correo, teléfono y RFC o
--    CURP (uno de los dos). La CSF es opcional: sin ella la solicitud
--    queda "CSF pendiente" y admin_org puede aprobarla igual.
-- 2. El comisionista guarda su CURP si la dio. Uno que llegó solo con
--    CURP queda sin RFC; el alta directa y la importación siguen
--    pidiendo RFC.
-- 3. "RFC revisado a mano" sigue exigiendo la CSF: es contra ella que
--    se revisa.
-- 4. Coincidencias también por CURP.
-- ============================================================

-- La CURP: 18 caracteres (4 letras, fecha AAMMDD, sexo H/M/X, 5 letras,
-- homoclave y dígito). Solo formato: el dígito verificador no se revisa.
create or replace function curp_valida(p_curp text)
returns boolean language sql immutable as $$
  select coalesce(p_curp ~ '^[A-Z]{4}[0-9]{6}[HMX][A-Z]{5}[A-Z0-9][0-9]$', false);
$$;

alter table solicitudes_alta
  alter column rfc drop not null,
  add column curp text check (curp is null or curp_valida(curp)),
  add constraint solicitudes_alta_rfc_o_curp check (rfc is not null or curp is not null);

alter table comisionistas
  add column curp text check (curp is null or curp_valida(curp));

create or replace function revisar_rfc_comisionista()
returns trigger language plpgsql as $$
begin
  new.rfc := nullif(upper(trim(new.rfc)), '');
  new.curp := nullif(upper(trim(new.curp)), '');
  if new.rfc is null and new.curp is null then
    raise exception 'El RFC es obligatorio (o la CURP, si llegó por solicitud)';
  end if;
  -- Cambiar el RFC pierde la revisión a mano: el nuevo tiene que cuadrar.
  if tg_op = 'UPDATE' and new.rfc is distinct from old.rfc and new.rfc_revisado_a_mano = old.rfc_revisado_a_mano then
    new.rfc_revisado_a_mano := false;
  end if;
  if new.rfc is not null and not new.rfc_revisado_a_mano and not rfc_valido(new.rfc) then
    raise exception 'El RFC no es válido: revisa el dígito verificador (el último carácter)';
  end if;
  return new;
end;
$$;

drop trigger al_guardar_rfc on comisionistas;
create trigger al_guardar_rfc
  before insert or update of rfc, rfc_revisado_a_mano, curp on comisionistas
  for each row execute function revisar_rfc_comisionista();

-- ------------------------------------------------------------
-- VALIDACIÓN Y COINCIDENCIAS
-- ------------------------------------------------------------

drop function validar_datos_alta(text, text, text, text);

create function validar_datos_alta(p_nombre text, p_correo text, p_telefono text, p_rfc text, p_curp text)
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
  if p_rfc is null and p_curp is null then
    raise exception 'Escribe tu RFC o tu CURP (uno de los dos)';
  end if;
  if p_rfc is not null and p_rfc !~ '^[A-ZÑ&]{3,4}[0-9]{6}[A-Z0-9]{3}$' then
    raise exception 'El RFC no tiene el formato correcto: letras, fecha AAMMDD y homoclave';
  end if;
  if p_curp is not null and not curp_valida(p_curp) then
    raise exception 'La CURP no tiene el formato correcto: son 18 caracteres, como aparecen en tu CURP';
  end if;
end;
$$;

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
    select 'CURP de ' || p.nombre || ' (comisionista)'
      from comisionistas c join personas p on p.id = c.persona_id
      join membresias m on m.persona_id = c.persona_id and m.organizacion_id = c.organizacion_id and m.activa
     where c.organizacion_id = p_org and c.curp = s.curp
    union all
    select 'Correo de ' || p.nombre || ' (comisionista)'
      from personas p join membresias m on m.persona_id = p.id and m.organizacion_id = p_org and m.rol = 'comisionista' and m.activa
     where lower(p.correo) = s.correo
    union all
    select 'RFC o CURP de otra solicitud pendiente (' || o.nombre || ')'
      from solicitudes_alta o
     where o.organizacion_id = p_org and o.id <> p_id and o.estado = 'pendiente'
       and (o.rfc = s.rfc or o.curp = s.curp));
  update solicitudes_alta set coincidencias = v, posible_duplicado = cardinality(v) > 0
   where organizacion_id = p_org and id = p_id;
end;
$$;

-- ------------------------------------------------------------
-- PEDIR Y CAPTURAR: con o sin CSF
-- ------------------------------------------------------------
-- Con CSF la solicitud nace "subiendo" (como en 0024: sube el archivo y
-- `confirmar_alta` la pasa a pendiente). Sin CSF nace pendiente.

drop function pedir_alta(text, text, text, text, text, text, integer, text);

create function pedir_alta(
  p_org_slug text, p_nombre text, p_correo text, p_telefono text, p_rfc text, p_curp text,
  p_ref text, p_aviso_version integer, p_ip_resumen text, p_con_csf boolean
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_org      uuid;
  v_aviso    integer;
  v_contacto text;
  v_rfc      text := nullif(upper(regexp_replace(coalesce(p_rfc, ''), '[\s.\-]', '', 'g')), '');
  v_curp     text := nullif(upper(regexp_replace(coalesce(p_curp, ''), '[\s.\-]', '', 'g')), '');
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
  perform validar_datos_alta(p_nombre, p_correo, p_telefono, v_rfc, v_curp);
  if v_rfc is not null and not rfc_valido(v_rfc) then
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

  insert into solicitudes_alta (organizacion_id, nombre, correo, telefono, rfc, curp, referidor_id,
                                aviso_version, aviso_aceptado_en, ip_resumen, estado)
  values (v_org, trim(p_nombre), lower(trim(p_correo)), limpiar_telefono(p_telefono), v_rfc, v_curp, v_ref,
          v_aviso, now(), p_ip_resumen, case when coalesce(p_con_csf, false) then 'subiendo' else 'pendiente' end)
  returning id into v_id;
  if not coalesce(p_con_csf, false) then
    perform marcar_coincidencias(v_org, v_id);
  end if;
  return v_id;
end;
$$;

drop function capturar_alta(text, text, text, text, text);

create function capturar_alta(
  p_nombre text, p_correo text, p_telefono text, p_rfc text, p_curp text, p_ref text, p_con_csf boolean
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_rfc  text := nullif(upper(regexp_replace(coalesce(p_rfc, ''), '[\s.\-]', '', 'g')), '');
  v_curp text := nullif(upper(regexp_replace(coalesce(p_curp, ''), '[\s.\-]', '', 'g')), '');
  v_ref  uuid;
  v_id   uuid;
begin
  if not soy_staff() then
    raise exception 'Solo finanzas o admin_org capturan solicitudes de alta';
  end if;
  perform validar_datos_alta(p_nombre, p_correo, p_telefono, v_rfc, v_curp);
  select persona_id into v_ref from comisionistas where organizacion_id = mi_org() and slug = lower(trim(p_ref));
  insert into solicitudes_alta (organizacion_id, nombre, correo, telefono, rfc, curp, referidor_id, capturada_por,
                                rfc_por_revisar, estado)
  values (mi_org(), trim(p_nombre), lower(trim(p_correo)), limpiar_telefono(p_telefono), v_rfc, v_curp, v_ref,
          mi_persona_id(), v_rfc is not null and not rfc_valido(v_rfc),
          case when coalesce(p_con_csf, false) then 'subiendo' else 'pendiente' end)
  returning id into v_id;
  if not coalesce(p_con_csf, false) then
    perform marcar_coincidencias(mi_org(), v_id);
  end if;
  return v_id;
end;
$$;

-- ------------------------------------------------------------
-- ALTA Y APROBACIÓN
-- ------------------------------------------------------------

drop function alta_comisionista(text, text, text, text, text, uuid, boolean, boolean, integer, text, boolean);
drop function ejecutar_alta_comisionista(uuid, text, text, text, text, text, uuid, boolean, boolean, integer, text, boolean);

create function ejecutar_alta_comisionista(
  p_org uuid, p_nombre text, p_correo text, p_telefono text, p_rfc text, p_curp text, p_slug text,
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
  insert into comisionistas (organizacion_id, persona_id, slug, rfc, curp, rfc_revisado_a_mano, referido_por, emite_factura,
                             csf_ruta, csf_subida_en)
  values (p_org, v_id, p_slug, nullif(upper(trim(p_rfc)), ''), nullif(upper(trim(p_curp)), ''), coalesce(p_rfc_revisado, false),
          p_referido_por, coalesce(p_emite_factura, false), p_csf_ruta, case when p_csf_ruta is not null then now() end);

  perform poner_trato_inicial(v_id, case when coalesce(p_bienvenida, false) then 'bienvenida' else 'arranque' end,
                              case when coalesce(p_bienvenida, false) then p_meses_bienvenida end, hoy_mx());
  return v_id;
end;
$$;

-- Alta directa (e importación): solo admin_org, con RFC. CSF o "CSF pendiente".
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
  if nullif(trim(p_rfc), '') is null then
    raise exception 'El RFC es obligatorio';
  end if;
  if p_csf_ruta is not null and p_csf_ruta not like mi_org() || '/directa/%' then
    raise exception 'La CSF no es de esta organización';
  end if;
  return ejecutar_alta_comisionista(mi_org(), p_nombre, p_correo, p_telefono, p_rfc, null, p_slug, p_referido_por,
                                    p_emite_factura, p_bienvenida, p_meses_bienvenida, p_csf_ruta,
                                    coalesce(p_rfc_revisado, false) and not rfc_valido(upper(trim(p_rfc))));
end;
$$;

-- Sin CSF también se aprueba; solo "RFC revisado a mano" la exige.
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
  v_revisado := s.rfc is not null and not rfc_valido(s.rfc);
  if v_revisado and not coalesce(p_rfc_revisado, false) then
    raise exception 'El dígito verificador del RFC no cuadra: marca "RFC revisado a mano" si ya lo comprobaste con la CSF';
  end if;
  if v_revisado and s.csf_ruta is null then
    raise exception 'Con "RFC revisado a mano" hace falta la CSF: pídesela o rechaza la solicitud';
  end if;

  v_id := ejecutar_alta_comisionista(s.organizacion_id, s.nombre, s.correo, s.telefono, s.rfc, s.curp, p_slug, s.referidor_id,
                                     p_emite_factura, p_bienvenida, p_meses_bienvenida, s.csf_ruta, v_revisado);
  update solicitudes_alta
     set estado = 'aprobada', decidida_por = mi_persona_id(), decidida_en = now(), persona_id = v_id,
         rfc_revisado_a_mano = v_revisado
   where organizacion_id = s.organizacion_id and id = p_id;
  return v_id;
end;
$$;

-- ------------------------------------------------------------
-- PERMISOS
-- ------------------------------------------------------------

revoke all on function
  curp_valida(text), validar_datos_alta(text, text, text, text, text),
  pedir_alta(text, text, text, text, text, text, text, integer, text, boolean),
  capturar_alta(text, text, text, text, text, text, boolean),
  ejecutar_alta_comisionista(uuid, text, text, text, text, text, text, uuid, boolean, boolean, integer, text, boolean),
  alta_comisionista(text, text, text, text, text, uuid, boolean, boolean, integer, text, boolean)
  from public, anon;

grant execute on function pedir_alta(text, text, text, text, text, text, text, integer, text, boolean) to anon, authenticated;
grant execute on function
  curp_valida(text), capturar_alta(text, text, text, text, text, text, boolean),
  alta_comisionista(text, text, text, text, text, uuid, boolean, boolean, integer, text, boolean)
  to authenticated;
