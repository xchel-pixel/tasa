-- ============================================================
-- 0012 — ALIAS DE CUENTA RECEPTORA
--
-- Dos nombres para una cuenta, cada uno donde corresponde:
--   · alias: la etiqueta corta en listas, estados de cuenta, subtotales
--     y el panel ("Scotiabank XG");
--   · titular: el nombre legal, SOLO junto a la CLABE, donde el cliente
--     necesita los datos para transferir (ficha, reportar pago, PDF).
-- ============================================================

alter table cuentas_receptoras add column alias text;

update cuentas_receptoras set alias = 'ROMI'          where titular = 'ROMI';
update cuentas_receptoras set alias = 'Banregio AP73' where banco = 'Banregio';
update cuentas_receptoras set alias = 'Scotiabank XG' where banco = 'Scotiabank';
-- Cualquier otra que se haya dado de alta antes de esta migración.
update cuentas_receptoras set alias = titular where alias is null;

alter table cuentas_receptoras
  alter column alias set not null,
  add constraint cuentas_alias_corto check (char_length(trim(alias)) between 1 and 30),
  add constraint cuentas_alias_unico unique (alias);

-- El resumen del cierre agrupa por cuenta: ahora por alias.
create or replace function resumen_del_mes(p_mes date)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(fila order by fila->>'comisionista'), '[]'::jsonb)
    from (
      select jsonb_build_object(
               'comisionista_id', c.comisionista_id,
               'comisionista',    p.nombre,
               'total',           sum(c.monto),
               'por_cuenta',      (
                 select jsonb_object_agg(cuenta, total)
                   from (
                     select coalesce(cr.alias, 'Sin cuenta') as cuenta, sum(c2.monto) as total
                       from comisiones c2
                       left join solicitudes s2 on s2.id = c2.solicitud_id
                       left join cuentas_receptoras cr on cr.id = s2.cuenta_receptora_id
                      where c2.mes = mes_de(p_mes) and c2.comisionista_id = c.comisionista_id
                      group by 1
                   ) t
               )
             ) as fila
        from comisiones c
        join personas p on p.id = c.comisionista_id
       where c.mes = mes_de(p_mes)
       group by c.comisionista_id, p.nombre
    ) x;
$$;

-- `create or replace` conserva los permisos, pero se repite el candado
-- por si la función se recrea con `drop` algún día.
revoke all on function resumen_del_mes(date) from public, anon, authenticated;
