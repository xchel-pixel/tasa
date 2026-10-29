-- ============================================================
-- 0036 — BONO DE EQUIPO: EL % ES OBLIGATORIO
--
-- Para el equipo ya no hay respaldo a la escala de comisionistas: al
-- encender el bono de una persona hay que capturar su % (0 a 5). Sin %
-- no se guarda. Antes de esta migración no había ningún bono encendido
-- sin %, así que la restricción entra validada.
-- ============================================================

alter table membresias
  add constraint membresias_bono_con_porcentaje check (not bono_referido or bono_referido_pct is not null);

create or replace function poner_bono_referido_miembro(
  p_membresia uuid,
  p_activo    boolean,
  p_pct       numeric default null,
  p_hasta     date default null
)
returns void language plpgsql security definer set search_path = public as $$
declare
  m membresias%rowtype;
begin
  if not soy_admin_org() then
    raise exception 'Solo admin_org cambia el bono de referido del equipo';
  end if;
  select * into m from membresias
   where id = p_membresia and organizacion_id = mi_org() and rol <> 'comisionista' for update;
  if not found then
    raise exception 'No existe esa persona del equipo';
  end if;
  if m.rol = 'admin_org' then
    raise exception 'Administración no lleva bono de referido';
  end if;
  if coalesce(p_activo, false) and p_pct is null then
    raise exception 'Escribe el %% de bono (de 0 a 5) para activarlo';
  end if;
  if p_pct is not null and (p_pct < 0 or p_pct > 5 or p_pct <> round(p_pct, 2)) then
    raise exception 'El %% de bono va de 0 a 5, con hasta dos decimales';
  end if;
  if p_hasta is not null and p_hasta < hoy_mx() and p_hasta is distinct from m.bono_referido_hasta then
    raise exception 'La fecha "vigente hasta" ya pasó';
  end if;

  perform set_config('tasa.motivo', 'Bono de referido del equipo', true);
  update membresias
     set bono_referido = coalesce(p_activo, false),
         bono_referido_pct = p_pct,
         bono_referido_hasta = p_hasta
   where id = m.id;
  perform set_config('tasa.motivo', '', true);
end;
$$;

revoke all on function poner_bono_referido_miembro(uuid, boolean, numeric, date) from public, anon;
grant execute on function poner_bono_referido_miembro(uuid, boolean, numeric, date) to authenticated;
