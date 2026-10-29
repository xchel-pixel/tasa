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

- **Qué guarda cada convenio:** cliente o empresa, contacto, vigencia, notas y precios por servicio. Cada precio puede ser por marca y puede ser "sin costo".
- **"¿Genera comisión?"** tiene tres opciones:
  - **Sí:** con el % del nivel del comisionista, como cualquier trabajo.
  - **No:** no genera comisión ni cuenta para el nivel.
  - **% fijo:** el comisionista gana ese % en lugar del de su nivel. Las tasas de bienvenida y Élite no aplican a ese trabajo. Sí cuenta para el nivel, y el cierre no lo recalcula.
- **Al cotizar:** elegir el convenio llena el tipo y el precio. Si se ajusta, se pide motivo, que va a la bitácora como "Ajuste al convenio: …". El servidor revisa el ajuste contra la base.
- **La regla se copia al emitir:** la regla de comisión pasa a la cotización y al trabajo en ese momento. Cambiar el convenio después no toca lo ya cotizado.
- **Quién lo ve:**
  - El comisionista no lee los convenios: solo ve el precio de su trabajo.
  - Finanzas y admin_marca los leen para cotizar.
  - Solo admin_org los edita.
- **No se borran:** los convenios se desactivan. Los precios sí se pueden borrar.

## Reportes

- **Trabajos aceptados en el mes por tipo:** fijo, sin costo, estimado con honorario final y estimado pendiente de fijar.
- **Aviso de estimados sin honorario final:** cuenta los de cualquier mes y lleva a Trámites con ese filtro.

Pruebas: "Tipos de honorario y convenios" en `supabase/verificaciones.sql`, más PDF y Notion en `pruebas/`.
