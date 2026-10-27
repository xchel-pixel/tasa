# Tasa

Portal para comisionistas de servicios de valuación. Se despliega en `tasa.xgplataform.com`.

> Estado: esquema de base de datos listo y probado. La aplicación de Next.js es la siguiente etapa;
> este README se completa con ella (variables de entorno, cron y despliegue en Vercel).

## Preparar la base de datos

1. Crea un proyecto **nuevo** en Supabase (independiente de Pulso). Región: la más cercana.
2. En el editor SQL, corre en orden los archivos de `supabase/migrations/` (de `0001` a `0008`).
3. Comprueba contra la base real:
   ```sql
   select table_name from information_schema.tables
   where table_schema = 'public' order by 1;
   ```
   Deben aparecer 15 tablas: `bitacora`, `cierres`, `comisiones`, `comisionistas`,
   `cotizaciones`, `cuentas_receptoras`, `historial_estatus`, `mapeo_estatus`, `marcas`,
   `niveles`, `niveles_mensuales`, `pagos`, `personas`, `servicios`, `solicitudes`.
4. **Solo en un proyecto de pruebas:** corre `supabase/semilla_prueba.sql` y luego
   `supabase/verificaciones.sql`. La semilla debe terminar con el aviso "Semilla correcta" y
   las verificaciones con "Verificaciones correctas". Las verificaciones no dejan rastro.

En producción no va la semilla: solo las migraciones, y luego das de alta tu persona como
`super_admin` con tu correo real.

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
