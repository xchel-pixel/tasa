# Paso a producción — plan

Estado: **aprobado**; los puntos 2 a 4 y los términos se construyen en modo pruebas. El reset todavía no.

La idea en una línea: se construye y se prueba todo en el proyecto de pruebas, el día del
cambio se borra la base y se vuelve a armar sin semilla, se cargan los datos reales desde
pantallas y, solo cuando todo pasa la revisión, se invita a los comisionistas.

---

## 1. Qué borra `db:reset-produccion` y qué hay que reconfigurar

`npm run db:reset-produccion` corre `supabase db reset --linked --no-seed`: borra la base y
vuelve a aplicar las migraciones desde la 0001, sin semilla. Al terminar, `TASA_MODO` pasa a
`produccion` y desde entonces la semilla, las verificaciones y el reset quedan bloqueados.

### Lo que se borra y cómo vuelve

| Qué | ¿Se borra? | Cómo vuelve |
|---|---|---|
| Datos de prueba (trabajos, pagos, cierres, comisiones, Demo Valuadores, la organización que creaste en Plataforma) | Sí | No vuelven: es lo que se quiere |
| **Organización XG** | Sí | **La recrea la migración 0015**, con el mismo id |
| Marcas MGP, AP73, ARQOS y XG | Sí | Las recrea la 0008. Hay que completar sus datos de PDF en Configuración inicial (punto 4) |
| Cuentas receptoras | Sí | La 0008 trae tres con CLABE de relleno. **La migración nueva (punto 2) las quita**; se cargan las reales en Configuración inicial |
| Servicios, niveles, orígenes del dinero, mapeo de etapas | Sí | Los recrean las migraciones 0008 y 0013. Se revisan y ajustan en pantalla |
| Ajustes de XG (contacto, día límite, términos, aviso, prefijo) | Sí | La fila nace vacía. Se llenan en Ajustes |
| Conectores de XG (manual activo; Notion apagado y con el mapeo real) | Sí | Los recrean la 0015 y la 0020. **El secreto `ntn_` se vuelve a pegar** en Ajustes → Conector |
| **Tu persona y tu rol de plataforma** | Sí | Nadie puede entrar después del reset. Se da de alta con un comando (`npm run db:alta-plataforma`, punto 4) |
| Usuarios de acceso (auth) | Sí (así pasó al resembrar) | Se recrean solos al entrar con el código. La persona se amarra por correo |
| Equipo y comisionistas | Sí | Configuración inicial: Equipo e importación de comisionistas |
| Secreto `cron_secret` en Vault | Probablemente | Comando `npm run db:secreto-cron`: genera uno nuevo, lo guarda en Vault y en Vercel, y vuelve a publicar |
| Tarea de pg_cron | Puede que no | La migración 0020 la vuelve a programar. `cron.schedule` reemplaza la del mismo nombre, así que no se duplica |
| Buckets (comprobantes, cotizaciones, facturas) | Las políticas sí | Los recrean las migraciones 0007, 0013 y 0017. Los archivos de prueba que queden son huérfanos y no estorban |
| Logos de marca | — | Se suben en Configuración inicial (bucket privado nuevo `marcas`) |

### Lo que NO se borra (es del proyecto, no de la base)

- Supabase Auth: SMTP de Resend, plantilla del código de 6 dígitos y URL Configuration.
- Las llaves de Supabase: `SUPABASE_SECRET_KEY` en Vercel sigue sirviendo.
- Vercel: dominio, `CRON_SECRET` (se reemplaza en el paso del secreto) y variables.
- La integración de Notion y su conexión a la base Trámites.

### Que nada dependa de la semilla

- XG, sus catálogos base y sus conectores salen de **migraciones**, no de la semilla.
- La semilla deja de usar las cuentas de relleno de la 0008: crea las suyas con CLABE de prueba
  válidas, así la validación nueva no la rompe.
- Una revisión de solo lectura para producción, `npm run db:revisar-produccion`, sustituye a las
  verificaciones, que necesitan la semilla. Revisa:
  - RLS en todas las tablas y `anon` sin permisos;
  - que exista la tarea del cron y el `cron_secret`;
  - que XG tenga marcas, cuentas, servicios y niveles completos;
  - que exista tu persona de plataforma.

---

## 2. Dígito de control de la CLABE en la base (migración 0021)

- Función `clabe_valida(text)` (inmutable, mismos pesos 3-7-1 que la pantalla) y
  `check (clabe_valida(clabe))` en `cuentas_receptoras`.
- Antes del check, se borran las tres cuentas de relleno de la 0008 (CLABE `000…001`, `…002`,
  `…003`) si no tienen trabajos. En producción recién reseteada nunca tienen. En la base de pruebas
  actual sí tienen trabajos, así que **la 0021 se aplica en el reset**, no antes; mientras, se
  prueba en local con la semilla corregida.
- Las CLABE reales que ya conozco pasan el dígito de control: Fondeadora/ROMI 699180600008088771,
  BanRegio AP73 058597000050240948, Santander AP73 014680605780008780 y Mercado Pago ARQOS
  722969028798426766.

---

## 3. PDF de cotización con el formato de la marca ejecutora

Tomado de la skill `cotizacion-avaluos`, sin mencionar Tasa en ningún lado.

**Lo que replica:**
- **Encabezado:**
  - logo de la marca a la izquierda;
  - a la derecha, "PROPUESTA ECONÓMICA", "Cotización No. …", "Querétaro, Qro., *fecha*" y "Vigente hasta el …";
  - debajo, una línea del color de la marca.
- **Colores:**
  - MGP y ARQOS: `#1F3C6E`, con fondo claro `#E8EDF5`;
  - AP73: `#262626` con fondo `#EFEFEF`.
- **Tamaño de hoja:** carta para MGP y ARQOS; oficio para AP73.
- **Cuerpo:**
  - cliente y "Presente", introducción y tabla "Datos del inmueble";
  - tabla de honorarios (Concepto · Unidad · Cant. · Precio unitario · Importe) con subtotal, IVA y total, y "Son: … PESOS 00/100 M.N.";
  - Alcance, Condiciones, Documentos requeridos, Formas de pago con firma ("Atentamente" + firmante de la marca) y el recuadro "Importante".
- **Pie:**
  - a la izquierda, dirección, correo y teléfonos de la marca;
  - a la derecha, "Cotización … · Página n";
  - y la línea pedida: **"Solicitud gestionada por *comisionista*"**.

**Dónde viven los datos:** en la base, no en el código, para que sean editables por organización:
- **por marca:** logo, color, nombre legal, dirección, correo, teléfonos, firmante y su cargo, otras formas de pago (tarjeta, efectivo) y tamaño de hoja;
- **por servicio:** alcance, tiempo de entrega, documentos y aviso, ya llenos con los textos de la skill para los servicios equivalentes;
- **la cuenta** sale de la elegida al cotizar (CLABE + titular). En AP73 se sigue eligiendo BanRegio o Santander.

**Decisiones (aprobadas):**
1. **IVA:** regla de Tasa, solo con factura. Sin factura el PDF dice "Precios sin IVA; en caso de
   requerir factura se agrega IVA".
2. **Número de cotización:** `AAMMDD-T#`, con consecutivo propio de Tasa.
3. **Tipografía:** TeX Gyre Adventor para AP73 y ARQOS, insertada con `@pdf-lib/fontkit`.
4. **Comprobante de pago:** el cliente lo manda al comisionista.
5. **Vigencia:** 30 días por omisión.
6. **MGP usa su marca 2026:** marino `#04386C`, azul `#006DB3`, Manrope y logo horizontal; no el
   `#1F3C6E` de la skill. AP73 y ARQOS quedan como en la skill.
7. **Aceptación de términos** antes de invitar a los comisionistas.

---

## 4. Configuración inicial (sin SQL a mano)

**Una pantalla de lista de pasos**, `/admin/configuracion` (admin_org). Muestra cada paso con ✓
cuando está completo y lleva a su pantalla:

1. Marcas: lo de Catálogos más los datos del PDF y el logo.
2. Cuentas receptoras: CLABE validada.
3. Servicios: más sus textos de PDF.
4. **Niveles** (pantalla nueva): nombre, umbral, porcentaje y orden; Élite forzado.
5. Ajustes: contacto, día límite, prefijo de folio, términos y aviso de privacidad.
6. Orígenes del dinero.
7. Equipo: finanzas, admin de marca y equipo.
8. **Comisionistas** con **"Importar varios"**: pegas una tabla (copiada de Excel o Sheets) con
   nombre, correo, teléfono, RFC, emite factura y referido por. La pantalla muestra una vista previa
   con errores por renglón (correo repetido, RFC mal escrito) antes de dar de alta.
9. Conector: Notion.

**Dos comandos para lo que no puede hacerse desde una pantalla:**
- `npm run db:alta-plataforma -- --correo … --nombre "…"`: te da de alta como super_plataforma y
  admin_org de XG. Hace falta porque después del reset nadie puede entrar.
- `npm run db:secreto-cron`: genera el secreto del cron, lo guarda en Vault y en Vercel y vuelve a
  publicar.

---

## 5. Datos reales que necesito de ti

Lo que ya sé de la skill aparece "ya lo tengo": solo confírmalo.

**Marcas** (para cada una: MGP, AP73, ARQOS y XG)

| Dato | MGP | AP73 | ARQOS | XG |
|---|---|---|---|---|
| Nombre legal en el PDF | ya lo tengo | ya lo tengo | ya lo tengo | **falta** |
| Logo (PNG o JPG) | **archivo** | **archivo** | **archivo** | **archivo** |
| Dirección, correo y teléfonos | ya lo tengo | ya lo tengo | ya lo tengo | **falta** |
| Firmante y cargo | ya lo tengo | ya lo tengo | ya lo tengo | **falta** |
| Otras formas de pago (tarjeta, efectivo) | ya lo tengo | ya lo tengo | ya lo tengo | **falta** |
| ¿XG cotiza a clientes o solo es marca interna? | — | — | — | **falta** |

**Cuentas receptoras** (alias, titular, banco, CLABE, RFC del titular y marca)

| Cuenta | Qué falta |
|---|---|
| MGP · Fondeadora · Conjuntos Habitacionales y Comerciales ROMI, S.A. de C.V. | RFC; confirmar alias "ROMI" |
| AP73 · BanRegio · Adrián Gonzalo Puente Suárez | RFC |
| AP73 · Santander · Adrián Gonzalo Puente Suárez | RFC; confirmar que se da de alta |
| ARQOS · Mercado Pago · ARQOS Unidad de Valuación… | RFC; ¿se usa en Tasa? |
| XG · Scotiabank · Xchel Guerrero | **CLABE, titular exacto y RFC** |

**Servicios.** Confirmar la lista actual (sale de "Tipo de Trámite" en Notion): Avalúo Comercial,
Avalúo Hacendario, Valor Hacendario, Opinión de Valor, Avalúo Bancario, Avalúo Condominal y Mem
Desc, Peritaje para el Poder Judicial, Topografía, Deslinde Catastral, Otros.
- ¿Agrego Opinión de Valor con visita y sin visita como servicios separados?
- ¿Avalúo Infonavit?

**Niveles.** Confirmar o cambiar:

| Nivel | Promedio mensual de honorarios desde | % |
|---|---|---|
| Enlace | $0 | 5 |
| Aliado | $10,000 | 10 |
| Socio | $30,000 | 12.5 |
| Socio Plus | $60,000 | 15 |
| Élite | se asigna a mano | el que tú digas |

**Ajustes de XG:**
- contacto de soporte;
- día límite de pago de comisiones (hoy 10);
- prefijo de folio (MGP);
- **texto de términos** (debe incluir "cuenta personal e intransferible") y **aviso de privacidad**;
- orígenes del dinero: hoy Scotiabank XG, Banorte personal, Efectivo y Otra.

**Comisionistas iniciales** (una tabla, puede ser de Excel):

| Nombre | Correo | Teléfono | RFC | Emite factura (sí/no) | Referido por | ¿Élite? (%) |
|---|---|---|---|---|---|---|

- Todos empiezan en el nivel más bajo, porque no hay historial en Tasa.
- Si quieres que alguien arranque más arriba, va como Élite con su porcentaje y se le quita después.

**Equipo:**

| Nombre | Correo | Rol (finanzas / admin de marca + cuáles marcas / equipo) |
|---|---|---|

**Plataforma:** el contacto que ve quien todavía no entra.

---

## 6. Aviso a los comisionistas

Se manda **solo después** de la revisión del día del cambio y de una prueba de punta a punta con
un trabajo real. Tasa no manda mensajes por WhatsApp; lo mandas tú. Borrador:

> **Hola, {nombre}.** Ya tienes acceso a **Tasa**, el portal donde vas a pedir cotizaciones,
> seguir tus trabajos, reportar los pagos de tus clientes y ver tus comisiones.
>
> **Cómo entrar:**
> 1. Abre **https://tasa.xgplataform.com** en tu celular.
> 2. Escribe tu correo: **{correo}** (solo funciona ese).
> 3. Te llega un código de 6 dígitos. Si no aparece en un par de minutos, revisa spam o correo no deseado.
> 4. Escribe el código y listo.
>
> **Tip:** en el navegador, usa "Agregar a pantalla de inicio" para tenerlo como app.
>
> **Ahí puedes:**
> - pedir una cotización;
> - descargar el PDF para tu cliente;
> - ver el estatus de cada trabajo;
> - subir el comprobante cuando tu cliente pague (también efectivo o solo aviso);
> - revisar tu estado de cuenta y tu nivel.
>
> Tu cuenta es personal e intransferible. Dudas: {contacto}.

Si los términos se aceptan al entrar (punto pendiente del plan), el mensaje lo menciona.

---

## 7. Plan de reversa

**Antes del cambio (día −1):**
- Todo lo de los puntos 2 a 4 publicado y probado en el proyecto de pruebas, con un ensayo
  completo: `db:resembrar` → configuración inicial → cotización → PDF → pago → cierre.
- Respaldo: `supabase db dump --linked` (esquema y datos de prueba) a un archivo local.
- Anotar el deployment de Vercel que funciona: `vercel ls`.

**El día del cambio, en orden; cada paso tiene su salida:**

| Paso | Si falla |
|---|---|
| 1. `db:reset-produccion` | Si truena a medias, `TASA_MODO` sigue en `pruebas` (solo cambia al terminar bien): se corrige y se repite. Para regresar a como estaba: `db:resembrar` |
| 2. `db:alta-plataforma` y `db:secreto-cron` | Se repiten sin daño |
| 3. `db:revisar-produccion` | No se sigue hasta que pase |
| 4. Configuración inicial (catálogos, equipo, comisionistas) | Todo se corrige en pantalla; nada se envía a nadie |
| 5. Un trabajo real de punta a punta (cotización → PDF → aceptación → pago → confirmación) | Un error de código se corrige y se publica de nuevo. Si una publicación nueva sale mal: `vercel rollback` al deployment anterior |
| 6. Activar Notion | Si algo no cuadra: **Volver a manual**. No se pierde nada; las páginas de prueba se borran en Notion |
| 7. Aviso a comisionistas | Solo cuando 1 a 6 están bien |

**Después del cambio:**
- Ya no hay reset: cualquier corrección es una migración nueva.
- Durante 1 o 2 semanas se lleva en paralelo el proceso de siempre (Notion y WhatsApp), por si hay
  que comparar.
- Respaldo manual (`supabase db dump`) al terminar la configuración y una vez por semana el primer
  mes, porque el plan actual de Supabase no tiene restauración a un momento exacto.

---

## Pendientes del plan que conviene resolver antes de invitar

- **Aceptación de términos** (casilla + fecha al primer acceso). *Recomendación:* sí, antes de
  invitar, porque ahí va "cuenta personal e intransferible".
- Correos de cambio de estatus: pueden ir después.
- Control de dispositivos y solicitud pública por liga: después.
