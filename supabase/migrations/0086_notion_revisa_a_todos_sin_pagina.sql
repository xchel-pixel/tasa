-- ============================================================
-- 0086 — EL CRON REVISA A TODO COMISIONISTA SIN PÁGINA DE NOTION
--
-- 0085 solo revisaba las altas nuevas. Ahora, en cada sincronización,
-- todo comisionista activo de la organización sin "Página en Notion"
-- (salvo cuentas de demostración) pasa por la misma regla: si en Ext
-- Comisionistas no hay nombre parecido, se crea y se liga; si lo hay,
-- se propone en Hoy. Mientras su propuesta (o su error) siga abierta
-- en Hoy, no se vuelve a buscar: se espera a que admin_org la resuelva.
-- notion_alta_pendiente queda solo como dato histórico.
-- ============================================================

create or replace function por_ligar_comisionistas_afuera(p_conector uuid)
returns table (persona_id uuid, nombre text, ligadas text[])
language sql stable security definer set search_path = public as $$
  select c.persona_id, p.nombre,
         array(select x.notion_pagina from comisionistas x where x.organizacion_id = c.organizacion_id and x.notion_pagina is not null)
    from comisionistas c join personas p on p.id = c.persona_id
    join conectores k on k.id = p_conector and k.organizacion_id = c.organizacion_id
    join membresias m on m.organizacion_id = c.organizacion_id and m.persona_id = c.persona_id and m.rol = 'comisionista'
   where puede_operar_conector(p_conector) and c.notion_pagina is null and m.activa and not m.es_demo
     and not exists (select 1 from alertas a where a.organizacion_id = c.organizacion_id and a.tipo = 'notion_pagina_propuesta'
                       and a.codigo = c.persona_id::text and a.resuelta_en is null);
$$;

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
  -- Ya ligado (a mano, entre la lectura y la escritura): no se toca.
  select c.organizacion_id into v_org from comisionistas c join conectores k on k.id = p_conector and k.organizacion_id = c.organizacion_id
   where c.persona_id = p_persona and c.notion_pagina is null for update of c;
  if not found then
    return;
  end if;
  if p_error is null and p_pagina is not null then
    perform set_config('tasa.motivo', 'Notion: página creada y ligada: ' || coalesce(p_nombre_pagina, p_pagina), true);
    update comisionistas set notion_pagina = replace(lower(p_pagina), '-', ''), notion_nombre = left(p_nombre_pagina, 200),
           notion_alta_pendiente = false
     where organizacion_id = v_org and persona_id = p_persona;
  else
    perform set_config('tasa.motivo', case when p_error is not null then 'Notion no creó su página: ' || p_error
                                           else 'Notion: páginas parecidas por confirmar' end, true);
    update comisionistas set notion_alta_pendiente = false where organizacion_id = v_org and persona_id = p_persona;
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
