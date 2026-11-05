# Comisiones, bono de referido y pagos en Notion (0052)

Tasa sigue siendo donde se calculan y se pagan las comisiones. Notion solo recibe una copia para que
"Margen MGP" y el "Saldo" de cada comisionista cuadren. Igual que "Solicitado por" (0049): Tasa marca
el trabajo o el pago como pendiente, el cron lo escribe en la siguiente vuelta y deja historial,
bitácora o alerta. El cambio en Tasa nunca espera a Notion.

## Qué se escribe

| En Notion | Qué | Cuándo |
|---|---|---|
| Trámites · **Ext Comisionista** + **Ext Comisión** | Comisión directa del trabajo: comisión + ajustes + cargos de su comisionista (nunca menos de 0) | Al quedar pagado al 100 % (con el % del nivel vigente) y cada vez que cambia: cierre (nivel definitivo, tope de 30 %), ajuste, cancelación (0), cambio de comisionista |
| Trámites · **Ref Comisionista** + **Ref Bono** | El bono de referido que ESE trabajo generó a quien refirió al comisionista | SOLO al aprobar el cierre del mes. Sin bono: 0 y relación vacía |
| Cobros y Gastos · un movimiento por pago | Pago de comisión (Gasto, Entidad ROMI/MGP, Categoría Tasa, Cuenta del origen, Ext Comisionista) | Al registrar el pago del día 10 |
| Cobros y Gastos · otro movimiento | La parte del pago que es bono de referido, **sin** Ext Comisionista (el bono no entra en su Saldo) | En el mismo pago |
| Cobros y Gastos · movimientos en negativo | "ANULACIÓN · …" | Al anular un pago que ya estaba en Notion |

"Genera comisión: no", sin costo o convenio sin comisión: Ext Comisión = 0 y sin bono. Los bonos de
equipo solo existen si su bono está activo; su relación queda vacía (Ext Comisionistas es de
comisionistas). Nunca se tocan "Int Comisionista", "Int Comisión", "Ext Pagable", "Int Pagable" ni
el campo "Trámite" de Cobros y Gastos (alteraría los Pagos del trámite).

## Margen MGP

Honorario − Firma Perito Costo − Folio Costo − Int Comisión − Ext Comisión − **Ref Bono**, con los vacíos
como 0: los trámites viejos no cambian. Se cambió el 05/11/2026 con OK de Xchel.

## Ligar comisionistas

En la ficha, **Página en Notion** (solo admin_org): "Buscar en Notion" por nombre en Ext Comisionistas
y "Ligar", o "Crear en Notion" con confirmación. Sin página: el monto se escribe, la relación queda
vacía y sale una alerta por comisionista, que se cierra sola al ligarlo.

## Cuentas para pagar comisiones

Catálogos → **Cuentas para pagar comisiones** (antes "Origen del dinero" en Ajustes): el nombre que se
elige al registrar el pago y su "Cuenta en Notion", el nombre exacto en Cuentas MGP. Sin cuenta ligada
o si no se encuentra, el movimiento se crea con Cuenta vacía y sale alerta.

## Configuración del conector

`configuracion`: `base_comisionistas`, `base_pagos`, `base_cuentas`, `base_categorias` (ids de fuente de
datos), `categoria_pagos` ("Tasa"), `entidad_pagos` ("ROMI/MGP"). `mapeo_campos`: `ext_comisionista`,
`ext_comision`, `ref_comisionista`, `ref_bono`. Sin el mapeo, los pasos quedan pendientes; sin
`base_pagos`, los pagos no se anotan. La integración "Tasa" necesita conexión a Trámites, Ext
Comisionistas, Cobros y Gastos, Cuentas MGP y Categorías de C&G.
