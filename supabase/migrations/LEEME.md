# Migraciones de Tasa

Archivos numerados que se corren en orden desde el editor SQL de Supabase.
**Una ya aplicada no se edita nunca**: lo que haya que cambiar va en una migración nueva.

| Archivo | Qué hace |
|---|---|
| `0001_base.sql` | Fechas en hora de México, personas, comisionistas, marcas, cuentas, servicios, bitácora |
| `0002_solicitudes.sql` | Solicitudes, cotizaciones, mapeo e historial de estatus |
| `0003_comisiones.sql` | Niveles, cierres, comisiones, tope 30%, bloqueo de meses cerrados |
| `0004_pagos.sql` | Pagos, devengo al 100%, cancelación de trabajos |
| `0005_cierre.sql` | Preparar y aprobar el cierre; cálculo de niveles del mes siguiente |
| `0006_acceso.sql` | Alta por correo y amarre del usuario de autenticación |
| `0007_storage.sql` | Buckets privados `comprobantes` y `cotizaciones` |
| `0008_catalogos.sql` | Marcas, cuentas (CLABEs placeholder), servicios, niveles, mapeo |
| `0009_lectura_notion.sql` | Lectura de Notion (folio desde el título, etapa → estatus) y alertas |

Fuera de las migraciones, en `supabase/`:

- `semilla_prueba.sql` — **solo en un proyecto de pruebas.** 3 comisionistas, 10 trabajos, septiembre aprobado.
- `verificaciones.sql` — prueba las reglas contra la semilla, dentro de `begin … rollback`.
  Las mismas secciones corren con `npm test` (vitest + PGlite, ver `pruebas/`).

## Lo que lleva una tabla nueva

1. **RLS encendido**: `alter table X enable row level security;`.
2. **Cerrada a `anon`**: `revoke all on X from anon;`. Sin esto, el RLS queda como única
   barrera y una política con un hueco se vuelve una fuga.
3. **Políticas por rol** usando `mi_persona_id()`, `mi_rol()`, `soy_staff()`, `soy_super_admin()`.
4. **Bitácora**, si la tabla la tocan admin o finanzas:
   `create trigger bitacora after insert or update or delete on X for each row execute function registrar_bitacora();`

## Lo que lleva una función

- `security definer` + `set search_path = public`.
- `revoke all ... from public, anon` antes del `grant` a quien toca.
- Las que hacen trabajo delicado tienen dos capas: la pública revisa el rol y la interna
  (`ejecutar_…`) no la alcanza nadie desde el navegador.

## Cómo se comprueba

- Una prueba de RLS sin simular la sesión no prueba nada: el editor corre como `postgres`.
  `verificaciones.sql` usa `pg_temp.como('correo')` para hacerse pasar por cada persona.
- Un `update` que el RLS bloquea no truena: toca cero filas. Se comprueba leyendo después.
