# Tasa

Portal para comisionistas de servicios de valuación. Se despliega en `tasa.xgplataform.com`.

> Estado: base de datos, migraciones por CLI y acceso por código listos. Faltan las pantallas por
> rol, Notion, correos y el despliegue en Vercel (este README se completa con ellos).

## Correr la aplicación en tu computadora

```bash
npm install
npm run dev
```

Abre `http://localhost:3100` (3100 y no 3000, para no chocar con Pulso). Necesita `.env.local`
lleno (ver `.env.example`). Desde el celular, en la misma red Wi-Fi, entra por la IP de la
computadora (`http://192.168.x.x:3100`).

### Acceso por código: lo que hay que configurar en Supabase

En el proyecto, en **Authentication**:

1. **Sign In / Providers → Email**: habilitado, con "Confirm email" activo. "Allow new users
   to sign up" se queda **encendido**: quien decide si alguien entra es `correo_en_padron()`,
   no esta casilla; si se apaga, nadie nuevo puede recibir su primer código.
2. **Emails → Templates → Magic Link**: el correo debe mostrar el código, no una liga.
   Cambia el cuerpo por algo como:
   ```html
   <h2>Tu código para entrar a Tasa</h2>
   <p style="font-size:28px;letter-spacing:6px"><strong>{{ .Token }}</strong></p>
   <p>Vence en una hora. Si pediste más de uno, solo sirve el más reciente.</p>
   ```
3. **Emails → SMTP Settings**: apunta a Resend (host `smtp.resend.com`, puerto 465, usuario
   `resend`, contraseña = una API key de Resend), remitente `@xgplataform.com`.
4. **URL Configuration**:

   | | Ahora (pruebas) | Al lanzar |
   |---|---|---|
   | Site URL | `http://localhost:3100` | `https://tasa.xgplataform.com` |
   | Redirect URLs | `http://localhost:3100/**` | `https://tasa.xgplataform.com/**` (y quita la de localhost) |

   El acceso es por código, no por liga, así que estas URLs casi no se usan; Supabase las pide
   y las pone en los correos. Si algún día se agrega una liga, ya estarán bien.

## Pruebas locales

```bash
npm install
npm test
```

Corre las migraciones, la semilla y `supabase/verificaciones.sql` en PGlite (un Postgres que
vive dentro de Node). No toca Supabase ni necesita internet después de instalar.

## Base de datos (CLI de Supabase)

Tasa usa **un solo proyecto** de Supabase (plan gratuito). Hoy es de pruebas, con semilla;
antes de lanzar se resetea y queda como producción, sin semilla, en ese mismo proyecto.
`TASA_MODO` en `.env.local` dice en qué etapa está.

Una sola vez por computadora:

```bash
npx supabase login
```

Luego copia `.env.example` como `.env.local` y llénalo (el archivo dice dónde está cada dato).

| Comando | Qué hace | Modo |
|---|---|---|
| `npm run db:push` | Empuja las migraciones pendientes. La CLI pide confirmar | cualquiera |
| `npm run db:semilla` | Carga la semilla de prueba (una sola vez) y la comprueba | solo pruebas |
| `npm run db:verificar` | Corre las verificaciones; no dejan rastro | solo pruebas |
| `npm run db:reset-produccion` | Borra todo, aplica migraciones sin semilla, pasa a producción | solo pruebas |

Cada comando vuelve a amarrar el proyecto antes de actuar. Las migraciones aplicadas quedan
registradas en el proyecto: `db:push` solo aplica las que falten.

### Pasar a producción (una sola vez, antes de lanzar)

```bash
npm run db:reset-produccion
```

1. Te pide escribir el nombre del proyecto (`tasa`). Si no coincide, no hace nada.
2. **Borra todas las tablas y sus datos** (la semilla incluida) y vuelve a aplicar todas las
   migraciones, sin semilla. La CLI también pide confirmar.
3. Cambia `TASA_MODO` a `produccion` en `.env.local`. Desde ese momento la semilla, las
   verificaciones y este mismo reset se niegan a correr: ya hay datos reales.
4. Da de alta tu persona como super_admin en el SQL Editor:
   ```sql
   insert into personas (nombre, correo, rol)
   values ('<tu nombre>', '<tu correo>', 'super_admin');
   ```
   Si ya habías entrado durante las pruebas, tu usuario de autenticación sigue existiendo y se
   amarra solo la próxima vez que entres.

El reset no toca los usuarios de autenticación ni los archivos de Storage. Los usuarios de
prueba (`@tasa.test`) se pueden borrar desde Authentication → Users.

### Comprobar contra la base real

En el SQL Editor:

```sql
select table_name from information_schema.tables
where table_schema = 'public' order by 1;
```

Deben aparecer 17 tablas: `ajustes`, `alertas`, `bitacora`, `cierres`, `comisiones`, `comisionistas`,
`cotizaciones`, `cuentas_receptoras`, `historial_estatus`, `mapeo_estatus`, `marcas`,
`niveles`, `niveles_mensuales`, `pagos`, `personas`, `servicios`, `solicitudes`.

## Plan de lo que falta

En este orden. Lo marcado como **por decidir** se pregunta antes de construir.

1. **Panel de administración**: pagos por confirmar primero, alertas de Notion, cotizar y
   emitir, alta de comisionistas, cuentas receptoras, mapeo de estatus y cierre mensual.

2. **Aceptación de términos del comisionista**
   - Casilla + fecha de aceptación guardadas en la base.
   - Texto de términos editable por super_admin (en Ajustes), que incluya "cuenta personal e
     intransferible". Se guarda qué versión del texto aceptó cada quien.
   - **Por decidir:** quién marca la casilla. Si la marca el administrador al dar de alta, no
     es una aceptación del comisionista. Propuesta: el alta queda pendiente y el comisionista
     acepta en su primer acceso (no puede usar Tasa hasta aceptar); si el texto cambia, se le
     vuelve a pedir.

3. **Solicitud pública por liga del comisionista** (después del panel; antes de la tarjeta
   digital, que la reutilizará)
   - Ruta pública `/s/<slug>`. Slug inexistente o comisionista inactivo: "Este enlace no está
     disponible", sin formulario.
   - Muestra "Te atiende: <nombre> · Asesor afiliado", sin correo ni teléfono del comisionista
     (salvo que él lo active después en su tarjeta).
   - Formulario corto sin cuenta: servicio, tipo (cotización o trámite), inmueble (dirección,
     municipio, clave catastral opcional), cliente (nombre, teléfono, correo) y comentarios.
   - Aviso de privacidad: casilla obligatoria con liga al texto (editable por super_admin en
     Ajustes); se guarda fecha y versión aceptada.
   - Al enviar: solicitud con origen `enlace`, ligada al comisionista, estatus "Solicitada";
     acuse al cliente (sin montos) y aviso al comisionista.
   - Seguridad: anti-bots (Cloudflare Turnstile o equivalente gratuito), campo trampa, límite de
     envíos por IP y por slug por hora. La inserción va por una función `security definer` con
     validación; `anon` sigue sin permisos sobre tablas.
   - Atribución: si el correo o teléfono del cliente ya tiene una solicitud activa de OTRO
     comisionista en los últimos 60 días, se crea igual con alerta "posible cliente duplicado".
   - La cotización se emite al comisionista; en su perfil, opción "enviar copia de la cotización
     a mi cliente" (apagada por omisión).
   - Inicio del comisionista: botón "Compartir mi liga" (copiar y WhatsApp).
   - Pruebas: slug inválido, bot bloqueado, límite de envíos, duplicado entre comisionistas,
     anon sin acceso a tablas.
   - Notas para cuando se construya:
     - `origen` hoy acepta portal, tarjeta, referido y admin: hace falta una migración que agregue
       `enlace`.
     - **Por decidir:** Turnstile es un servicio externo de Cloudflare (gratuito, con llave). Pide
       dos variables de entorno y una cuenta de Cloudflare; confirmar antes de integrarlo.
     - El límite por IP se puede llevar en una tabla con la IP resumida (hash), sin guardarla
       completa, igual que en el control de dispositivos.

4. **Control de dispositivos** (después del panel)
   - Tabla `dispositivos`: persona, id de dispositivo (cookie firmada de larga duración),
     tipo (teléfono/computadora), navegador y sistema, primera vez, último acceso, ciudad
     aproximada (sin guardar la IP completa) y estado (activo, pendiente, revocado).
   - Máximo 2 activos por comisionista; el límite es un parámetro que edita super_admin.
     Administración y finanzas, sin límite.
   - Un tercer dispositivo valida el código, pero su sesión queda **pendiente de autorizar**:
     ve "Este dispositivo necesita autorización del administrador" y se crea una alerta.
   - Comisionista: pantalla "Mis dispositivos" para ver y cerrar sesión en uno.
   - Super_admin: dispositivos por comisionista, aprobar o revocar, "cerrar todas las
     sesiones", y alerta si hay accesos desde dos ciudades distintas el mismo día.
   - El control vive en el servidor: el proxy de sesión consulta el estado del dispositivo en
     cada petición, así que revocar saca al dispositivo en su siguiente petición.
   - Pruebas: tercer dispositivo bloqueado, dispositivo revocado pierde acceso, administración
     sin límite.
   - Notas para cuando se construya:
     - La ciudad sale de los encabezados que Vercel agrega a cada petición (`x-vercel-ip-city`):
       no hace falta un servicio externo ni guardar la IP. En la computadora local no existe.
     - **Por decidir:** borrar cookies, otro navegador o una ventana privada cuentan como
       dispositivo nuevo. Con un límite de 2, un comisionista que borra cookies se queda
       bloqueado hasta que lo autoricen. Propuesta: que un dispositivo sin uso en N días
       (p. ej. 30) se libere solo.
     - Consultar el dispositivo en cada petición agrega una lectura a la base por página; es
       poco para este volumen, pero se mide al construirlo.

5. **Notion** (cron cada 15 min + botón "actualizar"), correos de cambio de estatus y PDF de
   la cotización.

6. **Alta de comisionistas por solicitud** — **construida (0024)**: `/alta/<org>` pública,
   RFC obligatorio y CSF, bandeja de aprobación para admin_org, correos por Resend y aviso de
   privacidad en `/privacidad`. Ver `docs/paso-a-produccion.md` §4b.
   Después, **despliegue** en `tasa.xgplataform.com` y paso a producción con
   `npm run db:reset-produccion`.

7. **Referidos** (después del paso a producción). Vínculo de 12 meses desde el primer trabajo
   pagado del referido, editable por vínculo con motivo; el referidor cobra solo si tuvo un
   trabajo pagado en los últimos 3 meses; a los 6 meses sin trabajos pierde sus referidos
   (aviso a los 4). Escalón 2–5%, un solo nivel, antifraude, tope 30%. Reglas, esquema y lo
   **por decidir** en `docs/referidos-y-herramientas.md`.

8. **Herramientas y membresías.** Consulta catastral, estimación rápida y OV express; cupos
   mensuales por nivel y por membresía (Básica $490, Pro $990), adicionales con cargo,
   bonificación de la membresía desde Aliado. Primero como pedido que atiende el equipo; las
   automáticas después, con su propio plan. Ver `docs/referidos-y-herramientas.md`.

Ya hecho de las reglas de niveles (0023): tasa de bienvenida, arranque y Élite con vencimiento.

## Variables de entorno (previstas)

| Variable | Dónde | Para qué |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Vercel | Proyecto de Supabase |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Vercel | Llave pública; el RLS decide qué se ve |
| `SUPABASE_SERVICE_ROLE_KEY` | Vercel (solo servidor) | Únicamente para `/api/cron` |
| `CRON_SECRET` | Vercel y `pg_cron` | Protege `/api/cron` |
| `NOTION_TOKEN` | Vercel | Integración de Notion. Sin ella, se usa el adaptador simulado |
| `NOTION_DB_TRAMITES` | Vercel | Base de trámites (`0bcd465f-fd85-4665-8fd7-77212ce0328b`) |
| `RESEND_API_KEY` | Vercel | Correos de cambio de estatus |
| `CORREO_REMITENTE` | Vercel | p. ej. `Tasa <avisos@xgplataform.com>` |

## Correo

El dominio `xgplataform.com` ya está verificado en Resend (lo usa Pulso). Si Tasa manda desde una
dirección `@xgplataform.com`, **no hace falta ningún registro DNS nuevo**: solo una API key nueva
para Tasa. Además, en Supabase → Authentication → SMTP, apunta el proyecto de Tasa a Resend para
que los códigos de acceso no salgan por el correo de fábrica.
