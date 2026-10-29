-- ============================================================
-- 0032 — admin_org TAMBIÉN INVITA (solo seguimiento)
--
-- Como el equipo (0028): código, tarjeta "Invita a un comisionista" y
-- lo que invita se guarda en `referido_por_miembro`. Para admin_org el
-- bono de referido NUNCA aplica, aunque se enciendan los interruptores.
-- Si decide una solicitud que él invitó, sigue quedando
-- `decidida_por_referidor`.
-- ============================================================

create or replace function codigo_de_miembro()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.rol in ('admin_org', 'equipo', 'finanzas', 'admin_marca') and new.codigo_referido is null then
    new.codigo_referido := generar_codigo_referido();
  end if;
  return new;
end;
$$;

update membresias set codigo_referido = generar_codigo_referido()
 where rol = 'admin_org' and codigo_referido is null;

create or replace function referidor_miembro_por_codigo(p_org uuid, p_codigo text)
returns uuid language sql stable security definer set search_path = public as $$
  select m.persona_id from membresias m
   where m.organizacion_id = p_org and m.activa and m.rol in ('admin_org', 'equipo', 'finanzas', 'admin_marca')
     and m.codigo_referido = upper(trim(p_codigo));
$$;

-- admin_org nunca cobra bono de referido.
create or replace function miembro_cobra_bono(p_org uuid, p_persona uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select a.bono_referido_equipo from ajustes a where a.organizacion_id = p_org), false)
     and coalesce((select m.bono_referido and m.rol <> 'admin_org' from membresias m
                    where m.organizacion_id = p_org and m.persona_id = p_persona), false);
$$;

create or replace function poner_bono_referido_miembro(p_membresia uuid, p_activo boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not soy_admin_org() then
    raise exception 'Solo admin_org cambia el bono de referido del equipo';
  end if;
  if exists (select 1 from membresias where id = p_membresia and rol = 'admin_org') then
    raise exception 'Administración no lleva bono de referido';
  end if;
  update membresias set bono_referido = coalesce(p_activo, false)
   where id = p_membresia and organizacion_id = mi_org() and rol <> 'comisionista';
  if not found then
    raise exception 'No existe esa persona del equipo';
  end if;
end;
$$;

revoke all on function codigo_de_miembro(), referidor_miembro_por_codigo(uuid, text), miembro_cobra_bono(uuid, uuid),
  poner_bono_referido_miembro(uuid, boolean) from public, anon;
grant execute on function miembro_cobra_bono(uuid, uuid), poner_bono_referido_miembro(uuid, boolean) to authenticated;
