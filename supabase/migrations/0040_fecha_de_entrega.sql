-- ============================================================
-- 0040 — FECHA DE ENTREGA DEL TRABAJO
--
-- `fecha_entrega` es el día (hora de México) en que el trabajo pasó a
-- "Entregado", venga el cambio de Tasa o de Notion: lo pone un trigger
-- sobre `estatus_publico`, así que no importa quién lo mueva.
--   · Pasa a "entregado"            → fecha de hoy (si no tenía).
--   · De "entregado" a "pagado"     → se conserva (sigue entregado).
--   · A cualquier otro estatus      → se limpia (la entrega se revirtió).
-- La usa "Trámites" para esconder los entregados de hace más de 30 días.
--
-- Las existentes se rellenan con el último paso a "entregado" según la
-- bitácora (y, si no lo hubiera ahí, según el historial de estatus).
-- ============================================================

alter table solicitudes add column fecha_entrega date;

create or replace function anotar_fecha_entrega()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' or new.estatus_publico is distinct from old.estatus_publico then
    if new.estatus_publico = 'entregado' then
      new.fecha_entrega := coalesce(new.fecha_entrega, hoy_mx());
    elsif new.estatus_publico <> 'pagado' then
      new.fecha_entrega := null;
    end if;
  end if;
  return new;
end;
$$;

-- Es de trigger: nadie la llama directo.
revoke all on function anotar_fecha_entrega() from public, anon, authenticated;

-- Corre después de `al_guardar_solicitud` (orden alfabético): ve el estatus ya corregido por las reglas.
create trigger al_marcar_entrega
  before insert or update on solicitudes
  for each row execute function anotar_fecha_entrega();

-- Relleno: solo trabajos que hoy están entregados o pagados.
select set_config('tasa.motivo', 'Fecha de entrega desde la bitácora', true);
update solicitudes s
   set fecha_entrega = x.dia
  from (
    select s2.id,
           coalesce(
             (select max(b.creado_en) from bitacora b
               where b.tabla = 'solicitudes' and b.registro_id = s2.id::text
                 and b.despues->>'estatus_publico' = 'entregado'
                 and (b.antes is null or b.antes->>'estatus_publico' is distinct from 'entregado')),
             (select max(h.desde) from historial_estatus h
               where h.solicitud_id = s2.id and h.estatus_publico = 'entregado')
           ) at time zone 'America/Mexico_City' as momento
      from solicitudes s2
     where s2.estatus_publico in ('entregado', 'pagado') and s2.fecha_entrega is null
  ) y
  cross join lateral (select y.momento::date as dia) x
 where s.id = y.id and y.momento is not null;
select set_config('tasa.motivo', '', true);
