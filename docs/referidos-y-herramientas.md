# Referidos, herramientas y membresías — reglas y esquema

Estado: **reglas acordadas, sin construir**. Se construye en dos fases del plan (README → "Plan
de lo que falta"), después del paso a producción: primero **Referidos**, después **Herramientas
y membresías**. Las automáticas tienen su propio plan antes de construirse.

Todo parámetro es **por organización** (tabla `ajustes` o tablas propias con `organizacion_id`),
con el valor por omisión indicado. Toda tabla nueva: `organizacion_id default mi_org()`, llave
compuesta `(organizacion_id, id)`, RLS, `revoke all … from anon` y disparador de bitácora.

---

## 1. Niveles (ya construido — 0023)

- Tasa de bienvenida 15% (Socio Plus) por 3 meses para comisionistas que ya trabajaban con la
  organización; al terminar baja **máximo un nivel por cierre**; subir es inmediato.
- Nuevos: Aliado 10% sus primeros 2 meses (arranque). Es también el beneficio del referido: no
  hay un piso aparte por venir referido.
- Élite con fecha de vencimiento opcional.
- Reglas completas en `CLAUDE.md` (regla 4) y borrador para el comisionista en
  `docs/terminos-borrador.md`.

---

## 2. Referidos (fase 7)

Sustituye la vigencia fija de 6 meses.

### Reglas

1. **Vigencia del vínculo:** `referido_vigencia_meses` (12) contados desde el **primer trabajo
   pagado del referido** (antes de eso el vínculo está "en espera" y no corre el reloj). Por
   vínculo, admin_org puede **ampliar, acortar o quitar** el bono, siempre con motivo; queda en
   bitácora. La fecha de fin se ve en la ficha del referidor (y en la del referido, solo staff).
2. **Escalón por referidos activos:**

   | Referidos activos | Bono |
   |---|---|
   | 1–2 | 2% |
   | 3–4 | 3% |
   | 5–7 | 4% |
   | 8 o más | 5% |

   **Activo** = el referido tuvo ≥1 trabajo pagado en los últimos `referido_activo_meses` (3).
   Se cuenta al cierre de cada mes.
3. **Base del bono:** los honorarios del trabajo del referido, **sin IVA y sin terceros** (la
   misma base de su comisión). El bono **sale del margen de la organización**: nunca se le
   descuenta al referido.
4. **Actividad del que refiere:** cobra el bono de un mes solo si él mismo tuvo **≥1 trabajo
   pagado en los últimos `referido_actividad_meses` (3)**, contando el mes del cierre. Si no,
   ese mes no genera bono y **no se acumula** ni se paga después.
5. **Pérdida:** con `referido_perdida_meses` (6) meses seguidos sin trabajos pagados, todos sus
   vínculos pasan a **liberado**, definitivo (no se reactivan aunque vuelva a trabajar). Aviso
   en su inicio desde `referido_aviso_meses` (4) meses de inactividad: "Llevas 4 meses sin
   trabajos pagados: a los 6 pierdes tus referidos".
6. **Un solo nivel:** el referido de mi referido no me genera nada.
7. **Tope 30% por trabajo:** si comisión del referido + bono pasan de 30% (p. ej. un Élite de
   28% + bono de 5%), **se recorta el bono del referidor**, nunca la comisión del referido. En el
   estado de cuenta del referidor la línea dice **"Bono ajustado por tope"** con el monto ya
   recortado (sin mostrar el porcentaje ni la comisión del referido).
8. **Antifraude:** nadie se refiere a sí mismo, y el vínculo **no se bloquea en silencio** si el
   referido comparte con el referidor **RFC, teléfono, correo o cuenta bancaria de cobro**:
   queda **"en revisión"** y le aparece a admin_org en Alertas para aprobarlo o anularlo. En
   revisión no genera bono (y no se paga retroactivo lo de esos meses: **por confirmar al
   construir**). Admin_org puede **anular** cualquier vínculo con motivo.
9. El vínculo se crea en el alta (o en la importación, columna "referido por"); no se cambia de
   referidor después.

### Esquema

```
ajustes
  + referido_vigencia_meses  smallint default 12
  + referido_activo_meses    smallint default 3     -- para contar referidos activos
  + referido_actividad_meses smallint default 3     -- para que el referidor cobre
  + referido_perdida_meses   smallint default 6
  + referido_aviso_meses     smallint default 4

referido_escalones                       -- 1→2%, 3→3%, 5→4%, 8→5% por omisión
  organizacion_id, desde_activos smallint, porcentaje numeric(5,2) check (> 0 and <= 5)
  pk (organizacion_id, desde_activos)

vinculos_referido                        -- reemplaza comisionistas.referido_por
  organizacion_id, id
  referidor_id, referido_id              -- referido_id único por organización (un solo referidor)
  estado   'en_revision' | 'en_espera' | 'vigente' | 'vencido' | 'quitado' | 'anulado' | 'liberado'
  coincidencias text[]                   -- 'rfc' | 'telefono' | 'correo' | 'cuenta' (por qué en revisión)
  inicio   date      -- primer trabajo pagado del referido; nulo en espera
  fin      date      -- inicio + vigencia; editable por admin_org con motivo
  creado_en, creado_por
  check (referidor_id <> referido_id)

eventos_vinculo                          -- aprobar / ampliar / acortar / quitar / anular / liberar
  organizacion_id, id, vinculo_id, tipo, fin_anterior, fin_nuevo, motivo, persona_id, creado_en

comisiones (ya existe)
  + tope_ajustado boolean default false  -- la línea "Bono ajustado por tope"
```

- **Cálculo** al aprobar el cierre del mes M (dentro de `ejecutar_aprobacion_cierre`):
  1. Vínculos en espera cuyo referido tuvo su primer trabajo pagado → `vigente`, `inicio`, `fin`.
  2. Vigentes con `fin` < M → `vencido`.
  3. Referidores con `referido_perdida_meses` sin pagos → sus vínculos `liberado` (+ evento).
  4. Para cada referidor activo (regla 4): porcentaje del escalón según sus referidos activos
     con vínculo vigente; por cada trabajo pagado de esos referidos en M, una comisión
     `tipo = 'referido'` ligada al trabajo, recortada a lo que quede del 30% (regla 7).
- `comisionistas.referido_por` se migra a `vinculos_referido` y se elimina después.
- Funciones: `cambiar_vinculo(p_vinculo, p_accion, p_fin, p_motivo)` (admin_org),
  `mis_referidos()` (el referidor ve nombre, estado y fin; **nunca montos** del referido).

### Pendiente para construirla

- **Cuenta bancaria de cobro del comisionista:** Tasa hoy **no la guarda** (sus pagos de
  comisión llevan solo la referencia). Para comparar cuentas en el antifraude hay que agregar
  `comisionistas.clabe_cobro` (con dígito de control; visible solo para él y staff). Es un dato
  sensible más: confirmar al empezar la fase. Sin ella, el antifraude compara RFC, teléfono y
  correo.

---

## 3. Herramientas y membresías (fase 8)

### Los tres productos

| Producto | Cómo se entrega | Nota |
|---|---|---|
| Consulta catastral (skill `consulta-catastral-qro`) | automática (después) | ficha + PDF + DXF |
| Estimación rápida (skill `estimacion-valor`, **sin** revisión) | automática (después), en minutos | PDF con la leyenda "No es opinión de valor ni avalúo". Compite con servicios tipo Valuum |
| OV express (revisada por valuador MGP) | el equipo la revisa | producto premium |

**Mientras no haya plan de automáticas, las tres van por pedido manual:** el comisionista pide la
herramienta en Tasa, el equipo la atiende fuera y sube el entregable; **al entregarla** Tasa
descuenta el cupo o genera el cargo. El plan de automáticas (dependencias, costo por uso,
llaves, términos de uso de los sitios) se presenta aparte antes de construir.

### Cupos mensuales (no se acumulan)

|                       | Enlace | Aliado | Socio | Socio Plus | Membresía Básica | Membresía Pro |
|-----------------------|-------:|-------:|------:|-----------:|-----------------:|--------------:|
| Cuota mensual         | 0      | 0      | 0     | 0          | $490             | $990          |
| Consultas catastrales | 2      | 5      | 15    | 30         | 10               | 25            |
| Estimación rápida     | 3      | 10     | 30    | sin límite*| 10               | 30            |
| OV express            | 0      | 1      | 2     | 4          | 1                | 3             |

\* Uso justo: tope técnico oculto de `uso_justo_estimaciones` (100) al mes. Al llegar:
"Alcanzaste el uso justo del mes; escríbenos si necesitas más."

- **Cupo efectivo** = el mayor, herramienta por herramienta, entre lo de su **nivel pagado**
  (incluido el piso de bienvenida o arranque) y lo de su membresía. El cotizador es ilimitado.
- **Adicionales** (pasado el cupo), parámetros: OV express **$1,200**, consulta catastral **$60**,
  estimación rápida **$50**.
- **Bonificación:** si al cerrar el mes su **nivel real (por promedio)** es Aliado o más, la
  membresía del mes siguiente se bonifica sola. El piso de bienvenida o arranque **no** cuenta
  para bonificar.
- **Términos:** la OV express incluida es para prospección; si el cliente final paga una OV, va
  como trámite normal con comisión.

### Cobro

- **Adicionales → cargo en su estado de cuenta** (tipo `cargo`, ya existe): se descuenta de su
  siguiente pago de comisión. **Sin saldo positivo**, el adicional se pide **prepagado**: sube su
  comprobante y se confirma a mano, como cualquier pago.
- **Membresía → prepagada** por transferencia, reportada y confirmada a mano (sin pasarela). Se
  activa al confirmarse.

### Esquema

```
herramienta (texto con check): 'consulta_catastral' | 'estimacion_rapida' | 'ov_express'

ajustes
  + uso_justo_estimaciones smallint default 100

planes_membresia
  organizacion_id, id, clave ('basica' | 'pro' | …), nombre, cuota numeric, activo

cupos                                    -- una fila por (nivel o plan) × herramienta
  organizacion_id, id, nivel_id null, plan_id null, herramienta, cantidad integer null
  check (num_nonnulls(nivel_id, plan_id) = 1)   -- cantidad nula = sin límite (con uso justo)

precios_herramienta                      -- adicionales: 1,200 / 60 / 50
  organizacion_id, herramienta, precio numeric

membresias                               -- una por comisionista y mes
  organizacion_id, id, comisionista_id, plan_id, mes date
  estado 'por_pagar' | 'pagada' | 'bonificada' | 'cancelada'
  pago_id null, bonificada_por_nivel_id null
  unique (organizacion_id, comisionista_id, mes)

pedidos_herramienta                      -- tabla propia, FUERA de solicitudes; bitácora de uso
  organizacion_id, id, comisionista_id, herramienta, mes date
  datos jsonb (ubicación, clave catastral, superficies…)
  estado 'pedida' | 'por_prepagar' | 'entregada' | 'cancelada'
  pedido_en, entregado_en, entregado_por, entregable_ruta (bucket privado)
  fuente 'cupo' | 'adicional' (se fija al entregar), cargo_id null (comisiones tipo 'cargo'),
  pago_id null (si fue prepagado)
```

- **Nunca genera comisión, folio, conector ni cierre**: por eso no vive en `solicitudes`. En la
  pantalla del comisionista se ve como un tipo más al pedir ("Herramienta").
- `cupo_disponible(p_comisionista, p_herramienta, p_mes)`: cupo efectivo menos entregados del
  mes. Lo ve antes de pedir ("te quedan 3 consultas este mes; la siguiente cuesta $60").
- `entregar_herramienta(p_pedido, p_ruta)`: staff; fija `fuente` y, si es adicional, crea el
  cargo. Cancelar un pedido entregado con cargo anula el cargo (con motivo), como los demás
  deshacer.
- Las automáticas entrarán por la misma tabla: el pedido lo atiende un proceso del servidor en
  vez del equipo.
