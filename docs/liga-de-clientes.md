# Liga de clientes (0037)

`/s/<organización>/<código>`, sin sesión. El código es el mismo de referido (comisionista o
miembro del equipo). El cliente no tiene cuenta: el seguimiento lo da el dueño de la liga.

- **Página:** "Solicitud con <nombre para mostrar>". Nunca correo ni teléfono del dueño
  (`datos_liga_cliente` solo devuelve nombre para mostrar, organización, servicios y versión del aviso).
- **Formulario:** nombre, teléfono (10 dígitos, obligatorio), correo (opcional), servicio (Catálogos),
  "Solo cotización" (`cotizacion`) o "Quiero el trámite" (`tramite_directo`), ubicación, tipo de
  inmueble, clave catastral y comentarios (opcionales), hasta 3 archivos PDF/imagen de 10 MB, y el
  aviso de privacidad obligatorio.
- **Antispam:** campo trampa, mínimo 4 segundos llenando, y en la base: 5 por conexión (IP en hash),
  3 por teléfono y 200 por organización al día. Sin captcha.
- **Atribución** (`solicitudes.origen = 'liga_cliente'`, `liga_de` = dueño):
  - comisionista activo → `comisionista_id` = él, comisión normal;
  - equipo o admin_org → sin comisionista, solo seguimiento, sin comisión;
  - dueño inactivo → sin comisionista, `liga_sin_dueno`, alerta `liga_inactiva` a admin_org.
  `comisionista_id` es opcional solo para solicitudes de liga (`solicitudes_con_dueno`).
- **Adjuntos:** bucket privado `clientes`, ruta `<org>/<solicitud>/<token>/<archivo>`. Solo se
  escribe con el token de la solicitud, en sus primeros 30 minutos, hasta 3. Los ve el staff (URL
  firmada en la ficha de la solicitud) y el comisionista dueño.
- **Avisos:** "Solicitudes de tus clientes" en el inicio del dueño (`mis_solicitudes_de_liga`) y
  correo; a admin y finanzas, el contador "Solicitudes por cotizar" dice cuántas llegaron por liga.
  Al cliente: pantalla "Recibimos tu solicitud" y correo si dejó correo. Los correos los manda el
  servidor con la llave de servicio (`datos_aviso_liga`, solo `service_role`).
- **Tarjeta "Para tus clientes"** (comisionista, equipo, admin_org): copiar liga, WhatsApp con
  mensaje y QR descargable (librería `qrcode`, generado en el teléfono).
