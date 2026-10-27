# Tasa — Portal de comisionistas

## Qué es esto

Portal para comisionistas de servicios de valuación inmobiliaria. Se despliega en
`tasa.xgplataform.com`. Se abre en el celular desde el navegador: **móvil primero**.

Tres roles: `super_admin` (Xchel), `finanzas` (Gaby) y `comisionista`.

Xchel es valuador inmobiliario, no programador de profesión. Construye con ayuda de IA.
Explica las decisiones técnicas en términos de consecuencia, no de jerga.

Pulso (`xchel-pixel/pulso`) es la referencia de arquitectura: **solo lectura**, nunca se modifica
desde aquí. Base de datos, repositorio y proyecto de Vercel independientes.

## Stack

- Next.js (App Router) + TypeScript + Tailwind
- Supabase: Postgres, Auth (código de 6 dígitos al correo), Storage, RLS
- Vercel para despliegue; `pg_cron` de Supabase llama a `/api/cron` cada 15 min
- Notion: fuente de verdad operativa de los trámites y única fuente del folio
- Resend para los correos del sistema; pdf-lib para el PDF de la cotización; vitest para pruebas

**No usar:** IA, pasarelas de pago, WhatsApp, n8n, apps nativas.
Antes de instalar cualquier otra dependencia, pregunta.

## Reglas de idioma

- Dominio en español, en código y en base de datos: `solicitudes`, `cotizaciones`, `pagos`,
  `comisiones`, `cierres`, `niveles`, `cuentas_receptoras`. NUNCA `users`, `payments`, `orders`.
- La interfaz, toda en español.
- Términos técnicos genéricos (componentes, hooks, utilidades) en inglés.

## Reglas de negocio que viven en la base

Están en las migraciones y las prueba `supabase/verificaciones.sql`. No se duplican en la app:
la app las muestra, la base las hace cumplir.

1. **Tope 30% por trabajo** (comisión + bonos + ajustes + referido; los cargos no cuentan).
2. **Cierre aprobado = bloqueado.** No se reabre. Lo posterior entra como cargo en el mes abierto.
3. **Devengo:** la comisión nace sola cuando lo confirmado alcanza el total. `pagado_en` es la
   fecha del pago que completa el 100%; `mes_cierre` es ese mes o el siguiente abierto.
4. **Nivel:** promedio de honorarios pagados de los 3 meses anteriores (desde el alta, meses en
   cero incluidos). Se calcula al aprobar el cierre y aplica a todo el mes siguiente.
5. **Pagos:** todo entra como `reportado`; luego `confirmado` o `rechazado` (con motivo). Un pago
   no se edita ni regresa.
6. **"Pagado", "Solicitada", "Cotizada", "Aceptada" y "Cancelada" los decide Tasa.** Lo de en
   medio lo traduce `mapeo_estatus` desde la "Etapa" de Notion.
7. **El folio lo da Notion.** Tasa nunca genera folios.
8. Total = honorarios + IVA (16% de honorarios, solo si `requiere_factura`) + terceros. La
   comisión siempre sobre honorarios sin IVA.

## Reglas técnicas

- Sin columna de empresa: Tasa es un solo negocio. El RLS se amarra a la persona y su rol.
- **Toda tabla nueva:** RLS encendido y `revoke all on [tabla] from anon;`. Ver
  `supabase/migrations/LEEME.md`.
- **Buckets privados** (`comprobantes`, `cotizaciones`), siempre por URL firmada.
- La llave de servicio de Supabase solo existe en `/api/cron`, protegida con `CRON_SECRET`.
  Nunca en el navegador, nunca en otra ruta.
- Migraciones numeradas en `supabase/migrations/`; una aplicada no se edita nunca.
- Verificar contra la base real, no contra los archivos SQL.
- Fechas de corte en `America/Mexico_City`: usar `hoy_mx()` y `mes_de()`, nunca `current_date`.

## Cómo trabajar con Xchel

- Cambios chicos y verificables. Una fase a la vez.
- Deuda técnica y decisiones de arquitectura se preguntan antes, no se avisan después.
- Si detectas un error o una debilidad en lo que pide, díselo directo.
- Al terminar una tarea, di qué probar en el navegador para confirmar que sirve.

## Estado

Fase 1 (MVP). Hecho: esquema, semilla de prueba y verificaciones.
Sigue: proyecto de Next.js, acceso, y pantallas.
