# Propuesta: reorganizar la administración de Tasa por tareas

**Estado:** propuesta. No se ha movido ni borrado nada. Fecha: 10 nov 2026.

Seis secciones: **Hoy · Comisionistas · Equipo · Dinero · Reportes · Configuración**. Hoy es la página de inicio de administración.

Roles: **AO** = admin_org · **F** = finanzas · **AM** = admin_marca (solo sus marcas).

---

## a) Todas las pantallas de hoy y a dónde irían

| # | Pantalla | Ruta | Qué hace | Quién la ve | Sección nueva |
|---|---|---|---|---|---|
| 1 | Panel de administración | `/admin` | Pendientes, cierre del mes, comisiones por pagar, secciones de trabajo y una barra «Más» con 15 ligas | AO, F, AM | **Hoy** (se convierte en Hoy) |
| 2 | Pagos por confirmar | `/admin/pagos` | Pagos de clientes reportados: confirmar o rechazar | AO, F, AM | **Hoy** (tarjeta) → su lista sigue igual |
| 3 | Solicitudes por cotizar | `/admin/solicitudes` | Solicitudes nuevas y cotizaciones vencidas | AO, F, AM | **Hoy** (tarjeta) |
| 4 | Emitir cotización | `/admin/solicitudes/[id]` | Poner precio, convenio, asignar comisionista | AO, F, AM | Se queda (se abre desde Hoy y Trámites) |
| 5 | Trámites | `/admin/tramites` | Todos los trabajos con filtros y conteos | AO, F, AM | **Hoy** → «Trámites» (lista completa, una liga fija) |
| 6 | Traer trámite de Notion | `/admin/traer-de-notion` | Crear en Tasa un trámite que ya está en Notion | AO (F si Ajustes lo permite) | Dentro de Trámites (botón), sin cambio |
| 7 | Alertas | `/admin/alertas` | Alertas abiertas por tipo, cada una con su acción | AO, F, AM | **Se fusiona con Hoy** (cada alerta como tarea) |
| 8 | Solicitudes de alta | `/admin/altas` (+ `/nueva`, `/[id]`) | Pedidos de alta de comisionistas: aprobar o rechazar | AO, F (aprueba AO) | **Hoy** (tarjeta) y **Comisionistas** → «Altas» |
| 9 | Comisionistas | `/admin/comisionistas` | Lista con búsqueda y filtros | AO, F, AM | **Comisionistas** (lista) |
| 10 | Ficha del comisionista | `/admin/comisionistas/[id]` | Resumen, datos, cupos, DXF, tarjeta, referidos, pagos, trabajos, niveles, estado de cuenta, acciones | AO, F, AM | **Comisionistas** → ficha con pestañas |
| 11 | Alta directa / Importar | `/admin/comisionistas/nuevo`, `/importar` | Dar de alta uno o varios a mano | AO | **Comisionistas** (botones en la lista) |
| 12 | Accesos | `/admin/accesos` | Todas las personas: estatus, último acceso, equipos | AO | **Se reparte:** comisionistas → pestaña de su ficha; internos → **Equipo** |
| 13 | Accesos de una persona | `/admin/accesos/[id]` | Suspender, sesiones, ver como, paquete, cupos, DXF, historial | AO | **Se fusiona** con la ficha (pestañas «Accesos y sesiones» e «Historial») |
| 14 | Testimonios | `/admin/testimonios` | Aprobar testimonios para las tarjetas | AO | **Hoy** (tarjeta) y liga fija en **Comisionistas** |
| 15 | Referidos | `/admin/referidos` | Quién trajo a quién y cuántos ya cobran | AO, F | **Reportes** |
| 16 | Equipo | `/admin/equipo` | Personas internas: rol, marcas, DXF, activar | AO, F (F solo lectura) | **Equipo** (+ sus accesos y sesiones) |
| 17 | Comisiones por pagar | `/admin/comisiones` (+ `/pagar`) | Lo que se debe a cada comisionista y registrar el pago | AO, F | **Dinero** → «Pago de comisiones» |
| 18 | Cierres | `/admin/cierres` (+ `/[mes]`) | Cierre mensual: preparar, aprobar, pagar | AO, F | **Dinero** → «Cierres» |
| 19 | Paquetes de crédito | `/admin/paquetes` | Pagos de paquete por confirmar, ventas y saldos | AO, F | **Dinero** → «Paquetes» (sus pendientes también en Hoy) |
| 20 | Reportes | `/admin/reportes` | Dinero del mes: comisiones por empresa, servicio y comisionista | AO, F | **Reportes** → «Comisiones del mes» |
| 21 | Estadísticas | `/admin/estadisticas` | Uso de herramientas, embudo, zonas, salud de la fuente, paquetes, actividad | AO, F | **Reportes** → «Uso de herramientas» |
| 22 | Bitácora | `/admin/bitacora` | Quién cambió qué y cuándo | AO | **Reportes** |
| 23 | Configuración (lista de pasos) | `/admin/configuracion` | Revisa si la organización está lista y lleva a cada pantalla | AO | **Configuración** (portada de la sección) |
| 24 | Catálogos | `/admin/catalogos` | Marcas, cuentas, servicios, herramientas y cupos, cuentas para pagar, paquetes, perfiles, convenios | AO | **Se divide** en Configuración: Cuentas · Servicios y convenios · Herramientas y cupos · Paquetes |
| 25 | Niveles | `/admin/niveles` | Niveles de comisión y trato inicial | AO | **Configuración** |
| 26 | Ajustes | `/ajustes` | Textos, términos y aviso, correos, reglas, conector, equipos a la vez, folios | AO | **Se divide** en Configuración: Mensajes · Aviso y términos · Reglas · Conector · Equipos a la vez · Folios |
| 27 | Parámetros fiscales | `/ajustes/parametros` | UMA, INPC, tarifas e ISTD de la calculadora | AO | **Configuración** |
| 28 | Mis trámites (de mi liga) | `/mis-tramites` | Trámites que llegaron por la liga de esta persona | AO, F, AM, equipo | Se queda donde está (es de la persona, no de la administración) |
| 29 | Ficha del trámite | `/trabajos/[id]` (+ `/pagar`) | Todo sobre un trabajo: montos, pagos, crédito, comisión, estatus | Todos (acciones por rol) | Se queda (se abre desde todas) |
| 30 | Plataforma | `/plataforma` | Organizaciones (super plataforma) | Super plataforma | Fuera del menú de la organización |
| 31 | Elegir organización | `/organizacion` | Cambiar de organización activa | Todos | Sin cambio |

---

## b) Lo que se repite o sobra

1. **Una persona, tres pantallas.** Ficha del comisionista, Accesos/[id] y Equipo tienen cada una su parte de la misma persona.
   - **Cupos:** se editan en 3 lugares.
   - **DXF:** se edita en 4 lugares.
   - **«Activo»:** significa tres cosas distintas (suspendida, comisionista activo e inactividad).
   → Una sola ficha por persona.
2. **Dos listas de pendientes que no coinciden:** el panel `/admin` y la franja de la portada.
   - Los pagos de paquete salen solo en la franja.
   - «Esperan factura» sale solo en el panel.
   → Solo **Hoy**.
3. **Alertas** es otra lista de pendientes. Además, «estimado sin honorario final» es alerta y también sección del panel.
4. **Configuración, Catálogos, Ajustes y Niveles** son cuatro puertas al mismo tema. «Configuración» solo es una lista de pasos, y la tarjeta «Catálogos y ajustes» de la portada abre Configuración, no Catálogos.
5. **«Pagos por confirmar»** quiere decir dos cosas: pagos de clientes y pagos de paquetes.
6. **Reportes, Estadísticas y Referidos** son tres pantallas de números. Ventas de paquetes sale en Estadísticas y en Paquetes.
7. **«Por cotizar»** sale en cuatro lugares: Solicitudes, Trámites, panel y Mis trámites.
8. **Pantallas casi perdidas:**
   - Referidos, Reportes y Bitácora solo están en la barra «Más».
   - Testimonios solo aparece si hay pendientes.
   - Niveles solo se abre desde Configuración.
   - Casi todas regresan a «Portada» en vez de a la administración.
9. **Sobra:**
   - La barra «Más».
   - La tarjeta «Catálogos y ajustes».
   - La pantalla Accesos como lista general.
   - El botón «← Panel» de la ficha del trámite, que en realidad va a la portada.

---

## c) Para qué sirve cada pantalla (en una línea)

**Hoy**
- **Hoy:** lo que tienes que hacer ahora, en orden de urgencia.
- **Pagos por confirmar:** revisar que el dinero del cliente sí llegó.
- **Solicitudes por cotizar:** ponerle precio a lo que pidieron.
- **Emitir cotización:** el precio, la marca y la cuenta de una solicitud.
- **Trámites:** encontrar cualquier trabajo.
- **Traer de Notion:** dar de alta en Tasa un trámite que nació en Notion.
- **Altas:** decidir quién entra como comisionista.
- **Testimonios:** decidir qué comentarios salen en las tarjetas.

**Comisionistas**
- **Comisionistas:** buscar a uno.
- **Ficha del comisionista:** todo de una persona en un lugar (cómo va, sus trámites, lo que se le debe, su paquete, sus accesos, su historial).
- **Alta directa e Importar:** dar de alta sin solicitud.

**Equipo**
- **Equipo:** quién trabaja dentro, con qué rol y qué marcas.

**Dinero**
- **Cierres:** cerrar el mes de comisiones.
- **Pago de comisiones:** pagar lo que se debe.
- **Paquetes:** confirmar compras y ver saldos.

**Reportes**
- **Comisiones del mes:** a dónde se fue el dinero.
- **Uso de herramientas:** quién usa qué y si la fuente responde.
- **Referidos:** quién trae gente.
- **Bitácora:** quién cambió qué.

**Configuración**
- **Configuración:** si falta algo para operar.
- **Cuentas:** dónde se recibe y desde dónde se paga.
- **Servicios y convenios:** qué se vende y a qué precio pactado.
- **Herramientas y cupos:** qué herramienta ve cada quien y cuánto puede usar.
- **Niveles:** porcentajes de comisión y trato de bienvenida.
- **Paquetes:** precios y beneficios.
- **Mensajes:** textos de correos, WhatsApp y tarjeta.
- **Aviso y términos:** lo que aceptan los comisionistas.
- **Parámetros fiscales:** las cifras de la calculadora.
- **Equipos a la vez:** en cuántos aparatos puede entrar cada rol.

---

## d) Cómo se vería el menú

**Celular.** Barra fija abajo con 5 botones: **Hoy · Comisionistas · Dinero · Reportes · Más**.
- **Hoy** muestra un número con las tareas pendientes.
- **Más** abre una hoja con Equipo, Configuración, Trámites y Mis trámites.
- Dentro de cada sección, pestañas desplazables arriba (por ejemplo, Dinero: *Cierres · Pago de comisiones · Paquetes*).
- La ficha del comisionista usa pestañas desplazables: *Resumen · Trámites · Estado de cuenta · Paquete · Accesos · Historial*.

```
┌──────────────────────────────┐
│ Hoy                       (7)│
│ ┌──────────────────────────┐ │
│ │ 3 pagos por confirmar   >│ │
│ │ 1 paquete por confirmar >│ │
│ │ 2 piden más cupo        >│ │
│ └──────────────────────────┘ │
├──────────────────────────────┤
│ Hoy  Comis.  Dinero  Rep. Más│
└──────────────────────────────┘
```

**Escritorio.** Menú lateral izquierdo fijo:

```
┌────────────────┬─────────────────────────────────────┐
│ Hoy        (7) │  Hoy                                │
│ Trámites       │  ┌ Por confirmar ┐ ┌ Por decidir ┐   │
│ Comisionistas  │  │ pagos 3       │ │ altas 1     │   │
│ Equipo         │  │ paquetes 1    │ │ cupo 2      │   │
│ Dinero         │  └───────────────┘ └─────────────┘   │
│   Cierres      │  ┌ Para vigilar ───────────────────┐ │
│   Pagos        │  │ 2 comisionistas por inactivarse │ │
│   Paquetes     │  │ fuente: 3 fallas hoy            │ │
│ Reportes       │  └─────────────────────────────────┘ │
│ Configuración  │                                      │
└────────────────┴─────────────────────────────────────┘
```

**Hoy, por orden:**
1. *Por confirmar*: pagos de clientes, pagos de paquetes.
2. *Por decidir*: solicitudes nuevas, altas, pedir más cupo, créditos no aplicados, testimonios, cierre por preparar o aprobar, comisiones vencidas.
3. *Para vigilar*: comisionistas por inactivarse, fallas de la fuente, alertas de Notion, estimados sin monto final.

Cada tarea lleva directo a donde se resuelve. Lo que está en cero no se muestra.

---

## e) Riesgos

- **Ligas que se rompen.**
  - Hay rutas guardadas en favoritos, en correos y en mensajes viejos de WhatsApp (por ejemplo, `/admin/accesos/[id]`, `/ajustes`, `/admin/catalogos`, `/admin/reportes`, `/admin/estadisticas`).
  - **Mitigación:** las rutas viejas redirigen a la nueva (redirección permanente) durante al menos 6 meses. Ninguna se borra en la primera fase.
- **Ligas internas.** Hay ligas dentro del código, en alertas, paquetes, la ficha, altas, configuración y los avisos de la portada. Se corrigen todas y una prueba revisa que ninguna apunte a una ruta vieja.
- **Permisos que cambian.**
  - **Accesos** hoy es solo admin_org. Si sus pestañas pasan a la ficha (que ve finanzas), las acciones de suspender, cerrar sesiones y DXF **siguen siendo solo admin_org**. Finanzas vería la pestaña en solo lectura o no la vería: hay que decidirlo.
  - **Bitácora** hoy es solo admin_org: en Reportes seguiría oculta para finanzas.
  - **Equipo** ya permite que finanzas lea.
  - **admin_marca** hoy entra a Hoy y Trámites con filtro de sus marcas: en el menú nuevo solo vería Hoy, Trámites y Comisionistas.
  - Los permisos de la base no cambian: solo se mueven pantallas.
- **Humo.** La primera prueba de humo falla si una ruta real no está en su lista, así que **cada movimiento cambia la lista de humo**. Eso ayuda: humo detecta cualquier pantalla que se olvide.
  - Las rutas que hoy revisa con roles (25 de operación y 13 solo de admin_org) se reacomodan.
  - admin_marca no está en humo hoy: conviene agregarlo antes de mover nada.
- **Costumbre del equipo.** Gaby y quien opere a diario pierden sus atajos. Conviene:
  - hacerlo por fases;
  - empezar por **Hoy** y la **ficha única del comisionista**, que es lo que más se repite;
  - dejar la barra «Más» una semana con aviso de dónde quedó cada cosa.
- **Tamaño.** La ficha del comisionista ya es larga; con pestañas se carga cada pestaña por separado, así que no debe ser más lenta.

**Fases sugeridas:** (1) Hoy · (2) Ficha única del comisionista con pestañas · (3) Menú nuevo con redirecciones · (4) Dividir Catálogos y Ajustes en Configuración. Cada fase con su humo, commit y push.

**Decisiones que necesito antes de construir:**
1. ¿Finanzas ve la pestaña «Accesos y sesiones» en solo lectura, o no la ve?
2. ¿Alertas desaparece como pantalla (todo en Hoy) o se queda como «ver todas»?
3. ¿Arrancamos por la fase 1?
