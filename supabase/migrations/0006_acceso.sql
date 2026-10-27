-- ============================================================
-- 0006 — ACCESO
-- El mismo esquema que Pulso: nadie se registra solo. El super_admin
-- da de alta la persona con su correo; el sistema solo amarra el
-- usuario de autenticación a esa fila. NUNCA la crea.
-- ============================================================

-- La pantalla de acceso la llama ANTES de mandar el código. Si da
-- falso, no sale correo ni nace usuario. Solo dice sí o no.
create or replace function correo_en_padron(p_correo text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from personas
     where lower(correo) = lower(trim(p_correo)) and activo
  );
$$;

revoke all on function correo_en_padron(text) from public;
grant execute on function correo_en_padron(text) to anon, authenticated;

-- Al nacer el usuario de autenticación, se amarra a su persona.
create or replace function vincular_persona()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update personas
     set user_id = new.id
   where lower(correo) = lower(new.email)
     and user_id is null
     and activo;
  return new;
end;
$$;

drop trigger if exists al_crear_usuario on auth.users;
create trigger al_crear_usuario
  after insert on auth.users
  for each row execute function vincular_persona();

-- Reparación en caliente: el usuario ya existía cuando se dio de alta
-- a la persona (el disparador solo corre al nacer el usuario).
create or replace function vincular_mi_usuario()
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_correo text;
  v_id     uuid;
begin
  select email into v_correo from auth.users where id = auth.uid();
  if v_correo is null then
    return null;
  end if;

  update personas
     set user_id = auth.uid()
   where lower(correo) = lower(v_correo)
     and user_id is null
     and activo
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function vincular_mi_usuario() from public, anon;
grant execute on function vincular_mi_usuario() to authenticated;
