-- ============================================================
-- 0087 — "NO ES LA MISMA PERSONA: CREAR PÁGINA NUEVA"
--
-- En "Páginas de Notion por confirmar", además de ligar una de las
-- parecidas, admin_org puede decir que ninguna es esa persona: Tasa
-- crea la página con el nombre que tiene en Tasa, la liga y guarda esas
-- coincidencias como descartadas (notion_descartadas) para no volver a
-- proponerlas. Las parecidas propuestas se guardan en
-- notion_candidatos para poder ofrecerlas con un botón.
-- ============================================================

alter table comisionistas
  add column notion_candidatos   jsonb,
  add column notion_descartadas  text[] not null default '{}';

-- 0086 + no vuelve a proponer lo descartado.
create or replace function por_ligar_comisionistas_afuera(p_conector uuid)
returns table (persona_id uuid, nombre text, ligadas text[])
language sql stable security definer set search_path = public as $$
  select c.persona_id, p.nombre,
         array(select x.notion_pagina from comisionistas x where x.organizacion_id = c.organizacion_id and x.notion_pagina is not null)
         || c.notion_descartadas
    from comisionistas c join personas p on p.id = c.persona_id
    join conectores k on k.id = p_conector and k.organizacion_id = c.organizacion_id
    join membresias m on m.organizacion_id = c.organizacion_id and m.persona_id = c.persona_id and m.rol = 'comisionista'
   where puede_operar_conector(p_conector) and c.notion_pagina is null and m.activa and not m.es_demo
     and not exists (select 1 from alertas a where a.organizacion_id = c.organizacion_id and a.tipo = 'notion_pagina_propuesta'
                       and a.codigo = c.persona_id::text and a.resuelta_en is null);
$$;

-- 0086 + guarda las parecidas que propone.
create or replace function registrar_comisionista_afuera(p_conector uuid, p_persona uuid, p_pagina text, p_nombre_pagina text,
                                                         p_candidatos jsonb, p_error text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_org    uuid;
  v_nombre text := (select nombre from personas where id = p_persona);
  v_lista  text;
begin
  if not puede_operar_conector(p_conector) then
    raise exception 'Solo admin_org sincroniza el conector';
  end if;
  select c.organizacion_id into v_org from comisionistas c join conectores k on k.id = p_conector and k.organizacion_id = c.organizacion_id
   where c.persona_id = p_persona and c.notion_pagina is null for update of c;
  if not found then
    return;
  end if;
  if p_error is null and p_pagina is not null then
    perform set_config('tasa.motivo', 'Notion: página creada y ligada: ' || coalesce(p_nombre_pagina, p_pagina), true);
    update comisionistas set notion_pagina = replace(lower(p_pagina), '-', ''), notion_nombre = left(p_nombre_pagina, 200),
           notion_alta_pendiente = false, notion_candidatos = null
     where organizacion_id = v_org and persona_id = p_persona;
  else
    perform set_config('tasa.motivo', case when p_error is not null then 'Notion no creó su página: ' || p_error
                                           else 'Notion: páginas parecidas por confirmar' end, true);
    update comisionistas set notion_alta_pendiente = false,
           notion_candidatos = case when p_error is null then coalesce(p_candidatos, '[]') end
     where organizacion_id = v_org and persona_id = p_persona;
    select string_agg('"' || (c ->> 'nombre') || '"', ', ') into v_lista from jsonb_array_elements(coalesce(p_candidatos, '[]')) c;
    insert into alertas (organizacion_id, tipo, codigo, mensaje)
    values (v_org, 'notion_pagina_propuesta', p_persona::text,
            case when p_error is not null
                 then 'No se pudo crear la página de Notion de ' || v_nombre || ' (' || p_error || '). Lígala o créala en su ficha.'
                 else 'Página de Notion por confirmar: ' || v_nombre || '. En Ext Comisionistas ya hay ' || coalesce(v_lista, '') ||
                      '. Confirma en su ficha cuál es (o créala).' end)
    on conflict do nothing;
  end if;
  perform set_config('tasa.motivo', '', true);
end;
$$;

-- Las propuestas abiertas con sus parecidas, para los botones de Alertas (admin_org).
create or replace function propuestas_notion()
returns table (persona_id uuid, nombre text, candidatos jsonb)
language plpgsql stable security definer set search_path = public as $$
begin
  if not soy_admin_org() then
    raise exception 'Solo admin_org';
  end if;
  return query
  select c.persona_id, p.nombre, coalesce(c.notion_candidatos, '[]')
    from comisionistas c join personas p on p.id = c.persona_id
   where c.organizacion_id = mi_org() and c.notion_pagina is null
     and exists (select 1 from alertas a where a.organizacion_id = c.organizacion_id and a.tipo = 'notion_pagina_propuesta'
                   and a.codigo = c.persona_id::text and a.resuelta_en is null);
end;
$$;

-- "No es la misma persona": liga la página nueva (ya creada en Notion con su nombre de Tasa) y descarta las parecidas.
create or replace function ligar_pagina_nueva_descartando(p_persona uuid, p_pagina text, p_nombre text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_pagina text := nullif(replace(lower(trim(coalesce(p_pagina, ''))), '-', ''), '');
  c        comisionistas;
  v_desc   text[];
  v_lista  text;
begin
  if not soy_admin_org() then
    raise exception 'Solo admin_org liga comisionistas con Notion';
  end if;
  if v_pagina is null or v_pagina !~ '^[0-9a-f]{32}$' then
    raise exception 'Esa no es una página de Notion';
  end if;
  select * into c from comisionistas where organizacion_id = mi_org() and persona_id = p_persona for update;
  if not found then
    raise exception 'No existe ese comisionista';
  end if;
  if exists (select 1 from comisionistas where organizacion_id = mi_org() and notion_pagina = v_pagina and persona_id <> p_persona) then
    raise exception 'Esa página de Notion ya está ligada a otro comisionista';
  end if;
  select array_agg(x ->> 'id'), string_agg('"' || (x ->> 'nombre') || '"', ', ')
    into v_desc, v_lista from jsonb_array_elements(coalesce(c.notion_candidatos, '[]')) x;
  perform set_config('tasa.motivo', 'Notion: no es la misma persona que ' || coalesce(v_lista, 'las parecidas')
                                    || '; página nueva: ' || coalesce(trim(p_nombre), v_pagina), true);
  update comisionistas
     set notion_pagina = v_pagina, notion_nombre = left(trim(p_nombre), 200), notion_alta_pendiente = false, notion_candidatos = null,
         notion_descartadas = array(select distinct d from unnest(notion_descartadas || coalesce(v_desc, '{}')) d where d is not null)
   where organizacion_id = mi_org() and persona_id = p_persona;
  update alertas set resuelta_en = now(), resuelta_por = mi_persona_id(), resolucion = 'No es la misma persona: página nueva creada y ligada'
   where organizacion_id = mi_org() and tipo in ('notion_sin_pagina', 'notion_pagina_propuesta')
     and codigo = p_persona::text and resuelta_en is null;
  perform set_config('tasa.motivo', '', true);
end;
$$;

revoke all on function propuestas_notion(), ligar_pagina_nueva_descartando(uuid, text, text) from public, anon;
grant execute on function propuestas_notion(), ligar_pagina_nueva_descartando(uuid, text, text) to authenticated;

-- 0085 + ligar a mano también limpia las parecidas propuestas.
create or replace function ligar_pagina_notion(p_persona uuid, p_pagina text, p_nombre text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_pagina text := nullif(replace(lower(trim(coalesce(p_pagina, ''))), '-', ''), '');
begin
  if not soy_admin_org() then
    raise exception 'Solo admin_org liga comisionistas con Notion';
  end if;
  if v_pagina is not null and v_pagina !~ '^[0-9a-f]{32}$' then
    raise exception 'Esa no es una página de Notion';
  end if;
  if v_pagina is not null and exists (select 1 from comisionistas where organizacion_id = mi_org()
                                         and notion_pagina = v_pagina and persona_id <> p_persona) then
    raise exception 'Esa página de Notion ya está ligada a otro comisionista';
  end if;
  perform set_config('tasa.motivo', case when v_pagina is null then 'Página en Notion: quitada'
                                         else 'Página en Notion: ' || coalesce(trim(p_nombre), v_pagina) end, true);
  update comisionistas set notion_pagina = v_pagina, notion_nombre = case when v_pagina is not null then left(trim(p_nombre), 200) end,
         notion_alta_pendiente = false, notion_candidatos = case when v_pagina is not null then null else notion_candidatos end
   where organizacion_id = mi_org() and persona_id = p_persona;
  if not found then
    raise exception 'No existe ese comisionista';
  end if;
  if v_pagina is not null then
    update alertas set resuelta_en = now(), resuelta_por = mi_persona_id(), resolucion = 'Página en Notion ligada'
     where organizacion_id = mi_org() and tipo in ('notion_sin_pagina', 'notion_pagina_propuesta')
       and codigo = p_persona::text and resuelta_en is null;
  end if;
  perform set_config('tasa.motivo', '', true);
end;
$$;
