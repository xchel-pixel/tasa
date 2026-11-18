-- ============================================================
-- 0090 — TOPE DE SEGURIDAD EN LOS TEXTOS DEL CATASTRO
--
-- · El lector corta a 10,000 caracteres por campo y marca el final con
--   "(texto recortado por Tasa)" (lib/catastro/limpiar.ts). Si un
--   predio se guarda con esa marca, alerta en Hoy (una por predio
--   abierta; codigo = la clave).
-- · Kardex: completar un texto que Tasa había cortado a 500 caracteres
--   (antes de nov-2026) no es un cambio de la fuente: cuenta como
--   "ajuste de lector", igual que los campos que el lector no leía.
-- ============================================================

alter table alertas drop constraint alertas_tipo_check;
alter table alertas drop constraint alertas_tipo_completo;
alter table alertas
  add constraint alertas_tipo_check check (tipo in ('cancelado_externo', 'externo_borrado', 'liga_inactiva', 'conector',
                                                    'estimado_sin_final', 'liga_limite', 'pago_por_entregar', 'externo_solicitado',
                                                    'perfil_por_aprobar', 'externo_comision', 'notion_sin_pagina', 'notion_pago',
                                                    'parametros_fiscales', 'cupo_agotado', 'catastro', 'credito_no_aplicado',
                                                    'externo_credito', 'notion_pagina_propuesta', 'catastro_texto_recortado')),
  add constraint alertas_tipo_completo check (
    (tipo in ('cancelado_externo', 'externo_borrado', 'liga_inactiva', 'estimado_sin_final', 'pago_por_entregar',
              'externo_solicitado', 'externo_comision', 'credito_no_aplicado', 'externo_credito')
     and solicitud_id is not null)
    or (tipo = 'conector' and conector_id is not null and codigo is not null)
    or (tipo in ('liga_limite', 'perfil_por_aprobar', 'notion_sin_pagina', 'notion_pago', 'parametros_fiscales', 'cupo_agotado', 'catastro',
                 'notion_pagina_propuesta', 'catastro_texto_recortado')
        and codigo is not null));

drop index if exists alertas_codigo_una_abierta;
create unique index alertas_codigo_una_abierta
  on alertas (organizacion_id, tipo, codigo) where resuelta_en is null
  and tipo in ('notion_sin_pagina', 'notion_pago', 'parametros_fiscales', 'cupo_agotado', 'catastro', 'notion_pagina_propuesta',
               'catastro_texto_recortado');

create or replace function catastro_alertar_recorte()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_campos text;
begin
  if new.demo or new.consultado_org is null then
    return null;
  end if;
  select string_agg(e.key, ', ' order by e.key) into v_campos
    from jsonb_each_text(coalesce(new.extra, '{}')) e
   where right(e.value, char_length(' (texto recortado por Tasa)')) = ' (texto recortado por Tasa)';
  if v_campos is not null then
    insert into alertas (organizacion_id, tipo, codigo, mensaje)
    values (new.consultado_org, 'catastro_texto_recortado', new.clave,
            'Texto recortado por Tasa (más de 10,000 caracteres) en el predio ' || new.clave || ': ' || v_campos
            || '. Se guardó cortado; revisa el original en la fuente si hace falta.')
    on conflict do nothing;
  end if;
  return null;
end;
$$;
create trigger catastro_alertar_recorte after insert or update of extra on catastro_predios
  for each row execute function catastro_alertar_recorte();
revoke all on function catastro_alertar_recorte() from public, anon, authenticated;

-- 0067 + completar un texto cortado a 500 por Tasa (el nuevo empieza igual que el viejo) es ajuste de lector.
create or replace function catastro_ajuste_lector(p_antes jsonb, p_despues jsonb, p_cambios text[])
returns boolean language sql immutable set search_path = public as $$
  select cardinality(p_cambios) > 0 and not ('geometria' = any (p_cambios)) and not exists (
    select 1 from unnest(p_cambios) k
     -- coalesce: con un campo ausente la comparación da nulo, y "not nulo" sacaría la fila (y lo volvería ajuste).
     where not catastro_vacio(p_antes -> k)
       and not coalesce(jsonb_typeof(p_antes -> k) = 'string' and jsonb_typeof(p_despues -> k) = 'string'
                        and catastro_sin_guiones(p_antes ->> k) = catastro_sin_guiones(p_despues ->> k), false)
       and not coalesce(jsonb_typeof(p_antes -> k) = 'string' and catastro_vacio(p_despues -> k)
                        and catastro_sin_guiones(p_antes ->> k) = '', false)
       and not coalesce(jsonb_typeof(p_antes -> k) = 'string' and jsonb_typeof(p_despues -> k) = 'string'
                        and char_length(p_antes ->> k) = 500 and char_length(p_despues ->> k) > 500
                        and starts_with(p_despues ->> k, p_antes ->> k), false));
$$;

-- La versión del 17-nov de 140100141090006 (la consulta que completó su texto) no fue un cambio de la fuente.
update catastro_versiones v set tipo = 'ajuste_lector'
  from catastro_predios p
 where p.clave = v.clave and v.tipo = 'cambio'
   and v.reemplazada_en >= '2026-11-17 00:00:00+00'
   and catastro_ajuste_lector(v.antes, ((to_jsonb(p) - 'extra') || p.extra), v.cambios);
