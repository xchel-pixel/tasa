# Nota de independencia, pagos por entregar y asignar trámites (0047)

## Nota de independencia

Le dice al cliente que el despacho es independiente y que el comisionista es asesor afiliado. Los tres textos viven en **Ajustes → Nota de independencia**: los edita admin_org, cada cambio sube la versión y queda en bitácora. `{nombre}` se cambia por el nombre para mostrar del comisionista.

| Dónde | Texto |
|---|---|
| Tarjeta `/t/`, debajo de "Solicita tu avalúo o cotización" | Corto (`nota_tarjeta`) |
| Liga de cliente `/s/`: recuadro antes de enviar, "Recibimos tu solicitud" y el correo al cliente | Completo (`nota_liga`) |
| Pie del PDF de la cotización | `nota_pdf`: "Servicio recomendado por {nombre}, asesor afiliado independiente." |

- **Solo cuando el trabajo llegó por un comisionista.** En las ligas del equipo o de admin_org no se muestra, porque son del despacho. Sin comisionista, el PDF ya no lleva la línea del pie.
- **Versión que vio el cliente:** la solicitud por liga anota `nota_version`.
- **Términos v3:** cambiaron los puntos 3, 10 y 11; el texto está en `docs/textos-produccion/terminos-v3.txt`. Al cargarlos sube `terminos_version` y los comisionistas los vuelven a aceptar al entrar.

## Pagos que recibe el comisionista

**Al reportar un pago**, el comisionista elige "El cliente pagó a la cuenta" o "Lo recibí yo".
- **Lo recibí yo:** puede ser una transferencia a su cuenta (con comprobante) o efectivo; un aviso sin archivo no basta.
- **Plazo:** el pago queda **por entregar** con fecha límite `entregar_antes`, que son 2 días hábiles desde la fecha del pago.
- **Días hábiles:** `sumar_dias_habiles` se salta sábados, domingos y los descansos obligatorios de la LFT (art. 74):
  - 1 de enero, 1 de mayo, 16 de septiembre y 25 de diciembre;
  - primer lunes de febrero, tercer lunes de marzo y tercer lunes de noviembre;
  - 1 de octubre cada seis años.

**Al entregarlo:** marca "Ya lo entregué" en la ficha del trabajo con el comprobante del depósito. Administración lo confirma cuando ve el dinero en la cuenta, como cualquier pago.

**Si se vence:** el cron (`alertar_entregas_vencidas`) levanta una alerta "Pago por entregar" para admin y finanzas, una por trabajo. La alerta se resuelve sola cuando ya no queda nada vencido. DEMO no alerta.

**Fecha que cuenta:** el trabajo cuenta como pagado con la fecha en que el dinero llegó a la cuenta (`fecha_en_cuenta`), no con la del cobro al cliente. De esa fecha depende el mes de la comisión.

**Dónde se ve:** el comisionista lo ve en su inicio ("Pagos por entregar a la cuenta") y en la ficha. Administración lo ve en Pagos por confirmar y en la ficha.

## Asignar o cambiar comisionista

En la ficha del trabajo y en la de la solicitud por cotizar.
- **Quién:** admin_org, y finanzas si en Ajustes está encendido "Finanzas también asigna comisionistas".
- **Cómo:** con motivo; queda en el historial del trabajo y en bitácora.
- **Aviso:** al comisionista le llega el correo "Se te asignó el trámite {folio}".
- **La comisión se mueve.** Al anterior:
  - si su mes sigue abierto, se le borra;
  - si ya cerró, entra un **cargo** que la anula (`anula_id`) en el siguiente cierre.

  Al nuevo se le devenga si el trabajo ya está pagado: como comisión normal si el mes del pago sigue abierto, o como **ajuste** en el siguiente cierre si ya cerró.
- **Tope del 30%:** no cuenta dos veces una comisión anulada.
- **Sin efecto hacia atrás:** el bono de referido que ya se calculó en un cierre aprobado no se recalcula.
- **Notion (0049):** si el trabajo ya tiene página, en la siguiente vuelta del cron (máx. 15 min) se escribe **solo** "Solicitado por" con el nombre para mostrar del comisionista nuevo; nada más se escribe en Notion. Pasa lo mismo al traer un trámite de Notion. Queda en el historial ("Notion actualizado") y en bitácora. Si la página ya no existe o Notion la rechaza, alerta "externo_solicitado" para admin_org; no se reintenta y el cambio en Tasa no se bloquea.

## Genera comisión: sí o no

Por trámite, con motivo (por ejemplo, el comisionista solo lo recomendó y ya estaba pactado distinto).
- **"No":** pone la regla de comisión en `ninguna`. Sin comisión tampoco hay bono de referido ni cuenta para su nivel. Si ya la había generado, se le quita, con las mismas reglas de mes abierto o cerrado.
- **"Sí" otra vez:** regresa la regla que tenía, incluido el % fijo de un convenio.
- **Convenios:** lo que viene de un convenio sin comisión no se cambia aquí, sino en el convenio.

## Traer trámite de Notion

En Trámites → "Traer trámite de Notion" (`/admin/traer-de-notion`), con los mismos permisos que asignar.
1. **Buscar:** se escribe el folio `PREFIJO-AAAA-NNNN` y Tasa busca la página con ese folio en el título.
   - **La clave de Notion:** la acción la lee en el servidor con la llave de servicio, después de revisar el permiso; nunca llega al navegador.
2. **Vista previa:** muestra página, tipo, cotización, etapa y fecha de aceptación. Se elige el comisionista y se completa lo que Tasa necesita y Notion no trae: marca, cuenta, servicio y dirección.
3. **Se crea en Tasa** (`importar_tramite`) ligado a **esa** página, con su folio. El conector no crea otra.
   - **Duplicados:** si el folio o la página ya están en Tasa, lo dice.
   - **Sincronización:** de ahí en adelante se sincroniza normal. Sus páginas no son del medio "Tasa", así que mientras haya trámites traídos el cron lee todas las páginas editadas; la base ignora las que no conoce.
4. **Pagos previos:** no se toman de Notion. Se registran aparte con su fecha real, para que la comisión caiga en su mes.

**En DEMO** no hay Notion: la lectura se simula con datos sintéticos y la página se llama `demo-…`. La base solo acepta ese prefijo en DEMO.

## Pruebas y DEMO

- **Pruebas:** "Nota de independencia", "Pagos por entregar", "Asignar comisionista y genera comisión" y "Traer trámite de Notion", en `supabase/verificaciones.sql`.
- **DEMO:**
  - un pago por entregar vencido, con alerta, y uno ya entregado;
  - un trámite reasignado y uno que no genera comisión;
  - un trámite traído de Notion.

  Lo comprueba `pruebas/demo.test.ts`.
