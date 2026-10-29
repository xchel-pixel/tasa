-- ============================================================
-- 0031 — GUARDAR LA CREDENCIAL DE UN CONECTOR: CREAR O ACTUALIZAR
--
-- El reset a producción borró las tablas pero no Vault: el secreto
-- "conector_<id>" de pruebas seguía ahí y, como los conectores de XG
-- nacen con el mismo id, crear otro chocaba con el nombre único
-- ("secrets_name_idx"). Ahora, si ya existe un secreto con ese nombre, se
-- actualiza y se amarra al conector. Vale para cualquier conector que
-- guarde credencial (Notion, Sheets, webhook).
-- ============================================================

create or replace function guardar_credencial_conector(p_conector uuid, p_valor text)
returns void language plpgsql security definer set search_path = public as $$
declare
  c        conectores%rowtype;
  v_nombre text;
  v_id     uuid;
begin
  if not soy_admin_org() then
    raise exception 'Solo admin_org guarda credenciales';
  end if;
  select * into c from conectores where id = p_conector and organizacion_id = mi_org() for update;
  if not found then
    raise exception 'No existe ese conector';
  end if;
  if c.tipo = 'manual' then
    raise exception 'El conector manual no usa credencial';
  end if;
  if nullif(trim(p_valor), '') is null then
    raise exception 'Escribe la credencial';
  end if;

  v_nombre := 'conector_' || c.id::text;
  -- El que ya tiene amarrado o, si no, uno que haya quedado con su nombre.
  select id into v_id from vault.secrets where id = c.credencial_id;
  if v_id is null then
    select id into v_id from vault.secrets where name = v_nombre;
  end if;

  if v_id is null then
    v_id := vault.create_secret(trim(p_valor), v_nombre, 'Credencial del conector ' || c.tipo);
  else
    perform vault.update_secret(v_id, trim(p_valor));
  end if;
  update conectores set credencial_id = v_id, credencial_guardada_en = now() where id = c.id;
end;
$$;

revoke all on function guardar_credencial_conector(uuid, text) from public, anon;
grant execute on function guardar_credencial_conector(uuid, text) to authenticated;
