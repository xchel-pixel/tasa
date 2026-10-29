-- ============================================================
-- 0035 — % Y VIGENCIA DEL BONO DE REFERIDO DEL EQUIPO
--
-- Solo configuración (el cálculo del bono va en su fase). Por persona
-- del equipo, junto al interruptor de 0028:
--
-- - `bono_referido_pct`: % fijo de 0 a 5, dos decimales. Vacío: la escala
--   normal de comisionistas (2% a 5% según referidos activos). El % fijo
--   sustituye la escala y sigue sujeto al tope de 30% por trabajo.
-- - `bono_referido_hasta`: fecha opcional. Después de ese día ya no cobra.
--
-- Cada cambio queda en bitácora (disparador de membresias, 0015) con
-- antes/después y quién lo hizo. Solo admin_org lo cambia; finanzas lo
-- ve en Equipo; cada miembro ve el suyo en su tarjeta de invitar.
-- ============================================================

alter table membresias
  add column bono_referido_pct numeric(4,2) check (bono_referido_pct between 0 and 5),
  add column bono_referido_hasta date;

-- Con fecha vencida ya no cobra.
create or replace function miembro_cobra_bono(p_org uuid, p_persona uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select a.bono_referido_equipo from ajustes a where a.organizacion_id = p_org), false)
     and coalesce((select m.bono_referido and m.rol <> 'admin_org'
                          and (m.bono_referido_hasta is null or m.bono_referido_hasta >= hoy_mx())
                     from membresias m
                    where m.organizacion_id = p_org and m.persona_id = p_persona), false);
$$;

drop function poner_bono_referido_miembro(uuid, boolean);

create function poner_bono_referido_miembro(
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

-- Lo que ve cada miembro en su tarjeta: si cobra hoy, su % (vacío = escala) y hasta cuándo.
create or replace function mi_bono_referido()
returns table (cobra boolean, pct numeric, hasta date)
language sql stable security definer set search_path = public as $$
  select miembro_cobra_bono(m.organizacion_id, m.persona_id), m.bono_referido_pct, m.bono_referido_hasta
    from membresias m
   where m.organizacion_id = mi_org() and m.persona_id = mi_persona_id() and m.rol <> 'comisionista';
$$;

revoke all on function miembro_cobra_bono(uuid, uuid), poner_bono_referido_miembro(uuid, boolean, numeric, date),
  mi_bono_referido() from public, anon;
grant execute on function miembro_cobra_bono(uuid, uuid), poner_bono_referido_miembro(uuid, boolean, numeric, date),
  mi_bono_referido() to authenticated;
