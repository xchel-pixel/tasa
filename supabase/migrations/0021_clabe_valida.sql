-- ============================================================
-- 0021 — DÍGITO DE CONTROL DE LA CLABE EN LA BASE
--
-- Hasta ahora lo revisaba solo la pantalla de Catálogos. Desde aquí,
-- la base no acepta una CLABE cuyo último dígito no cuadre (pesos 3, 7,
-- 1 sobre los primeros 17, como la calcula Banxico): un dígito mal
-- copiado ya no llega a un PDF ni a un cliente.
--
-- Las tres cuentas de relleno de 0008 (CLABE 000…001, …002, …003) no
-- pasan. Se borran si nadie las usa, que es el caso de una base recién
-- reseteada para producción. Si alguna ya tiene trabajos (la base de
-- pruebas), se queda y la regla aplica a todo lo nuevo o editado; la
-- revisión completa se activa sola en cuanto ya no quede ninguna mala.
-- ============================================================

create or replace function clabe_valida(p_clabe text)
returns boolean language sql immutable as $$
  select p_clabe ~ '^[0-9]{18}$'
     and (10 - (select sum((substr(p_clabe, i, 1)::int * (array[3, 7, 1])[((i - 1) % 3) + 1]) % 10)
                  from generate_series(1, 17) i) % 10) % 10
         = substr(p_clabe, 18, 1)::int;
$$;

revoke all on function clabe_valida(text) from public, anon;
grant execute on function clabe_valida(text) to authenticated, service_role;

delete from cuentas_receptoras c
 where not clabe_valida(c.clabe)
   and not exists (select 1 from solicitudes s where s.cuenta_receptora_id = c.id)
   and not exists (select 1 from cotizaciones k where k.cuenta_receptora_id = c.id)
   and not exists (select 1 from comisiones m where m.cuenta_receptora_id = c.id);

alter table cuentas_receptoras
  add constraint cuentas_clabe_valida check (clabe_valida(clabe)) not valid;

do $$
begin
  if not exists (select 1 from cuentas_receptoras where not clabe_valida(clabe)) then
    alter table cuentas_receptoras validate constraint cuentas_clabe_valida;
  end if;
end;
$$;
