-- ============================================================
-- 0084 — SIN PÁGINA DE NOTION, LA RELACIÓN NO SE TOCA
--
-- Antes, si el comisionista no tenía "Página en Notion" ligada en Tasa,
-- la sincronización escribía "Ext Comisión" (o "Ref Bono") y dejaba
-- VACÍA la relación "Ext Comisionista" (o "Ref Comisionista") del
-- trámite, aunque el equipo la hubiera puesto a mano. Ahora el conector
-- escribe solo el monto y deja la relación como esté (lib/conectores).
-- Aquí, el texto de la alerta, que sale en Hoy con el nombre.
-- ============================================================

create or replace function avisar_sin_pagina(p_org uuid, p_persona uuid, p_para text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_nombre text := (select nombre from personas where id = p_persona);
begin
  insert into alertas (organizacion_id, tipo, codigo, mensaje)
  values (p_org, 'notion_sin_pagina', p_persona::text,
          'Comisionista sin página de Notion: ' || v_nombre || '. Se escribió ' || p_para
          || ' sin tocar su relación en el trámite. Lígalo en su ficha.')
  on conflict do nothing;
end;
$$;

revoke all on function avisar_sin_pagina(uuid, uuid, text) from public, anon, authenticated;
