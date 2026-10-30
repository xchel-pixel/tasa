# Tipos de honorario y convenios (0041)

## Tipos de honorario

Se eligen al cotizar y al poner precio a un trámite directo ("cotizar y aceptar").

| Tipo | Monto | PDF | Comisión y nivel | Notion "Cotización" |
|---|---|---|---|---|
| Fijo | El honorario | El monto | Normal | El honorario |
| Sin costo | $0 (los derechos y terceros sí se cobran) | "Sin costo" | Nunca. La genera el trabajo ligado, si lo hay | 0 |
| Estimado | El estimado; si es rango, el máximo | "Estimado" y la nota "Honorario final por definir" | Sobre el honorario final pagado | El estimado, y se reescribe al fijar el final |

**Honorario final de un estimado**
- Lo fijan admin_org o finanzas en la ficha del trabajo, con motivo. Queda en la bitácora con el antes, el después y el motivo.
- Sin honorario final, en Tasa no se puede marcar "Entregado" ni confirmar el pago que liquidaría el trabajo.
- Desde Notion no se puede frenar: si llega "Entregado", queda la alerta "Estimados sin honorario final" en Alertas y en el inicio de admin_org y finanzas.
- El comisionista ve "Estimado $X · por definir" hasta que se fija.
- Si el cliente pagó el estimado y el final quedó abajo, el pago se rechaza con motivo y se reporta el monto correcto. Nunca se confirma más de lo que vale el trabajo.

## Convenios (Catálogos → Convenios)

- **Una sola pantalla (0042):** datos (cliente o empresa, contacto, vigencia y notas), "Precios del convenio" y comisión. Arriba hay un ejemplo de cómo llenarlo.
- **Precios del convenio:** una fila por servicio del catálogo, con incluir sí/no, marca (o cualquiera), tipo (Fijo, Sin costo o Estimado con rango) y nota (p. ej. "sin costo si contrata el avalúo").
- **Guardar:** todo se guarda junto con `guardar_convenio`, en una sola transacción. Si algo no cuadra, se muestra un mensaje en español con el servicio que falló y no se guarda nada a medias. La acción nunca muestra la página de error.
- **"¿Genera comisión?"** tiene tres opciones, cada una con su ayuda en pantalla:
  - **Sí, normal:** con el % del nivel, y cuenta para el nivel.
  - **No:** ni comisión ni nivel.
  - **% fijo:** sustituye el % del nivel, sin bienvenida ni Élite; cuenta para el nivel y el cierre no lo recalcula.
- **Al cotizar:** elegir el convenio llena el tipo, el precio o rango y muestra la nota. Si se ajusta, pide motivo, que va a la bitácora como "Ajuste al convenio: …". El servidor revisa el ajuste contra la base.
- **La regla se copia al emitir:** la regla de comisión pasa a la cotización y al trabajo en ese momento. Cambiar el convenio después no toca lo ya cotizado.
- **Quién lo ve:**
  - El comisionista no lee los convenios: solo ve el precio de su trabajo.
  - Finanzas y admin_marca los leen para cotizar.
  - Solo admin_org los edita.
- **No se borran:** los convenios se desactivan. Quitar un servicio de la tabla y guardar quita su precio.
- **Incidente del 29-oct-2026:** la página de Catálogos llamaba desde el servidor una función de un archivo de cliente (`textoComision`), y truena en cuanto hay un convenio que pintar. Ahora `pruebas/cliente-servidor.test.ts` lo busca en todo el código.

## Reportes

- **Trabajos aceptados en el mes por tipo:** fijo, sin costo, estimado con honorario final y estimado pendiente de fijar.
- **Aviso de estimados sin honorario final:** cuenta los de cualquier mes y lleva a Trámites con ese filtro.
- **Sin costo → conversión (solo lectura):** de los trabajos sin costo aceptados en el mes, cuántos tienen su trabajo ligado contratado (ya es trabajo) y por cuánto, y cuántos llevan más de 30 días sin uno. Va por convenio y por comisionista. **El sin costo nunca se cobra**, se contrate o no lo ligado (decisión del 30-oct-2026): no hay condición de cobro. El cálculo está en `lib/conversion-sin-costo.ts`, con sus pruebas.

Pruebas: "Tipos de honorario y convenios" en `supabase/verificaciones.sql`, más PDF y Notion en `pruebas/`.
