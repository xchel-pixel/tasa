# Referidos, herramientas y membresías — reglas y esquema

Estado: **acordado, sin construir**. Se construye en dos fases del plan (README → "Plan de lo que
falta"): primero **Referidos**, después **Herramientas y membresías**. Lo marcado **por decidir**
se pregunta antes de escribir la migración.

Todo parámetro es **por organización** (tabla `ajustes` o tablas propias con `organizacion_id`),
con el valor por omisión indicado. Toda tabla nueva: `organizacion_id default mi_org()`, llave
compuesta `(organizacion_id, id)`, RLS, `revoke all … from anon` y disparador de bitácora.

---

## 1. Niveles (ya construido — 0023)

- Tasa de bienvenida 15% (Socio Plus) por 3 meses para comisionistas que ya trabajaban con la
  organización; al terminar baja **máximo un nivel por cierre**; subir es inmediato.
- Nuevos: Aliado 10% sus primeros 2 meses.
- Élite con fecha de vencimiento opcional.
- Reglas completas en `CLAUDE.md` (regla 4) y borrador para el comisionista en
  `docs/terminos-borrador.md`.

---

## 2. Referidos (fase "Referidos")

Sustituye la vigencia fija de 6 meses.

### Reglas

1. **Vigencia del vínculo:** `referido_vigencia_meses` (12) contados desde el **primer trabajo
   pagado del referido** (antes de eso el vínculo está "en espera" y no corre el reloj). Por
   vínculo, admin_org puede **ampliar, acortar o quitar** el bono, siempre con motivo; queda en
   bitácora. La fecha de fin se ve en la ficha del referidor (y en la del referido, solo para
   staff).
2. **Actividad del que refiere:** cobra el bono de un mes solo si tuvo **≥1 trabajo pagado en
   los últimos `referido_actividad_meses` (3)**, contando el mes del cierre. Si no, ese mes no
   genera bono y **no se acumula** ni se paga después.
3. **Pérdida:** con `referido_perdida_meses` (6) meses seguidos sin trabajos pagados, todos sus
   vínculos pasan a **liberado**, definitivo (no se reactivan aunque vuelva a trabajar). Aviso
   en su inicio desde `referido_aviso_meses` (4) meses de inactividad: "Llevas 4 meses sin
   trabajos pagados: a los 6 pierdes tus referidos".
4. **Se mantiene:** escalón de 2% a 5% según cuántos referidos activos tenga, **un solo nivel**
   (el referido de mi referido no me genera nada), antifraude y **tope de 30% por trabajo**.

### Esquema

```
ajustes
  + referido_vigencia_meses  smallint default 12
  + referido_actividad_meses smallint default 3
  + referido_perdida_meses   smallint default 6
  + referido_aviso_meses     smallint default 4

referido_escalones                       -- el 2–5% por referidos activos
  organizacion_id, desde_activos smallint, porcentaje numeric(5,2) check (> 0 and <= 5)
  pk (organizacion_id, desde_activos)

vinculos_referido                        -- reemplaza comisionistas.referido_por
  organizacion_id, id
  referidor_id, referido_id              -- referido_id único por organización (un solo referidor)
  estado   'en_espera' | 'vigente' | 'vencido' | 'quitado' | 'liberado'
  inicio   date      -- primer trabajo pagado del referido; nulo en espera
  fin      date      -- inicio + vigencia; editable por admin_org con motivo
  creado_en, creado_por
  check (referidor_id <> referido_id)

eventos_vinculo                          -- ampliar / acortar / quitar / liberar, con motivo
  organizacion_id, id, vinculo_id, tipo, fin_anterior, fin_nuevo, motivo, persona_id, creado_en
```

- **Cálculo** al aprobar el cierre del mes M (dentro de `ejecutar_aprobacion_cierre`):
  1. Vínculos en espera cuyo referido tuvo su primer trabajo pagado → `vigente`, `inicio`, `fin`.
  2. Vigentes con `fin` < M → `vencido`.
  3. Referidores con `referido_perdida_meses` sin pagos → sus vínculos `liberado` (+ evento).
  4. Para cada referidor activo (regla 2): porcentaje del escalón según sus vínculos vigentes;
     por cada trabajo pagado de sus referidos en M, una comisión `tipo = 'referido'` ligada a ese
     trabajo, **recortada a lo que quede del tope de 30%** de ese trabajo.
- `comisionistas.referido_por` se migra a `vinculos_referido` y se elimina después.
- Funciones: `cambiar_vinculo(p_vinculo, p_fin, p_quitar, p_motivo)` (admin_org),
  `mis_referidos()` (el referidor ve nombre, estado y fin; **nunca montos** del referido).

### Por decidir

- **La tabla del escalón** (cuántos referidos activos dan 2%, 3%, 4%, 5%) y **sobre qué base**
  se calcula el bono (propuesta: honorarios del trabajo del referido, igual que la comisión).
  No está en el repositorio; hace falta el dato.
- **Qué es "antifraude"** en concreto. Propuesta: (a) no se puede referir a alguien que ya
  estuvo dado de alta en la organización; (b) mismo RFC, teléfono o cuenta de pago entre
  referidor y referido → alerta y bono retenido hasta que admin_org lo libere; (c) el vínculo se
  crea solo en el alta, nunca después.
- **"Referido activo"** para el escalón: propuesta, el que tuvo ≥1 trabajo pagado en los últimos
  3 meses (misma regla que el referidor).
- **Choque con el tope:** un Élite de 28% + bono de referido de 5% pasa de 30%. Propuesta: se
  recorta el bono del referidor, nunca la comisión del referido.

---

## 3. Herramientas y membresías (fase "Herramientas")

### Los tres productos

| Producto | Cómo se entrega | Nota |
|---|---|---|
| Consulta catastral (skill `consulta-catastral-qro`) | automática | ficha + PDF + DXF |
| Estimación rápida (skill `estimacion-valor`, **sin** revisión) | automática, en minutos | PDF con la leyenda "No es opinión de valor ni avalúo". Compite con servicios tipo Valuum |
| OV express (revisada por valuador MGP) | el equipo la revisa | producto premium |

Mientras no estén integradas: el comisionista pide la herramienta en Tasa, el equipo la atiende
fuera y sube el entregable; **al entregarla** Tasa descuenta el cupo o genera el cargo.

### Cupos mensuales (no se acumulan)

|                       | Enlace | Aliado | Socio | Socio Plus | Membresía Básica | Membresía Pro |
|-----------------------|-------:|-------:|------:|-----------:|-----------------:|--------------:|
| Cuota mensual         | 0      | 0      | 0     | 0          | $490             | $990          |
| Consultas catastrales | 2      | 5      | 15    | 30         | 10               | 25            |
| Estimación rápida     | 3      | 10     | 30    | sin límite | 10               | 30            |
| OV express            | 0      | 1      | 2     | 4          | 1                | 3             |

- **Cupo efectivo** = el mayor, herramienta por herramienta, entre lo de su nivel y lo de su
  membresía. El cotizador es ilimitado.
- **Adicionales** (pasado el cupo): OV express $1,200, consulta catastral $60. La estimación
  rápida no tiene precio de adicional en la tabla (**por decidir**).
- **Bonificación:** si al cerrar el mes quedó en Aliado o más, la membresía del mes siguiente se
  bonifica sola.
- **Términos:** la OV express incluida es para prospección; si el cliente final paga una OV, va
  como trámite normal con comisión.

### Esquema

```
herramienta (texto con check): 'consulta_catastral' | 'estimacion_rapida' | 'ov_express'

planes_membresia
  organizacion_id, id, clave ('basica' | 'pro' | …), nombre, cuota numeric, activo

cupos                                    -- una fila por (nivel o plan) × herramienta
  organizacion_id, id, nivel_id null, plan_id null, herramienta, cantidad integer null
  check (num_nonnulls(nivel_id, plan_id) = 1)   -- cantidad nula = sin límite

precios_herramienta
  organizacion_id, herramienta, precio numeric   -- adicionales

membresias                               -- una por comisionista y mes
  organizacion_id, id, comisionista_id, plan_id, mes date
  estado 'por_pagar' | 'pagada' | 'bonificada' | 'cancelada'
  pago_id null, bonificada_por_nivel_id null
  unique (organizacion_id, comisionista_id, mes)

pedidos_herramienta                      -- lo que pide el comisionista; bitácora de uso
  organizacion_id, id, comisionista_id, herramienta, mes date
  datos jsonb (ubicación, clave catastral, superficies…), estado 'pedida' | 'entregada' | 'cancelada'
  pedido_en, entregado_en, entregado_por, entregable_ruta (bucket privado)
  fuente 'cupo' | 'adicional' (se fija al entregar), cargo_id null (comisiones tipo 'cargo')
```

- `cupo_disponible(p_comisionista, p_herramienta, p_mes)`: cupo efectivo menos entregados del
  mes. Lo ve el comisionista antes de pedir ("te quedan 3 consultas este mes; la siguiente
  cuesta $60").
- `entregar_herramienta(p_pedido, p_ruta)`: staff; fija `fuente` y, si es adicional, crea el
  cargo. Cancelar un pedido entregado con cargo anula el cargo (con motivo), como los demás
  deshacer.
- Las automáticas (consulta y estimación) entran después por la misma tabla: el pedido lo
  atiende un proceso del servidor en vez del equipo.

### Propuesta: cómo se cobran adicionales y membresía

- **Adicionales → cargo en su estado de cuenta** (tipo `cargo`, ya existe): se descuenta de su
  siguiente pago de comisión. Si el saldo del mes queda negativo, pasa al mes siguiente como ya
  pasa hoy (arrastre). Para no acumular deuda sin fin: **sin saldo positivo, el adicional se pide
  pagado por adelantado** (sube su comprobante, se confirma a mano como cualquier pago).
- **Membresía → pago por adelantado** por transferencia, reportado y confirmado a mano (regla de
  la casa: sin pasarela). Se activa al confirmarse. Razón: quien compra membresía es casi siempre
  quien todavía no genera comisiones, así que descontarla del estado de cuenta no cobra nada.
  Si sí tiene saldo positivo, puede elegir que se descuente.

### Por decidir

- **Cupos con piso de bienvenida o arranque:** ¿los cupos siguen al nivel que se le paga (con
  el piso) o al nivel real por promedio? Propuesta: al nivel que se le paga (más simple, y es
  parte de la bienvenida). Pero la **bonificación** de la membresía solo con nivel real
  (promedio), si no, todos los nuevos tendrían membresía gratis por el arranque en Aliado.
- **"Sin límite"** en estimación rápida para Socio Plus: cuando sea automática, cada una cuesta
  (modelo y datos). Propuesta: un tope técnico alto (p. ej. 100 al mes) contra abuso, sin
  mostrarlo como cupo.
- **Integrar las skills como automáticas** implica llamar a un modelo de IA y a fuentes externas
  (visor IDECATQ, portales de inmuebles) desde el servidor de Tasa: dependencias nuevas, costo
  por uso, llaves en Vercel y revisar los términos de uso de esas fuentes. Se plantea aparte
  antes de construirlo.
- **"Tipo de solicitud Herramienta":** propuesta, en la pantalla se ve como un tipo más al
  pedir, pero se guarda en `pedidos_herramienta`, no en `solicitudes`: así no toca devengo,
  folio, conectores ni cierre (una herramienta no genera comisión).
