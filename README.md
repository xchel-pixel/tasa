# Tasa

Portal para comisionistas de servicios de valuación. Se despliega en `tasa.xgplataform.com`.

> Estado: esquema de base de datos listo y probado. La aplicación de Next.js es la siguiente etapa;
> este README se completa con ella (variables de entorno, cron y despliegue en Vercel).

## Correr la aplicación en tu computadora

```bash
npm install
npm run dev
```

Abre `http://localhost:3000`. Necesita en `.env.local` la URL y la llave `anon` del proyecto de
pruebas (Settings → API Keys). Desde el celular, en la misma red Wi-Fi, entra por la IP de la
computadora (`http://192.168.x.x:3000`).

### Acceso por código: lo que hay que configurar en Supabase

En el proyecto (pruebas y producción), en **Authentication**:

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
4. **URL Configuration → Site URL**: `https://tasa.xgplataform.com` en producción.

## Pruebas locales

```bash
npm install
npm test
```

Corre las migraciones, la semilla y `supabase/verificaciones.sql` en PGlite (un Postgres que
vive dentro de Node). No toca Supabase ni necesita internet después de instalar.

## Base de datos (CLI de Supabase)

Las migraciones se empujan con la CLI, que deja registro de cuáles ya se aplicaron en cada
proyecto. Hay dos proyectos: **pruebas** (con semilla) y **producción** (sin semilla, nunca).

Una sola vez por computadora:

```bash
npx supabase login
```

Abre el navegador para autorizar la CLI con tu cuenta de Supabase.

Luego copia `.env.example` como `.env.local` y llena el ref y la contraseña de cada proyecto
(el archivo explica dónde encontrar cada dato).

| Comando | Qué hace |
|---|---|
| `npm run db:pruebas` | Amarra el proyecto de pruebas y empuja las migraciones pendientes |
| `npm run db:pruebas:semilla` | Carga la semilla de prueba (una sola vez) y la comprueba |
| `npm run db:pruebas:verificar` | Corre las verificaciones; no dejan rastro |
| `npm run db:produccion` | Amarra producción y empuja migraciones. No hay semilla para producción |

Cada comando vuelve a amarrar el proyecto antes de actuar, así que nunca depende de cuál quedó
amarrado la última vez. La CLI pide confirmar antes de empujar.

Después de empujar, comprueba contra la base real (en el SQL Editor):

```sql
select table_name from information_schema.tables
where table_schema = 'public' order by 1;
```

Deben aparecer 16 tablas: `alertas`, `bitacora`, `cierres`, `comisiones`, `comisionistas`,
`cotizaciones`, `cuentas_receptoras`, `historial_estatus`, `mapeo_estatus`, `marcas`,
`niveles`, `niveles_mensuales`, `pagos`, `personas`, `servicios`, `solicitudes`.

En producción, después de las migraciones, das de alta tu persona como `super_admin` con tu
correo real.

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
