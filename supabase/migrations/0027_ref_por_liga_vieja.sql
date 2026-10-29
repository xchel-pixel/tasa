-- ============================================================
-- 0027 — LA LIGA VIEJA ?ref=<slug> SIGUE FUNCIONANDO
--
-- Antes de 0026 la liga llevaba la liga personal (slug, sale del
-- nombre). Para no romper las que ya se compartieron, si el ref no es
-- un código se busca como slug. En pantalla solo se muestra la liga con
-- el código.
-- ============================================================

create or replace function referidor_por_codigo(p_org uuid, p_codigo text)
returns uuid language sql stable security definer set search_path = public as $$
  select c.persona_id
    from comisionistas c join membresias m on m.persona_id = c.persona_id and m.organizacion_id = c.organizacion_id and m.activa
   where c.organizacion_id = p_org
     and (c.codigo_referido = upper(trim(p_codigo)) or c.slug = lower(trim(p_codigo)))
   order by c.codigo_referido = upper(trim(p_codigo)) desc
   limit 1;
$$;

revoke all on function referidor_por_codigo(uuid, text) from public, anon;
