-- ============================================================
-- 0042 — CONVENIO EN UNA SOLA PANTALLA
--
-- Cada precio del convenio ahora dice su tipo (fijo, sin costo o
-- estimado, con rango opcional) y una nota ("sin costo si contrata el
-- avalúo"). `sin_costo` se conserva y se deriva del tipo, para que el
-- código anterior siga leyendo y escribiendo mientras se publica el
-- nuevo.
--
-- `guardar_convenio` guarda los datos y todos los precios juntos, en
-- una transacción: si algo no cuadra, no se guarda nada y regresa un
-- mensaje en español. Corre con los permisos de quien llama (RLS): solo
-- admin_org.
-- ============================================================

alter table convenio_precios
  add column honorario_tipo text not null default 'fijo' check (honorario_tipo in ('fijo', 'sin_costo', 'estimado')),
  add column monto_minimo   numeric(12,2) check (monto_minimo >= 0),
  add column nota           text check (char_length(nota) <= 200);
update convenio_precios set honorario_tipo = 'sin_costo' where sin_costo;
alter table convenio_precios add constraint convenio_precios_minimo
  check (monto_minimo is null or (honorario_tipo = 'estimado' and monto_minimo <= monto));

-- El tipo manda; `sin_costo` lo sigue. El código anterior solo escribe `sin_costo`: se respeta.
create or replace function tipo_de_precio_convenio()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.sin_costo and new.honorario_tipo <> 'sin_costo'
     and (tg_op = 'INSERT' or new.honorario_tipo is not distinct from old.honorario_tipo) then
    new.honorario_tipo := 'sin_costo';
  end if;
  new.sin_costo := (new.honorario_tipo = 'sin_costo');
  if new.sin_costo then
    new.monto := 0;
  end if;
  return new;
end;
$$;
revoke all on function tipo_de_precio_convenio() from public, anon, authenticated;
create trigger al_guardar_precio before insert or update on convenio_precios
  for each row execute function tipo_de_precio_convenio();

-- p_datos: {nombre, contacto, notas, vigente_desde, vigente_hasta, comision_regla, comision_pct, activo}
-- p_precios: [{servicio_id, marca_id, honorario_tipo, monto, monto_minimo, nota}] — solo los incluidos;
-- los que ya no vienen se quitan.
create or replace function guardar_convenio(p_id uuid, p_datos jsonb, p_precios jsonb)
returns uuid language plpgsql security invoker set search_path = public as $$
declare
  v_id    uuid := p_id;
  v_regla text := coalesce(p_datos->>'comision_regla', 'normal');
  v_pct   numeric;
  v_desde date;
  v_hasta date;
  p       jsonb;
  v_tipo  text;
  v_monto numeric;
  v_min   numeric;
  v_serv  text;
begin
  if not soy_admin_org() then
    raise exception 'Solo administración edita los convenios';
  end if;
  if char_length(trim(coalesce(p_datos->>'nombre', ''))) < 2 then
    raise exception 'Escribe el nombre del cliente o empresa';
  end if;
  if v_regla not in ('normal', 'ninguna', 'fija') then
    raise exception 'Elige si el convenio genera comisión';
  end if;
  if v_regla = 'fija' then
    v_pct := nullif(p_datos->>'comision_pct', '')::numeric;
    if v_pct is null or v_pct <= 0 or v_pct > 100 then
      raise exception 'El %% fijo de comisión va de 0.01 a 100';
    end if;
  end if;
  begin
    v_desde := nullif(p_datos->>'vigente_desde', '')::date;
    v_hasta := nullif(p_datos->>'vigente_hasta', '')::date;
  exception when others then
    raise exception 'Revisa las fechas de vigencia';
  end;
  if v_desde is not null and v_hasta is not null and v_hasta < v_desde then
    raise exception 'La vigencia termina antes de empezar';
  end if;
  if jsonb_typeof(coalesce(p_precios, '[]'::jsonb)) <> 'array' then
    raise exception 'Los precios no llegaron bien; vuelve a intentarlo';
  end if;

  if v_id is null then
    insert into convenios (nombre, contacto, notas, vigente_desde, vigente_hasta, comision_regla, comision_pct)
    values (trim(p_datos->>'nombre'), nullif(trim(p_datos->>'contacto'), ''), nullif(trim(p_datos->>'notas'), ''),
            v_desde, v_hasta, v_regla, case when v_regla = 'fija' then round(v_pct, 2) end)
    returning id into v_id;
  else
    update convenios
       set nombre = trim(p_datos->>'nombre'), contacto = nullif(trim(p_datos->>'contacto'), ''),
           notas = nullif(trim(p_datos->>'notas'), ''), vigente_desde = v_desde, vigente_hasta = v_hasta,
           comision_regla = v_regla, comision_pct = case when v_regla = 'fija' then round(v_pct, 2) end,
           activo = coalesce((p_datos->>'activo')::boolean, activo)
     where id = v_id and organizacion_id = mi_org();
    if not found then
      raise exception 'Ese convenio ya no existe';
    end if;
  end if;

  -- Los precios que ya no vienen se quitan; los que vienen se agregan o reemplazan.
  delete from convenio_precios cp
   where cp.convenio_id = v_id
     and not exists (select 1 from jsonb_array_elements(p_precios) x
                      where (x->>'servicio_id')::uuid = cp.servicio_id);

  for p in select * from jsonb_array_elements(p_precios) loop
    select nombre into v_serv from servicios where id = (p->>'servicio_id')::uuid and organizacion_id = mi_org();
    if v_serv is null then
      raise exception 'Un servicio del convenio ya no existe; recarga la página';
    end if;
    v_tipo := coalesce(p->>'honorario_tipo', 'fijo');
    v_monto := case when v_tipo = 'sin_costo' then 0 else nullif(p->>'monto', '')::numeric end;
    v_min := case when v_tipo = 'estimado' then nullif(p->>'monto_minimo', '')::numeric end;
    if v_tipo not in ('fijo', 'sin_costo', 'estimado') then
      raise exception '%: elige el tipo (fijo, sin costo o estimado)', v_serv;
    end if;
    if v_tipo <> 'sin_costo' and (v_monto is null or v_monto <= 0) then
      raise exception '%: escribe el precio (mayor a cero) o márcalo sin costo', v_serv;
    end if;
    if v_min is not null and (v_min < 0 or v_min > v_monto) then
      raise exception '%: el mínimo del rango va de cero al máximo', v_serv;
    end if;
    if char_length(coalesce(p->>'nota', '')) > 200 then
      raise exception '%: la nota va hasta 200 caracteres', v_serv;
    end if;

    delete from convenio_precios where convenio_id = v_id and servicio_id = (p->>'servicio_id')::uuid;
    insert into convenio_precios (convenio_id, servicio_id, marca_id, honorario_tipo, sin_costo, monto, monto_minimo, nota)
    values (v_id, (p->>'servicio_id')::uuid, nullif(p->>'marca_id', '')::uuid, v_tipo, v_tipo = 'sin_costo',
            round(coalesce(v_monto, 0), 2), round(v_min, 2), nullif(trim(p->>'nota'), ''));
  end loop;

  return v_id;
end;
$$;
revoke all on function guardar_convenio(uuid, jsonb, jsonb) from public, anon;
grant execute on function guardar_convenio(uuid, jsonb, jsonb) to authenticated;
