# Tarjeta digital del comisionista (0046, 0050)

**Liga pública:** `/t/<org>/<slug>`. El slug es el que ya tiene cada comisionista; su código de referido también abre la tarjeta. Está pensada para celular y para WhatsApp: la vista previa al pegar la liga trae nombre, frase y foto (Open Graph).

## Qué muestra

- Foto, nombre para mostrar, frase, zona y la leyenda fija **"Asesor afiliado"**.
- **"Solicita tu avalúo o cotización":** abre su liga de clientes, ya atribuida a él.
- **"Escríbeme por WhatsApp":** usa un teléfono propio de la tarjeta, prellenado con el de su registro.
- **Correo:** solo si decide mostrarlo.
- **"Guardar contacto":** descarga una vCard en `/t/…/vcard`.
- **Aviso de privacidad:** enlazado al pie.
- **Prohibido en el texto libre** (frase, zona y testimonios): perito, pericial, valuador o valuadora, MGP, AP73 y ARQOS. Lo bloquea la base con `palabra_prohibida`.

## Tarjeta de presentación (0050)

La tarjeta presenta al comisionista, no solo el servicio del despacho. Dos responsabilidades a la vista:

- **"Avalúos y valuación · despacho aliado":** el botón "Solicita tu avalúo o cotización" y la nota de independencia (y, en Socio Plus, los servicios destacados del despacho). Siempre se ve; el comisionista solo elige si va arriba o abajo de sus servicios.
- **"Mis servicios":** los suyos (título, descripción de hasta 160, ícono de una lista fija, enlace opcional), en el orden que elija (arrastrando desde ⠿ o con flechas). Debajo, fijo: "Servicios ofrecidos directamente por {nombre}."
- **Redes:** Facebook, Instagram, TikTok, LinkedIn y sitio web; la base solo acepta ligas de esa red (`red_valida`).
- **Portafolio (Socio en adelante):** inmuebles con foto 4:3 (bucket `tarjetas`, 2 MB), título, venta o renta, precio opcional, zona (nunca la dirección) y enlace. "Me interesa" abre WhatsApp con el nombre del inmueble.
- **Moderación:** admin_org oculta un servicio o un inmueble con motivo desde la ficha del comisionista; él ve el motivo en "Mi tarjeta".
- **Clics:** por servicio propio (su enlace) y por inmueble ("Me interesa" o su enlace), contador por día en `tarjeta_clics`.

Todo texto libre pasa por `palabra_prohibida`. El comisionista escribe por funciones (`guardar_mi_servicio`, `guardar_mi_inmueble`, `ordenar_mi_tarjeta`, `borrar_de_mi_tarjeta`, `guardar_mis_redes`).

## Por nivel del mes

`nivel_tarjeta` lee el nivel con `nivel_vigente`; Élite cuenta como Socio Plus. Los topes salen de `limite_tarjeta`.

| Nivel | Agrega |
|---|---|
| Enlace | Tarjeta básica, QR, redes y hasta 3 servicios propios |
| Aliado | Su logo y su color; hasta 6 servicios propios |
| Socio | Estadísticas por mes (visitas, WhatsApp, solicitudes y clics por servicio e inmueble) y portafolio de hasta 6 |
| Socio Plus | Servicios propios y portafolio sin límite (tope técnico de 30), servicios destacados del despacho y testimonios |

Si baja de nivel, lo que excede se oculta (los últimos en su orden), pero no se borra; "Mi tarjeta" dice qué se ocultó y qué nivel lo recupera. Mientras tenga más de lo que su nivel permite, no puede agregar.

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
