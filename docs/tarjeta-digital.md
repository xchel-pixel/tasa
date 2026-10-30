# Tarjeta digital del comisionista (0046)

**Liga pública:** `/t/<org>/<slug>`. El slug es el que ya tiene cada comisionista; su código de referido también abre la tarjeta. Está pensada para celular y para WhatsApp: la vista previa al pegar la liga trae nombre, frase y foto (Open Graph).

## Qué muestra

- Foto, nombre para mostrar, frase, zona y la leyenda fija **"Asesor afiliado"**.
- **"Solicita tu avalúo o cotización":** abre su liga de clientes, ya atribuida a él.
- **"Escríbeme por WhatsApp":** usa un teléfono propio de la tarjeta, prellenado con el de su registro.
- **Correo:** solo si decide mostrarlo.
- **"Guardar contacto":** descarga una vCard en `/t/…/vcard`.
- **Aviso de privacidad:** enlazado al pie.
- **Prohibido en el texto libre** (frase, zona y testimonios): perito, pericial, valuador o valuadora, MGP, AP73 y ARQOS. Lo bloquea la base con `palabra_prohibida`.

## Por nivel del mes

`nivel_tarjeta` lee el nivel con `nivel_vigente`; Élite cuenta como Socio Plus.

| Nivel | Agrega |
|---|---|
| Enlace | Tarjeta básica y QR |
| Aliado | Su logo y su color |
| Socio | Estadísticas por mes: visitas, clics en WhatsApp y solicitudes por su liga |
| Socio Plus | Servicios destacados (del catálogo, hasta 6) y testimonios aprobados |

Si baja de nivel, lo extra se oculta, pero no se borra.

## Estados

| Estado | Quién lo pone | Qué ve el público |
|---|---|---|
| Sin publicar | Al guardar la primera vez | "Esta tarjeta no está disponible" |
| Publicada | El comisionista, o admin_org al volver a publicar | La tarjeta |
| En pausa | El comisionista (la reactiva él) o admin_org | "Esta tarjeta no está disponible" |
| Despublicada | Solo admin_org, con motivo | "Esta tarjeta no está disponible" |

Una tarjeta despublicada solo la vuelve a publicar admin_org. Si el comisionista está inactivo, la tarjeta también sale como "no disponible".

## Fotos, estadísticas y testimonios

- **Fotos:** en el bucket **público** `tarjetas` (WhatsApp necesita abrir la imagen sin sesión). Solo foto y logo, con nombres no adivinables, en `<org>/<persona>/<uuid>`.
  - La foto se recorta al cuadrado en el teléfono, sin librerías, a 512 px y máximo 2 MB.
  - La imagen anterior se borra al cambiarla.
- **Estadísticas:** un contador por día (`tarjeta_eventos`), sin IP, cookies ni nada de quien visita. La visita se cuenta en el navegador, así que los robots de la vista previa no cuentan. Las del propio comisionista con sesión tampoco.
- **Testimonios:** los captura el comisionista con el nombre o las iniciales del cliente, y admin_org los aprueba o rechaza en Administración → Testimonios. Todo queda en bitácora.

## Pantallas

- **Comisionista:**
  - "Mi tarjeta" (`/tarjeta`): editor con vista previa en vivo, publicar o pausar, estadísticas y testimonios.
  - En su inicio, "Compartir mi tarjeta": WhatsApp, copiar liga y descargar QR.
- **Staff:**
  - En la ficha del comisionista, la sección "Tarjeta digital" (ver, pausar, despublicar o volver a publicar).
  - `/admin/testimonios` y su aviso en el inicio de admin_org.
- **El equipo** sigue con su liga de clientes; la tarjeta es solo para comisionistas.

## Pruebas

- "Tarjeta digital" en `verificaciones.sql`.
- En DEMO hay tarjetas en los cuatro niveles y una en pausa (`pruebas/demo.test.ts`).
- Humo abre `/t/` sin sesión, "Mi tarjeta" como comisionista y "Testimonios" como admin_org.
