# Respaldo de fórmulas de Trámites (Notion)

Leídas por la API de Notion (data source `0bcd465f-fd85-4665-8fd7-77212ce0328b`, Trámites) el 10 nov 2026, **antes** de agregar Crédito Tasa y Costo crédito. Para regresar una fórmula, pega su expresión tal cual en la propiedad.

## Saldo

```
prop("Total a cobrar") - if(empty(prop("Pagos")), 0, prop("Pagos"))
```

## Ext Pagable

```
lets(total, if(empty(prop("Total a cobrar")), 0, prop("Total a cobrar")), pagos, if(empty(prop("Pagos")), 0, prop("Pagos")), comision, if(empty(prop("Ext Comisión")), 0, prop("Ext Comisión")), proporcion, if(total == 0, 0, pagos / total), min(comision * proporcion, comision))
```

## Int Pagable

```
lets(total, if(empty(prop("Total a cobrar")), 0, prop("Total a cobrar")), pagos, if(empty(prop("Pagos")), 0, prop("Pagos")), comision, if(empty(prop("Int Comisión")), 0, prop("Int Comisión")), proporcion, if(total == 0, 0, pagos / total), min(comision * proporcion, comision))
```

## Margen MGP

```
if(empty(prop("Honorario")), 0, prop("Honorario")) - if(empty(prop("Firma Perito Costo")), 0, prop("Firma Perito Costo")) - if(empty(prop("Folio Costo")), 0, prop("Folio Costo")) - if(empty(prop("Int Comisión")), 0, prop("Int Comisión")) - if(empty(prop("Ext Comisión")), 0, prop("Ext Comisión")) - if(empty(prop("Ref Bono")), 0, prop("Ref Bono"))
```

## Listo para cerrar

```
and(prop("Entrega estatus") == "Entregado", prop("Honorarios estatus") == "Pagado", or(not prop("Requiere factura"), prop("Factura estatus") == "Facturada"))
```

## Total a cobrar

```
if(empty(prop("Honorario")), 0, prop("Honorario")) + prop("IVA")
```

## IVA

```
if(prop("Requiere factura"), round(if(empty(prop("Honorario")), 0, prop("Honorario")) * 0.16 * 100) / 100, 0)
```

«Pagos» es un rollup (suma de «Monto» por la relación «Contro de Gastos»); no se cambia.

---

# Cómo quedaron (10 nov 2026, con Crédito Tasa y Costo crédito)

Crédito Tasa y Costo crédito vacíos cuentan como 0. «Listo para cerrar» no se cambió: decide «pagado» con «Honorarios estatus» = Pagado, no con Saldo ni con Pagos contra Total.
Verificación: 26 trámites sin crédito (incluido MGP-2026-0675, 13 con comisión pagable) leídos por la API antes y después: Saldo, Ext Pagable, Int Pagable, Margen MGP y Listo para cerrar idénticos.

## Saldo

```
prop("Total a cobrar") - if(empty(prop("Pagos")), 0, prop("Pagos")) - if(empty(prop("Crédito Tasa")), 0, prop("Crédito Tasa"))
```

## Ext Pagable

```
lets(total, if(empty(prop("Total a cobrar")), 0, prop("Total a cobrar")), pagos, if(empty(prop("Pagos")), 0, prop("Pagos")), credito, if(empty(prop("Crédito Tasa")), 0, prop("Crédito Tasa")), comision, if(empty(prop("Ext Comisión")), 0, prop("Ext Comisión")), base, total - credito, proporcion, if(base <= 0, 0, pagos / base), min(comision * proporcion, comision))
```

## Int Pagable

```
lets(total, if(empty(prop("Total a cobrar")), 0, prop("Total a cobrar")), pagos, if(empty(prop("Pagos")), 0, prop("Pagos")), credito, if(empty(prop("Crédito Tasa")), 0, prop("Crédito Tasa")), comision, if(empty(prop("Int Comisión")), 0, prop("Int Comisión")), proporcion, if(total == 0, 0, (pagos + credito) / total), min(comision * proporcion, comision))
```

## Margen MGP

```
if(empty(prop("Honorario")), 0, prop("Honorario")) - if(empty(prop("Firma Perito Costo")), 0, prop("Firma Perito Costo")) - if(empty(prop("Folio Costo")), 0, prop("Folio Costo")) - if(empty(prop("Int Comisión")), 0, prop("Int Comisión")) - if(empty(prop("Ext Comisión")), 0, prop("Ext Comisión")) - if(empty(prop("Ref Bono")), 0, prop("Ref Bono")) - if(empty(prop("Costo crédito")), 0, prop("Costo crédito"))
```

