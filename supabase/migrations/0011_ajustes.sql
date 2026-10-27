-- ============================================================
-- 0011 — AJUSTES Y NOMBRES SIN PERSONAS
--
-- La interfaz no muestra el nombre ni el correo de nadie del equipo
-- como texto fijo. Si una pantalla necesita un medio de contacto, sale
-- de `ajustes.contacto_soporte`, que edita super_admin; vacío = no se
-- muestra contacto.
-- ============================================================

-- Una sola fila: el `check (id)` impide que exista una segunda.
create table ajustes (
  id                boolean primary key default true check (id),
  contacto_soporte  text check (char_length(contacto_soporte) <= 120),
  actualizado_en    timestamptz not null default now()
);

insert into ajustes default values;

create trigger bitacora after insert or update or delete on ajustes
  for each row execute function registrar_bitacora();

alter table ajustes enable row level security;
revoke all on ajustes from anon;
grant select, update on ajustes to authenticated;

create policy leer_ajustes on ajustes for select to authenticated using (true);
create policy admin_ajustes on ajustes for update
  using (soy_super_admin()) with check (soy_super_admin());

-- La pantalla de acceso lo necesita SIN sesión (para "no estás dado de
-- alta"). Entrega una sola columna, nunca la fila.
create or replace function contacto_soporte()
returns text language sql stable security definer set search_path = public as $$
  select nullif(trim(contacto_soporte), '') from ajustes;
$$;

revoke all on function contacto_soporte() from public;
grant execute on function contacto_soporte() to anon, authenticated;

-- La marca de los trabajos personales se mostraba como "Xchel Guerrero".
-- El comisionista ve la marca ejecutora en la ficha del trabajo: queda
-- solo la clave.
update marcas set nombre = 'XG' where clave = 'XG';
