-- ============================================================
-- 0017 — MULTI-ORGANIZACIÓN: RLS
--
-- Se borran TODAS las políticas y se vuelven a escribir. Regla base de
-- cada tabla: la fila es de la organización activa (`mi_org()`). Encima,
-- la regla del rol:
--   · admin_org / finanzas ("staff"): todo lo de la organización;
--   · admin_marca: trabajos, cotizaciones, pagos y alertas de sus
--     marcas; comisionistas, sí, pero las comisiones solo de sus
--     marcas; nada de cierres, pendientes, pagos de comisión ni bitácora;
--   · comisionista: lo suyo;
--   · equipo: solo su persona (por ahora).
--
-- `(select mi_org())` y compañía van entre paréntesis a propósito:
-- Postgres los calcula una vez por consulta y no una vez por fila.
--
-- Las escrituras que mueven dinero o estado pasan por funciones
-- (0016); aquí solo quedan las que la aplicación hace directo.
-- ============================================================

do $$
declare
  r record;
begin
  for r in select tablename, policyname from pg_policies where schemaname = 'public' loop
    execute format('drop policy %I on %I', r.policyname, r.tablename);
  end loop;
end;
$$;

drop policy if exists comprobantes_subir on storage.objects;
drop policy if exists comprobantes_leer on storage.objects;
drop policy if exists cotizaciones_subir on storage.objects;
drop policy if exists cotizaciones_leer on storage.objects;
drop policy if exists facturas_subir on storage.objects;
drop policy if exists facturas_leer on storage.objects;

drop function soy_super_admin();

-- ------------------------------------------------------------
-- 1. PLATAFORMA, ORGANIZACIONES Y PERSONAS
-- ------------------------------------------------------------

alter table organizaciones      enable row level security;
alter table ajustes_plataforma  enable row level security;
alter table membresias          enable row level security;
alter table membresia_marcas    enable row level security;
alter table conectores          enable row level security;
alter table folios_contador     enable row level security;
revoke all on organizaciones, ajustes_plataforma, membresias, membresia_marcas, conectores, folios_contador
  from anon;

create policy leer_organizaciones on organizaciones for select
  using (id in (select organizacion_id from membresias where persona_id = (select mi_persona_id()) and activa)
         or (select soy_super_plataforma()));
-- Nombre, prefijo e identidad: su admin_org. Altas: por crear_organizacion().
create policy admin_organizacion on organizaciones for update
  using (id = (select mi_org()) and (select soy_admin_org()))
  with check (id = (select mi_org()) and (select soy_admin_org()));
create policy plataforma_organizaciones on organizaciones for update
  using ((select soy_super_plataforma())) with check ((select soy_super_plataforma()));

create policy plataforma_ajustes on ajustes_plataforma for all
  using ((select soy_super_plataforma())) with check ((select soy_super_plataforma()));

-- Las propias (para el selector) y, para admin_org, las de su organización.
create policy leer_membresias on membresias for select
  using (persona_id = (select mi_persona_id())
         or (organizacion_id = (select mi_org()) and (select mi_rol()) in ('admin_org', 'finanzas', 'admin_marca')));
create policy leer_membresia_marcas on membresia_marcas for select
  using (organizacion_id = (select mi_org()));

-- Una persona ve la suya y, si es del equipo, la de quienes son de su
-- organización (para mostrar nombres).
create policy leer_personas on personas for select
  using (id = (select mi_persona_id())
         or ((select mi_rol()) in ('admin_org', 'finanzas', 'admin_marca')
             and id in (select persona_id from membresias where organizacion_id = (select mi_org()))));

-- ------------------------------------------------------------
-- 2. CATÁLOGOS DE LA ORGANIZACIÓN
-- ------------------------------------------------------------

create policy leer_marcas on marcas for select using (organizacion_id = (select mi_org()));
create policy admin_marcas on marcas for all
  using (organizacion_id = (select mi_org()) and (select soy_admin_org()))
  with check (organizacion_id = (select mi_org()) and (select soy_admin_org()));

create policy leer_servicios on servicios for select using (organizacion_id = (select mi_org()));
create policy admin_servicios on servicios for all
  using (organizacion_id = (select mi_org()) and (select soy_admin_org()))
  with check (organizacion_id = (select mi_org()) and (select soy_admin_org()));

create policy leer_niveles on niveles for select using (organizacion_id = (select mi_org()));
create policy admin_niveles on niveles for all
  using (organizacion_id = (select mi_org()) and (select soy_admin_org()))
  with check (organizacion_id = (select mi_org()) and (select soy_admin_org()));

create policy leer_ajustes on ajustes for select using (organizacion_id = (select mi_org()));
create policy admin_ajustes on ajustes for update
  using (organizacion_id = (select mi_org()) and (select soy_admin_org()))
  with check (organizacion_id = (select mi_org()) and (select soy_admin_org()));

create policy staff_lee_origenes on origenes_pago for select
  using (organizacion_id = (select mi_org()) and (select soy_staff()));
create policy admin_origenes on origenes_pago for all
  using (organizacion_id = (select mi_org()) and (select soy_admin_org()))
  with check (organizacion_id = (select mi_org()) and (select soy_admin_org()));

-- Cuentas: el staff, todas; admin_marca, las de sus marcas; el
-- comisionista, las de sus trabajos y cotizaciones (la CLABE para el cliente).
create policy leer_cuentas on cuentas_receptoras for select
  using (organizacion_id = (select mi_org()) and (
    (select soy_staff())
    or marca_id = any ((select mis_marcas())::uuid[])
    or id in (select cuenta_receptora_id from solicitudes where comisionista_id = (select mi_persona_id()))
    or id in (select c.cuenta_receptora_id from cotizaciones c join solicitudes s on s.id = c.solicitud_id
               where s.comisionista_id = (select mi_persona_id()))
  ));
create policy admin_cuentas on cuentas_receptoras for all
  using (organizacion_id = (select mi_org()) and (select soy_admin_org()))
  with check (organizacion_id = (select mi_org()) and (select soy_admin_org()));

-- Conectores: el equipo ve su estado; solo admin_org los configura. La
-- credencial no está aquí (Vault, 0018).
create policy leer_conectores on conectores for select
  using (organizacion_id = (select mi_org()) and (select mi_rol()) in ('admin_org', 'finanzas', 'admin_marca'));
create policy admin_conectores on conectores for update
  using (organizacion_id = (select mi_org()) and (select soy_admin_org()))
  with check (organizacion_id = (select mi_org()) and (select soy_admin_org()));

create policy leer_mapeo on mapeo_estatus for select using (organizacion_id = (select mi_org()));
create policy admin_mapeo on mapeo_estatus for all
  using (organizacion_id = (select mi_org()) and (select soy_admin_org()))
  with check (organizacion_id = (select mi_org()) and (select soy_admin_org()));

-- ------------------------------------------------------------
-- 3. COMISIONISTAS Y NIVELES
-- ------------------------------------------------------------

create policy leer_comisionistas on comisionistas for select
  using (organizacion_id = (select mi_org()) and (
    persona_id = (select mi_persona_id()) or (select mi_rol()) in ('admin_org', 'finanzas', 'admin_marca')));

create policy leer_niveles_mensuales on niveles_mensuales for select
  using (organizacion_id = (select mi_org()) and (
    comisionista_id = (select mi_persona_id()) or (select mi_rol()) in ('admin_org', 'finanzas', 'admin_marca')));

-- ------------------------------------------------------------
-- 4. TRABAJOS
-- ------------------------------------------------------------

create policy leer_solicitudes on solicitudes for select
  using (organizacion_id = (select mi_org()) and (
    comisionista_id = (select mi_persona_id())
    or (select soy_staff())
    or marca_id = any ((select mis_marcas())::uuid[])));

-- El comisionista solo pide: sin montos, cuenta, marca, folio ni registro externo.
create policy pedir_solicitud on solicitudes for insert
  with check (
    organizacion_id = (select mi_org())
    and comisionista_id = (select mi_persona_id())
    and (select mi_rol()) = 'comisionista'
    and origen = 'portal'
    and estado = 'solicitada'
    and estatus_publico = 'solicitada'
    and monto_honorarios is null
    and monto_terceros = 0
    and marca_id is null
    and cuenta_receptora_id is null
    and folio is null
    and externo_id is null
    and pagado_en is null
  );

create policy staff_solicitudes on solicitudes for all
  using (organizacion_id = (select mi_org()) and (select soy_staff()))
  with check (organizacion_id = (select mi_org()) and (select soy_staff()));

-- admin_marca opera los de sus marcas y no los saca de ellas.
create policy marca_actualiza_solicitudes on solicitudes for update
  using (organizacion_id = (select mi_org()) and marca_id = any ((select mis_marcas())::uuid[]))
  with check (organizacion_id = (select mi_org()) and marca_id = any ((select mis_marcas())::uuid[]));

-- Cotizaciones, historial y pagos: los de los trabajos que puede ver
-- (la subconsulta ya pasa por el RLS de solicitudes).
create policy leer_cotizaciones on cotizaciones for select
  using (organizacion_id = (select mi_org()) and solicitud_id in (select id from solicitudes));
create policy staff_cotizaciones on cotizaciones for all
  using (organizacion_id = (select mi_org()) and (select soy_staff()))
  with check (organizacion_id = (select mi_org()) and (select soy_staff()));
create policy marca_cotizaciones on cotizaciones for insert
  with check (organizacion_id = (select mi_org())
              and solicitud_id in (select id from solicitudes where marca_id = any ((select mis_marcas())::uuid[])));
create policy marca_actualiza_cotizaciones on cotizaciones for update
  using (organizacion_id = (select mi_org())
         and solicitud_id in (select id from solicitudes where marca_id = any ((select mis_marcas())::uuid[])))
  with check (organizacion_id = (select mi_org()));

create policy leer_historial on historial_estatus for select
  using (organizacion_id = (select mi_org()) and solicitud_id in (select id from solicitudes));

create policy leer_pagos on pagos for select
  using (organizacion_id = (select mi_org()) and solicitud_id in (select id from solicitudes));

create policy reportar_pago on pagos for insert
  with check (
    organizacion_id = (select mi_org())
    and (select mi_rol()) = 'comisionista'
    and via in ('comprobante', 'aviso', 'efectivo')
    and estado = 'reportado'
    and reportado_por = (select mi_persona_id())
    and solicitud_id in (select id from solicitudes
                          where comisionista_id = (select mi_persona_id()) and estado = 'tramite')
  );

create policy staff_registra_pago on pagos for insert
  with check (organizacion_id = (select mi_org()) and estado = 'reportado'
              and reportado_por = (select mi_persona_id())
              and ((select soy_staff())
                   or solicitud_id in (select id from solicitudes where marca_id = any ((select mis_marcas())::uuid[]))));

-- Confirmar o rechazar. El disparador impide todo lo demás.
create policy revisar_pago on pagos for update
  using (organizacion_id = (select mi_org())
         and ((select soy_staff())
              or solicitud_id in (select id from solicitudes where marca_id = any ((select mis_marcas())::uuid[]))))
  with check (organizacion_id = (select mi_org()));

-- ------------------------------------------------------------
-- 5. COMISIONES Y CIERRES
-- ------------------------------------------------------------
-- Nadie escribe comisiones directo: las escriben el devengo, el
-- cierre y las funciones de movimientos.

create policy leer_comisiones on comisiones for select
  using (organizacion_id = (select mi_org()) and (
    comisionista_id = (select mi_persona_id())
    or (select soy_staff())
    or cuenta_receptora_id in (select id from cuentas_receptoras where marca_id = any ((select mis_marcas())::uuid[]))));
revoke insert, update, delete on comisiones from authenticated;

-- El comisionista solo sabe qué meses están publicados.
create policy leer_cierres on cierres for select
  using (organizacion_id = (select mi_org())
         and ((select soy_staff()) or (estado = 'aprobado' and (select mi_rol()) = 'comisionista')));

create policy leer_pendientes on pendientes_comision for select
  using (organizacion_id = (select mi_org())
         and (comisionista_id = (select mi_persona_id()) or (select soy_staff())));

create policy staff_lee_pagos_comision on pagos_comision for select
  using (organizacion_id = (select mi_org()) and (select soy_staff()));
create policy staff_lee_aplicaciones on aplicaciones_pago_comision for select
  using (organizacion_id = (select mi_org()) and (select soy_staff()));

-- ------------------------------------------------------------
-- 6. ALERTAS Y BITÁCORA
-- ------------------------------------------------------------

create policy leer_alertas on alertas for select
  using (organizacion_id = (select mi_org()) and (
    (select soy_staff())
    or (tipo = 'cancelado_externo'
        and solicitud_id in (select id from solicitudes where marca_id = any ((select mis_marcas())::uuid[])))));

create policy leer_bitacora on bitacora for select
  using (organizacion_id = (select mi_org()) and (select soy_admin_org()));

-- ------------------------------------------------------------
-- 7. PERMISOS DE TABLA (los nuevos y los que cambiaron)
-- ------------------------------------------------------------

grant select on organizaciones, membresias, membresia_marcas, conectores, mapeo_estatus, folios_contador to authenticated;
grant update on organizaciones, conectores to authenticated;
grant select, insert, update, delete on ajustes_plataforma to authenticated;
-- personas: se escriben por funciones (altas, editar comisionista).
revoke insert, update, delete on personas, comisionistas from authenticated;

grant select on organizaciones, conectores, membresias, comisionistas, personas, folios_contador to service_role;

-- ------------------------------------------------------------
-- 8. STORAGE: {organización}/{persona o trabajo}/…
-- ------------------------------------------------------------
-- Subir: a la carpeta propia dentro de la organización activa.
-- Leer: la propia, o un archivo que el RLS ya deja ver en su tabla
-- (un comprobante de un pago visible, una factura de un pendiente
-- visible, el PDF de un trabajo visible).

create policy comprobantes_subir on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'comprobantes'
    and (storage.foldername(name))[1] = (select public.mi_org())::text
    and (storage.foldername(name))[2] = (select public.mi_persona_id())::text
  );

create policy comprobantes_leer on storage.objects
  for select to authenticated
  using (
    bucket_id = 'comprobantes'
    and (storage.foldername(name))[1] = (select public.mi_org())::text
    and ((storage.foldername(name))[2] = (select public.mi_persona_id())::text
         or name in (select comprobante_ruta from public.pagos where comprobante_ruta is not null)
         or ((select public.soy_staff())
             and name in (select comprobante_ruta from public.pagos_comision where comprobante_ruta is not null)))
  );

create policy facturas_subir on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'facturas'
    and (storage.foldername(name))[1] = (select public.mi_org())::text
    and (storage.foldername(name))[2] = (select public.mi_persona_id())::text
  );

create policy facturas_leer on storage.objects
  for select to authenticated
  using (
    bucket_id = 'facturas'
    and (storage.foldername(name))[1] = (select public.mi_org())::text
    and ((storage.foldername(name))[2] = (select public.mi_persona_id())::text
         or name in (select factura_ruta from public.pendientes_comision where factura_ruta is not null))
  );

create policy cotizaciones_subir on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'cotizaciones'
    and (storage.foldername(name))[1] = (select public.mi_org())::text
    and (storage.foldername(name))[2] in (select id::text from public.solicitudes)
    and (select public.mi_rol()) in ('admin_org', 'finanzas', 'admin_marca')
  );

create policy cotizaciones_leer on storage.objects
  for select to authenticated
  using (
    bucket_id = 'cotizaciones'
    and (storage.foldername(name))[1] = (select public.mi_org())::text
    and (storage.foldername(name))[2] in (select id::text from public.solicitudes)
  );
