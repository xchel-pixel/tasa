-- ============================================================
-- 0048 — LA NOTA DE INDEPENDENCIA YA NO MENCIONA LA COMISIÓN
--
-- Se quita "El asesor puede recibir una comisión por recomendar el
-- servicio." del texto por omisión y de las organizaciones que todavía
-- tienen el texto original (las que lo cambiaron a mano se respetan).
-- El cambio sube nota_version y queda en bitácora, como cualquier otro.
-- ============================================================

alter table ajustes alter column nota_liga set default
  'Tu solicitud se envía a un despacho de valuación independiente, que es quien cotiza, realiza el trabajo y emite los documentos. '
  || '{nombre} es un asesor afiliado: promueve el servicio mediante una alianza comercial, pero no forma parte del despacho ni es '
  || 'responsable del avalúo. La cotización indicará la empresa que realizará el trabajo y la cuenta a la que se paga.';

select set_config('tasa.motivo', 'La nota de independencia ya no menciona la comisión', true);
update ajustes
   set nota_liga = replace(nota_liga, ' El asesor puede recibir una comisión por recomendar el servicio.', '')
 where nota_liga like '% El asesor puede recibir una comisión por recomendar el servicio.%';
select set_config('tasa.motivo', '', true);
