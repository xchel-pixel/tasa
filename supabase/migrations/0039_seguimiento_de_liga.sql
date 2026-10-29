-- ============================================================
-- 0039 — EL DUEÑO DE LA LIGA VE SU TRÁMITE COMPLETO
--
-- Lo que llegaba por la liga de cliente quedaba guardado igual que lo
-- pedido desde la cuenta del comisionista (folio de Notion, estatus,
-- fechas e historial), pero el dueño de la liga no podía leerlo:
--   · el RLS de `solicitudes` solo dejaba ver al comisionista del
--     trabajo, al staff y al admin de la marca. Quien comparte su liga
--     sin ser comisionista (equipo, o admin_marca fuera de su marca) no
--     veía la solicitud;
--   · lo único que se le mostraba era `mis_solicitudes_de_liga()`, una
--     lista aparte con el estado interno, sin folio ni estatus público.
--
-- Ahora el dueño de la liga lee la solicitud como el comisionista lee
-- la suya. El historial, los pagos y el PDF de la cotización ya se
-- filtran por "las solicitudes que puedes ver", así que lo siguen solos.
-- Lo que no cambia: solo lectura. Aceptar, reportar pagos y cancelar
-- siguen siendo del comisionista del trabajo y del staff, y nadie ve
-- comisiones ajenas (esa tabla no se toca).
--
-- Si el dueño estaba inactivo cuando llegó (`liga_sin_dueno`), la
-- solicitud es de la organización y él no la ve.
-- ============================================================

drop policy leer_solicitudes on solicitudes;
create policy leer_solicitudes on solicitudes for select
  using (organizacion_id = (select mi_org())
         and (comisionista_id = (select mi_persona_id())
              or (liga_de = (select mi_persona_id()) and not liga_sin_dueno)
              or (select soy_staff())
              or marca_id = any ((select mis_marcas())::uuid[])));

create index if not exists solicitudes_liga_de on solicitudes (liga_de) where liga_de is not null;
