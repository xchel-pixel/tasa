-- ============================================================
-- 0026 — CAPTURA DE REFERIDOS (solo la atribución)
--
-- El cálculo del bono es otra fase (docs/referidos-y-herramientas.md).
-- Aquí solo queda quién trajo a quién:
--
-- 1. Cada comisionista tiene un código de referido único de 6
--    caracteres, sin datos personales y sin letras que se confunden
--    (0/O, 1/I/L). Su liga: /alta/<organización>?ref=<código>.
-- 2. Una solicitud con un código válido de la misma organización guarda
--    al referidor; un código inválido, de otra organización o de la
--    misma persona (correo, RFC o CURP) se ignora sin error.
-- 3. Al aprobar, el referidor pasa al comisionista con la fecha de inicio
--    (`referido_desde`).
-- 4. admin_org asigna o corrige "Referido por" a mano, con motivo en la
--    bitácora.
-- 5. Nadie se refiere a sí mismo ni hay ciclos (A→B y B→A), en ningún
--    camino: lo revisa un trigger.
-- ============================================================

alter table comisionistas
  add column codigo_referido text check (codigo_referido ~ '^[A-HJ-KM-NP-Z2-9]{6}$'),
  add column referido_desde date;

create or replace function generar_codigo_referido()
returns text language plpgsql volatile as $$
declare
  v_letras constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  v_codigo text;
begin
  loop
    v_codigo := '';
    for i in 1..6 loop
      v_codigo := v_codigo || substr(v_letras, 1 + floor(random() * char_length(v_letras))::integer, 1);
    end loop;
    exit when not exists (select 1 from comisionistas where codigo_referido = v_codigo);
  end loop;
  return v_codigo;
end;
$$;

update comisionistas set codigo_referido = generar_codigo_referido() where codigo_referido is null;
update comisionistas set referido_desde = fecha_alta where referido_por is not null and referido_desde is null;

alter table comisionistas alter column codigo_referido set not null;
alter table comisionistas add constraint comisionistas_codigo_referido_unico unique (codigo_referido);

-- Código al nacer, y la regla de referidos en cualquier camino.
create or replace function revisar_referido()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_actual uuid;
  v_pasos  integer := 0;
begin
  if tg_op = 'INSERT' and new.codigo_referido is null then
    new.codigo_referido := generar_codigo_referido();
  end if;
  if new.referido_por is not null and (tg_op = 'INSERT' or new.referido_por is distinct from old.referido_por) then
    if new.referido_por = new.persona_id then
      raise exception 'Nadie puede referirse a sí mismo';
    end if;
    -- Subir por la cadena de quien refiere: si llega a esta persona, es un ciclo.
    v_actual := new.referido_por;
    while v_actual is not null and v_pasos < 1000 loop
      if v_actual = new.persona_id then
        raise exception 'Eso haría un ciclo de referidos (quien lo refiere fue referido por él)';
      end if;
      select referido_por into v_actual from comisionistas
       where organizacion_id = new.organizacion_id and persona_id = v_actual;
      v_pasos := v_pasos + 1;
    end loop;
  end if;
  -- Fecha de inicio del referido: el día en que queda (o cambia) el vínculo.
  if new.referido_por is null then
    new.referido_desde := null;
  elsif tg_op = 'INSERT' or new.referido_por is distinct from old.referido_por then
    new.referido_desde := hoy_mx();
  end if;
  return new;
end;
$$;

create trigger al_guardar_referido
  before insert or update of referido_por, codigo_referido on comisionistas
  for each row execute function revisar_referido();

-- El referidor de un código, solo si es de esa organización y está activo.
create or replace function referidor_por_codigo(p_org uuid, p_codigo text)
returns uuid language sql stable security definer set search_path = public as $$
  select c.persona_id
    from comisionistas c join membresias m on m.persona_id = c.persona_id and m.organizacion_id = c.organizacion_id and m.activa
   where c.organizacion_id = p_org and c.codigo_referido = upper(trim(p_codigo));
$$;

-- ¿Es la misma persona que el referidor? (correo, RFC o CURP)
create or replace function es_el_referidor(p_org uuid, p_referidor uuid, p_correo text, p_rfc text, p_curp text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from comisionistas c join personas p on p.id = c.persona_id
     where c.organizacion_id = p_org and c.persona_id = p_referidor
       and (lower(p.correo) = lower(trim(p_correo)) or c.rfc = p_rfc or c.curp = p_curp));
$$;

-- Lo que la pantalla pública muestra: "Te invitó: <nombre>". Nada si el
-- código no sirve.
create or replace function invitado_por(p_org_slug text, p_codigo text)
returns text language sql stable security definer set search_path = public as $$
  select p.nombre
    from organizaciones o
    join personas p on p.id = referidor_por_codigo(o.id, p_codigo)
   where o.slug = p_org_slug and o.activa;
$$;

-- Después de pedir o capturar: el referidor sale del código y se descarta
-- si es la misma persona. Se corre dentro de las funciones de abajo.
create or replace function atribuir_referido(p_org uuid, p_id uuid, p_codigo text)
returns void language plpgsql security definer set search_path = public as $$
declare
  s     solicitudes_alta;
  v_ref uuid;
begin
  select * into s from solicitudes_alta where organizacion_id = p_org and id = p_id;
  v_ref := referidor_por_codigo(p_org, p_codigo);
  if v_ref is not null and es_el_referidor(p_org, v_ref, s.correo, s.rfc, s.curp) then
    v_ref := null;
  end if;
  update solicitudes_alta set referidor_id = v_ref where organizacion_id = p_org and id = p_id;
end;
$$;

-- pedir_alta y capturar_alta (0025) buscaban por la liga (slug). Ahora
-- por código: se envuelven para no repetir todo su cuerpo.
alter function pedir_alta(text, text, text, text, text, text, text, integer, text, boolean) rename to pedir_alta_0025;
alter function capturar_alta(text, text, text, text, text, text, boolean) rename to capturar_alta_0025;
revoke all on function pedir_alta_0025(text, text, text, text, text, text, text, integer, text, boolean) from public, anon, authenticated;
revoke all on function capturar_alta_0025(text, text, text, text, text, text, boolean) from public, anon, authenticated;

create function pedir_alta(
  p_org_slug text, p_nombre text, p_correo text, p_telefono text, p_rfc text, p_curp text,
  p_ref text, p_aviso_version integer, p_ip_resumen text, p_con_csf boolean
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  v_id := pedir_alta_0025(p_org_slug, p_nombre, p_correo, p_telefono, p_rfc, p_curp, null, p_aviso_version, p_ip_resumen, p_con_csf);
  perform atribuir_referido((select organizacion_id from solicitudes_alta where id = v_id), v_id, p_ref);
  return v_id;
end;
$$;

create function capturar_alta(
  p_nombre text, p_correo text, p_telefono text, p_rfc text, p_curp text, p_ref text, p_con_csf boolean
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  v_id := capturar_alta_0025(p_nombre, p_correo, p_telefono, p_rfc, p_curp, null, p_con_csf);
  perform atribuir_referido(mi_org(), v_id, p_ref);
  return v_id;
end;
$$;

-- Corrección a mano (llegó por WhatsApp sin liga, o se equivocaron).
-- Nulo lo quita. El motivo queda en la bitácora.
create or replace function asignar_referidor(p_persona uuid, p_referidor uuid, p_motivo text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not soy_admin_org() then
    raise exception 'Solo admin_org asigna o corrige "Referido por"';
  end if;
  if nullif(trim(p_motivo), '') is null then
    raise exception 'Escribe el motivo';
  end if;
  if p_referidor is not null and not exists (select 1 from comisionistas where organizacion_id = mi_org() and persona_id = p_referidor) then
    raise exception 'Ese referidor no es comisionista de esta organización';
  end if;
  perform set_config('tasa.motivo', trim(p_motivo), true);
  update comisionistas set referido_por = p_referidor
   where organizacion_id = mi_org() and persona_id = p_persona;
  if not found then
    raise exception 'No existe ese comisionista';
  end if;
end;
$$;

-- El comisionista ve su propio código (lo lee de su fila por RLS) y,
-- para la tarjeta, nada más.

revoke all on function
  generar_codigo_referido(), revisar_referido(), referidor_por_codigo(uuid, text),
  es_el_referidor(uuid, uuid, text, text, text), invitado_por(text, text), atribuir_referido(uuid, uuid, text),
  pedir_alta(text, text, text, text, text, text, text, integer, text, boolean),
  capturar_alta(text, text, text, text, text, text, boolean), asignar_referidor(uuid, uuid, text)
  from public, anon;

grant execute on function invitado_por(text, text),
  pedir_alta(text, text, text, text, text, text, text, integer, text, boolean) to anon, authenticated;
grant execute on function capturar_alta(text, text, text, text, text, text, boolean), asignar_referidor(uuid, uuid, text)
  to authenticated;
