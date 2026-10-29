# Tasa — Portal de comisionistas

## Qué es esto

Portal para comisionistas de servicios de valuación inmobiliaria. Se despliega en
`tasa.xgplataform.com`. Se abre en el celular desde el navegador: **móvil primero**.

**Multi-organización.** Cada organización (XG es la de Xchel) está aislada: datos, niveles,
cuentas, servicios, ajustes, cierres y conector propios. Dentro, las **marcas** (MGP, AP73,
Arqos, XG) comparten comisionistas y niveles.

- La **persona** es global (un correo). Lo que hace en cada organización lo dice su
  **membresía**: `admin_org`, `finanzas`, `admin_marca` (solo sus marcas; sin cierres,
  pendientes, pagos de comisión, reportes globales ni bitácora), `equipo` (sin comisión, sin
  pantallas todavía) o `comisionista`.
- `super_plataforma` (Xchel) es aparte: da de alta organizaciones y entra a cualquiera como
  admin_org; en una que no es suya, una franja fija lo dice y la bitácora lo registra.
- La organización activa vive en `personas.organizacion_activa`; con varias, se elige en
  `/organizacion` (selector en la barra).

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
   Una comisión devengada antes de aprobar el cierre anterior nace con el último nivel conocido
   y `provisional = true`; al aprobar ese cierre sube si el nivel real es mayor y se respeta si
   es menor (lo provisional solo sube).
   **Trato inicial** (0023, se fija en el alta y se ve en la ficha y en el inicio):
   - *Tasa de bienvenida* (quien ya trabajaba con la organización; casilla en alta, importación
     o ficha): piso de Socio Plus 15% durante N meses (3 por omisión; solo admin_org cambia N).
     Al terminar, si su promedio lo pone más abajo, **baja un nivel por cierre**
     (15 → 12.5 → 10 → real); la transición acaba en cuanto el escalón alcanza su nivel real.
   - *Arranque* (todos los demás): piso de Aliado 10% sus primeros 2 meses; luego la escalera
     normal, sin escalones.
   - Los dos son **pisos**: si el promedio da más, sube de inmediato. Los meses cuentan desde el
     mes del alta, inclusive. Nivel, meses y defaults se cambian en Niveles → Trato inicial.
   - `niveles_mensuales.motivo` dice por qué quedó cada mes: promedio, bienvenida, arranque,
     escalon o elite.
   **Élite:** porcentaje fijo para casos especiales, con vencimiento opcional (aplica hasta el mes
   de esa fecha, inclusive; después vuelve el promedio, sin escalones). Manda sobre todo lo demás.
   Borrador en lenguaje del comisionista: `docs/terminos-borrador.md`.
5. **Pagos:** todo entra como `reportado`; luego `confirmado` o `rechazado` (con motivo). Un pago
   no se edita ni regresa.
6. **"Pagado", "Solicitada", "Cotizada", "Aceptada" y "Cancelada" los decide Tasa.** Lo de en
   medio lo mueve el **conector** de la organización (uno activo por organización):
   - `manual` (hoy, todas): admin_org o el admin de la marca cambian el estatus desde la ficha
     (`cambiar_estatus_manual`, con historial). El folio lo genera Tasa al volverse trámite:
     `PREFIJO-AAAA-NNNN` con el prefijo de la organización.
   - `notion` (etapa 2), `sheets` y `webhook` (plan): crean el registro externo al aceptar
     (desde el cron, máx. 15 min) y leen estatus/folio/visita/cancelación por
     `registrar_lectura`, traduciendo con el `mapeo_estatus` del conector.
7. **Con conector externo el folio lo da el sistema externo** (`PREFIJO-AAAA-NNNN` en el
   título); sin folio y en "aceptada" se ve "Aceptada – folio en asignación". Tasa nunca cambia la
   estructura del sistema externo. Credenciales cifradas en Supabase Vault: nadie con sesión las
   lee; solo el cron (`credencial_conector`). Un error de sync deja el conector en "error" y una
   alerta para admin_org; nunca falla en silencio.
8. Total = honorarios + IVA (16% de honorarios, solo si `requiere_factura`) + terceros. La
   comisión siempre sobre honorarios sin IVA.
9. **"Cancelado" en el sistema externo no cancela:** levanta una alerta en el panel admin. La cancelación se
   confirma en Tasa (borra la comisión si el mes está abierto, o mete un cargo si ya cerró).
10. **Efectivo:** vía `efectivo`, con quién lo recibió; el recibo es opcional. "Solo aviso" nunca
    pide archivo.
11. **Asignación vs pago de comisiones** (dos conceptos separados):
    - *Asignación* (reportes): todo movimiento lleva empresa (cuenta receptora) y servicio. Los
      de un trabajo los toman del trabajo; bonos, ajustes y cargos manuales exigen empresa.
    - *Pago*: al aprobar un cierre nace UN pendiente por comisionista con el total del mes. Si
      el mes sale negativo no hay pendiente y el negativo pasa como `arrastre` al siguiente mes
      abierto (el arrastre no cuenta en reportes por empresa). Un pago de comisión cubre uno o
      varios pendientes, completos o en parte; lleva origen del dinero (catálogo editable),
      referencia, documento (factura / recibo / ninguno) y comprobante opcional.
    - El comisionista ve de sus pagos fecha, referencia y monto, **nunca el origen**: lee por
      `mis_pagos_comision()`, no por la tabla.
    - Vence el día `ajustes.dia_limite_pago_comision` (10) del mes siguiente al de las
      comisiones; se calcula, no se guarda. "Esperando factura" solo si `emite_factura`.

## Reglas técnicas

- **Toda tabla de negocio lleva `organizacion_id`** (por omisión `mi_org()`) y su RLS empieza por
  `organizacion_id = (select mi_org())`. Las relaciones son **llaves compuestas** (organización +
  id): la base impide que algo apunte a otra organización. Toda consulta por comisionista lleva
  también la organización (la misma persona puede serlo en dos). Las funciones internas reciben
  `p_org`; las que llama la app la toman de la sesión. Sin usuario (semilla, editor, cron),
  `mi_org()` lee `tasa.org`.
- Storage: `{organización}/{persona}/…` (comprobantes, facturas) y
  `{organización}/{trabajo}/…` (PDF de cotización).
- **Toda tabla nueva:** RLS encendido, `revoke all on [tabla] from anon;` y GRANT explícito a
  `authenticated` (el proyecto NO expone tablas solo; ver `0010_permisos.sql`). Ver
  `supabase/migrations/LEEME.md`.
- **Sin nombres del equipo en la interfaz.** Ningún texto fijo menciona a una persona del equipo
  ni su correo: se dice "el administrador", "Administración" o "el equipo de Tasa". Si hace falta
  un contacto, sale de `ajustes.contacto_soporte` de la organización, o del de plataforma sin
  sesión (función `contacto_soporte()`); vacío = no se muestra. Los nombres que salen de `personas` (el saludo) sí se muestran.
- **Cuenta receptora: alias vs titular.** En listas, estados de cuenta, subtotales y panel la cuenta
  se nombra por su `alias`. El `titular` legal solo aparece en `DatosBancarios` (CLABE + titular +
  banco): ficha del trabajo, reportar pago y PDF de cotización.
- **Colores solo por token**: la paleta (marca MGP 2026 y estados) vive en `app/globals.css`. Las
  pantallas usan las clases que salen de ahí; ningún hex suelto. Tipografía Manrope 400/600/700.
  El nombre visible es "Tasa" (componente `Marca`); nunca el logo ni el nombre de MGP.
- **Buckets privados** (`comprobantes`, `cotizaciones`), siempre por URL firmada.
- La llave de servicio de Supabase solo existe en `/api/cron`, protegida con `CRON_SECRET`.
  Nunca en el navegador, nunca en otra ruta.
- Migraciones numeradas en `supabase/migrations/`; una aplicada no se edita nunca. Se aplican con
  la CLI (`npm run db:push`). Un solo proyecto de Supabase: `TASA_MODO` (pruebas|produccion) en
  `.env.local` decide si se permiten semilla y verificaciones. El paso a producción es
  `npm run db:reset-produccion`, una sola vez. Tras un cambio de estructura, `npm run db:resembrar`
  (solo pruebas) deja la base en cero con la semilla.
- Verificar contra la base real, no contra los archivos SQL.
- **Después de cada migración aplicada a producción, correr `node scripts/revisar-consultas.mjs`**
  y no dar la tarea por terminada si reporta errores. Manda cada consulta de las pantallas a la
  base real con `limit=0` (no lee datos) y atrapa lo que tumba una pantalla aunque la base esté
  vacía: relaciones ambiguas (PGRST201), columnas que ya no existen.
- **Embeber `personas` siempre con su llave** desde una tabla que tenga más de una hacia
  personas: `personas!comisionistas_persona_id_fkey(nombre)`, nunca `personas(nombre)`. Lo revisa
  `pruebas/consultas.test.ts`.
- `npm test` corre migraciones, semilla y verificaciones en PGlite. Toda regla nueva de la base
  lleva su verificación en `supabase/verificaciones.sql` (sección `-- @@ Nombre`).
- Fechas de corte en `America/Mexico_City`: usar `hoy_mx()` y `mes_de()`, nunca `current_date`.

## Cómo trabajar con Xchel

- Cambios chicos y verificables. Una fase a la vez.
- Deuda técnica y decisiones de arquitectura se preguntan antes, no se avisan después.
- Si detectas un error o una debilidad en lo que pide, díselo directo.
- Al terminar una tarea, di qué probar en el navegador para confirmar que sirve.

## Estado

Fase 1 (MVP). Hecho: esquema, semilla, verificaciones (`npm test`), migraciones por CLI
(`npm run db:*`), Next.js con acceso por código, identidad MGP 2026, ajustes (contacto de
soporte) y las pantallas del comisionista (inicio, ficha, nueva solicitud, reportar pago,
estado de cuenta). Panel: pagos por confirmar, solicitudes con PDF, alertas, cierre mensual,
comisionistas (lista, ficha, alta), comisiones por pagar, reportes y pagos en efectivo.
Multi-organización (etapa 1): organizaciones, membresías, roles, plataforma, equipo, conector
manual con interfaz de conectores y Vault, semilla con XG y Demo Valuadores. Conector Notion
(etapa 2): `/api/cron` (CRON_SECRET + SUPABASE_SECRET_KEY, solo ahí), pg_cron cada 15 min con el
secreto en Vault (`cron_secret`), adaptador en `lib/conectores/`. Publicado en
`tasa.xgplataform.com` (Vercel; se publica solo con cada push a main).

Deshacer/anular con motivo (ficha del trabajo, bandeja de pagos, ficha del comisionista) y
catálogos de marcas, cuentas (CLABE con dígito de control) y servicios.

Pendiente del panel: catálogos de niveles y mapeo de estatus; tema por organización (color y
logo ya están en el esquema).

## Plan (en este orden)

1. **Panel de administración**: pagos por confirmar primero; alertas de Notion; cotizar y
   emitir; alta de comisionistas; cuentas receptoras; mapeo de estatus; cierre mensual.
2. **Aceptación de términos** del comisionista: casilla + fecha, texto editable por super_admin
   que incluya "cuenta personal e intransferible". Ver el plan detallado en README.
3. **Solicitud pública por liga** (`/s/<org>/<slug>`), antes de la tarjeta digital. Ver README.
   - **Marca opcional en la solicitud:** que el comisionista pueda elegir marca al pedir, para que
     admin_marca vea las solicitudes de su marca desde el inicio (hoy solo las ve al cotizarse).
4. **Control de dispositivos**. NO construir antes de terminar el panel. Ver README.
5. Correos de cambio de estatus; conectores `sheets` y `webhook`.
5b. **Alta de comisionistas por solicitud** — construida (0024): `/alta/<org>`, RFC obligatorio con
   dígito verificador, CSF en PDF, bandeja `/admin/altas` (finanzas captura, solo admin_org
   decide), correos por Resend con respaldo de WhatsApp, `/privacidad`. Ver
   `docs/paso-a-produccion.md` §4b. Sin CURP.
6. `npm run db:reset-produccion` cuando se lance. (El dígito de control de la CLABE ya está en
   la base: 0021; con la base reseteada la regla queda validada para todas las cuentas.)
7. **Referidos** y 8. **Herramientas y membresías**: reglas, esquema y lo por decidir en
   `docs/referidos-y-herramientas.md`. No construir sin resolver antes sus "por decidir".
