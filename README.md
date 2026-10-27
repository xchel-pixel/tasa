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
