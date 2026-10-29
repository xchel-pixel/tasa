import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, rgb, type PDFFont, type PDFImage, type PDFPage, type RGB } from "pdf-lib";

/**
 * La propuesta económica en PDF con el formato de la MARCA EJECUTORA
 * (el mismo de la skill de cotización): logo, "PROPUESTA ECONÓMICA",
 * colores, tipografía y hoja de la marca, tabla de honorarios,
 * condiciones, formas de pago con firma y el recuadro "Importante". Al
 * pie: "Solicitud gestionada por <comisionista>". Nunca menciona Tasa.
 *
 * IVA con la regla de Tasa: solo si el trabajo requiere factura, y solo
 * sobre honorarios (los terceros no llevan IVA). Sin factura, lo dice.
 *
 * Es una función pura: recibe datos, fuentes y logo como bytes. Quien la
 * llama los lee del disco y del bucket; así se prueba sin red.
 */

export type MarcaPdf = {
  clave: string;
  nombre_legal: string | null;
  direccion: string | null;
  correo: string | null;
  telefonos: string | null;
  firmante: string | null;
  firmante_cargo: string | null;
  /** "Título | detalle", una por línea. */
  formas_pago: string | null;
  color: string | null;
  color_acento: string | null;
  color_claro: string | null;
  hoja: "carta" | "oficio";
};

export type DatosPdf = {
  numero: string;
  /** "AAAA-MM-DD" */
  fecha: string;
  vigente_hasta: string;
  cliente: string;
  inmueble: { ubicacion: string; clave_catastral: string | null; descripcion: string | null };
  servicio: { nombre: string; alcance: string | null; tiempo_entrega: string | null; documentos: string | null; aviso: string | null };
  honorarios: number;
  /** fijo: como siempre · sin_costo: "Sin costo" · estimado: "Estimado" con la nota de honorario final. */
  honorario_tipo?: "fijo" | "sin_costo" | "estimado";
  /** Solo estimado con rango: el mínimo (`honorarios` es el máximo). */
  honorario_minimo?: number | null;
  terceros: number;
  requiere_factura: boolean;
  iva: number;
  total: number;
  cuenta: { titular: string; banco: string | null; clabe: string };
  comisionista: string;
  marca: MarcaPdf;
};

export type FuentesPdf = {
  regular: Uint8Array;
  negrita: Uint8Array;
  italica: Uint8Array;
  /** Recortar la fuente a las letras usadas (solo TrueType: ver fuentes-pdf.ts). */
  subconjunto: boolean;
};
export type LogoPdf = { bytes: Uint8Array; tipo: "png" | "jpg" } | null;

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const fechaLarga = (iso: string) => {
  const [a, m, d] = iso.slice(0, 10).split("-").map(Number);
  return `${d} de ${MESES[m - 1]} de ${a}`;
};
const mx = (n: number) => "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function color(hex: string | null, respaldo: string): RGB {
  const h = (hex && /^#[0-9a-f]{6}$/i.test(hex) ? hex : respaldo).slice(1);
  return rgb(parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255);
}

// --------------------------------------------------------------- números en letras
const UNI = ["", "UN", "DOS", "TRES", "CUATRO", "CINCO", "SEIS", "SIETE", "OCHO", "NUEVE", "DIEZ", "ONCE", "DOCE", "TRECE", "CATORCE", "QUINCE", "DIECISÉIS", "DIECISIETE", "DIECIOCHO", "DIECINUEVE", "VEINTE", "VEINTIÚN", "VEINTIDÓS", "VEINTITRÉS", "VEINTICUATRO", "VEINTICINCO", "VEINTISÉIS", "VEINTISIETE", "VEINTIOCHO", "VEINTINUEVE"];
const DEC = ["", "", "", "TREINTA", "CUARENTA", "CINCUENTA", "SESENTA", "SETENTA", "OCHENTA", "NOVENTA"];
const CEN = ["", "CIENTO", "DOSCIENTOS", "TRESCIENTOS", "CUATROCIENTOS", "QUINIENTOS", "SEISCIENTOS", "SETECIENTOS", "OCHOCIENTOS", "NOVECIENTOS"];
function centenas(n: number): string {
  if (n === 100) return "CIEN";
  const c = Math.floor(n / 100), r = n % 100;
  const partes = c ? [CEN[c]] : [];
  if (r < 30) partes.push(UNI[r]);
  else partes.push(DEC[Math.floor(r / 10)] + (r % 10 ? " Y " + UNI[r % 10] : ""));
  return partes.filter(Boolean).join(" ");
}
export function enLetras(x: number): string {
  const total = Math.round(x * 100);
  const enteros = Math.floor(total / 100), cent = total % 100;
  const mi = Math.floor(enteros / 1_000_000), resto = enteros % 1_000_000, k = Math.floor(resto / 1000), u = resto % 1000;
  const p: string[] = [];
  if (mi) p.push(mi === 1 ? "UN MILLÓN" : centenas(mi) + " MILLONES");
  if (k) p.push(k === 1 ? "MIL" : centenas(k) + " MIL");
  if (u) p.push(centenas(u));
  return `${p.join(" ") || "CERO"} ${enteros === 1 ? "PESO" : "PESOS"} ${String(cent).padStart(2, "0")}/100 M.N.`;
}

// --------------------------------------------------------------- composición
type Tramo = { texto: string; fuente: PDFFont };
type Fila = { celdas: Tramo[][]; fondo?: RGB; colorTexto?: RGB; derecha?: boolean[]; lineaAbajo?: boolean; fondoDesde?: number };

/** "Precio unitario": el monto o "Sin costo" (un estimado lleva su monto máximo). */
function precioDeHonorarios(d: DatosPdf): string {
  return d.honorario_tipo === "sin_costo" ? "Sin costo" : mx(d.honorarios);
}

/** Lo que se agrega al concepto: "(estimado)" o "(estimado de $X a $Y)". En la columna ancha, para que quepa. */
function notaDelConcepto(d: DatosPdf): string {
  if (d.honorario_tipo !== "estimado") return "";
  return d.honorario_minimo != null && d.honorario_minimo < d.honorarios
    ? ` (estimado de ${mx(d.honorario_minimo)} a ${mx(d.honorarios)})`
    : " (estimado)";
}

export async function generarPdfCotizacion(d: DatosPdf, fuentes: FuentesPdf, logo: LogoPdf = null): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const autor = d.marca.nombre_legal ?? d.marca.clave;
  pdf.setTitle(`Cotización ${d.numero}`);
  pdf.setAuthor(autor);
  pdf.setCreator(autor);
  pdf.setProducer(autor);

  const subset = fuentes.subconjunto;
  const R = await pdf.embedFont(fuentes.regular, { subset });
  const B = fuentes.negrita === fuentes.regular ? R : await pdf.embedFont(fuentes.negrita, { subset });
  const I = fuentes.italica === fuentes.regular ? R : await pdf.embedFont(fuentes.italica, { subset });
  const img: PDFImage | null = logo ? (logo.tipo === "png" ? await pdf.embedPng(logo.bytes) : await pdf.embedJpg(logo.bytes)) : null;

  const PRIN = color(d.marca.color, "#1F3C6E");
  const ACEN = color(d.marca.color_acento ?? d.marca.color, "#1F3C6E");
  const CLARO = color(d.marca.color_claro, "#E8EDF5");
  const GRIS = rgb(0.27, 0.27, 0.27);
  const GRIS_CLARO = rgb(0.8, 0.8, 0.8);
  const NEGRO = rgb(0.1, 0.1, 0.1);
  const BLANCO = rgb(1, 1, 1);

  const [W, H] = d.marca.hoja === "oficio" ? [612, 1008] : [612, 792];
  const mg = 44.6;
  const ancho = W - 2 * mg;
  // Logo horizontal: hasta 200 de ancho y 52 de alto, sin deformar.
  const escala = img ? Math.min(52 / img.height, 200 / img.width) : 0;
  const altoLogo = img ? img.height * escala : 30;
  const anchoLogo = img ? img.width * escala : 0;
  const arriba = H - 30;
  const inicioCuerpo = arriba - Math.max(altoLogo, 56) - 18;
  const pie = 53;

  let pagina!: PDFPage;
  let y = 0;
  let numPagina = 0;

  function nuevaPagina() {
    pagina = pdf.addPage([W, H]);
    numPagina++;
    if (img) pagina.drawImage(img, { x: mg, y: arriba - altoLogo, width: anchoLogo, height: altoLogo });
    else {
      pagina.drawText(d.marca.clave, { x: mg, y: arriba - 24, size: 22, font: B, color: PRIN });
      if (d.marca.nombre_legal) pagina.drawText(d.marca.nombre_legal.slice(0, 70), { x: mg, y: arriba - 36, size: 6.5, font: R, color: PRIN });
    }
    const derecha = (t: string, yy: number, f: PDFFont, s: number, c: RGB) =>
      pagina.drawText(t, { x: W - mg - f.widthOfTextAtSize(t, s), y: yy, size: s, font: f, color: c });
    derecha("PROPUESTA ECONÓMICA", arriba - 15, B, 14, PRIN);
    derecha(`Cotización No. ${d.numero}`, arriba - 29, R, 8.5, GRIS);
    derecha(`Querétaro, Qro., ${fechaLarga(d.fecha)}`, arriba - 40, R, 8.5, GRIS);
    derecha(`Vigente hasta el ${fechaLarga(d.vigente_hasta)}`, arriba - 51, B, 8.5, PRIN);
    const yl = arriba - Math.max(altoLogo, 56) - 6;
    pagina.drawLine({ start: { x: mg, y: yl }, end: { x: W - mg, y: yl }, thickness: 1.4, color: PRIN });

    pagina.drawLine({ start: { x: mg, y: pie + 8 }, end: { x: W - mg, y: pie + 8 }, thickness: 0.5, color: GRIS_CLARO });
    const izq = [
      d.marca.direccion,
      [d.marca.correo, d.marca.telefonos].filter(Boolean).join("  ·  ") || null,
      `Solicitud gestionada por ${d.comisionista}`,
    ].filter((t): t is string => Boolean(t));
    izq.forEach((t, i) => pagina.drawText(t, { x: mg, y: pie - i * 9, size: 7, font: i === izq.length - 1 ? I : R, color: GRIS }));
    const pd = `Cotización ${d.numero}  ·  Página ${numPagina}`;
    pagina.drawText(pd, { x: W - mg - R.widthOfTextAtSize(pd, 7), y: pie, size: 7, font: R, color: GRIS });
    y = inicioCuerpo;
  }

  const cabe = (alto: number) => {
    if (y - alto < pie + 22) nuevaPagina();
  };

  /** Parte tramos (cada uno con su fuente) en renglones de un ancho dado. */
  function renglones(tramos: Tramo[], tam: number, anchoMax: number): Tramo[][] {
    const salida: Tramo[][] = [[]];
    let actual = 0;
    for (const t of tramos) {
      for (const pieza of t.texto.split(/(\s+)/)) {
        if (!pieza) continue;
        const esEspacio = /^\s+$/.test(pieza);
        const w = t.fuente.widthOfTextAtSize(pieza, tam);
        if (!esEspacio && actual + w > anchoMax && actual > 0) {
          salida.push([]);
          actual = 0;
        }
        if (esEspacio && actual === 0) continue;
        salida[salida.length - 1].push({ texto: pieza, fuente: t.fuente });
        actual += w;
      }
    }
    return salida;
  }

  function pintar(linea: Tramo[], x0: number, yBase: number, tam: number, c = NEGRO) {
    let x = x0;
    for (const t of linea) {
      pagina.drawText(t.texto, { x, y: yBase, size: tam, font: t.fuente, color: c });
      x += t.fuente.widthOfTextAtSize(t.texto, tam);
    }
  }

  function parrafo(tramos: Tramo[], { tam = 8.2, interlinea = 10.2, sangria = 0, vineta = false, anchoMax = ancho } = {}) {
    for (const [n, linea] of renglones(tramos, tam, anchoMax - sangria).entries()) {
      cabe(interlinea);
      if (vineta && n === 0) pagina.drawText("•", { x: mg + 2, y: y - tam, size: tam, font: R, color: NEGRO });
      pintar(linea, mg + sangria, y - tam, tam);
      y -= interlinea;
    }
  }

  const titulo = (t: string) => {
    cabe(26);
    y -= 6;
    pagina.drawText(t, { x: mg, y: y - 9, size: 9, font: B, color: ACEN });
    y -= 14;
  };

  function tabla(filas: Fila[], anchos: number[], tam = 8.2) {
    const xs = anchos.reduce<number[]>((acc, a, i) => [...acc, acc[i] + a * ancho], [mg]);
    for (const f of filas) {
      const partidas = f.celdas.map((c, i) => renglones(c, tam, anchos[i] * ancho - 6));
      const alto = Math.max(1, ...partidas.map((p) => p.length)) * (tam + 2) + 4;
      cabe(alto);
      if (f.fondo) {
        const desde = f.fondoDesde ?? 0;
        pagina.drawRectangle({ x: xs[desde], y: y - alto, width: xs[xs.length - 1] - xs[desde], height: alto, color: f.fondo });
      }
      partidas.forEach((lineas, i) =>
        lineas.forEach((linea, n) => {
          const w = linea.reduce((s, t) => s + t.fuente.widthOfTextAtSize(t.texto, tam), 0);
          const x = f.derecha?.[i] ? xs[i + 1] - 3 - w : xs[i] + 3;
          pintar(linea, x, y - 3 - tam - n * (tam + 2), tam, f.colorTexto ?? NEGRO);
        })
      );
      if (f.lineaAbajo) pagina.drawLine({ start: { x: mg, y: y - alto }, end: { x: mg + ancho, y: y - alto }, thickness: 0.4, color: GRIS_CLARO });
      y -= alto;
    }
  }

  const r = (texto: string): Tramo[] => [{ texto, fuente: R }];
  const b = (texto: string): Tramo[] => [{ texto, fuente: B }];

  // ------------------------------------------------------------- contenido
  nuevaPagina();
  parrafo(b(d.cliente || "A quien corresponda"));
  parrafo(r("Presente"));
  y -= 6;
  parrafo(r("Agradecemos su interés. Ponemos a su consideración nuestra propuesta de honorarios para el inmueble que se describe a continuación."));

  const datosInmueble = (
    [
      ["Ubicación", d.inmueble.ubicacion],
      ["Clave catastral", d.inmueble.clave_catastral],
      ["Descripción", d.inmueble.descripcion],
    ] as [string, string | null][]
  ).filter((x): x is [string, string] => Boolean(x[1]));
  titulo("Datos del inmueble");
  tabla(datosInmueble.map(([k, v]) => ({ celdas: [b(k), r(v)], lineaAbajo: true })), [0.28, 0.72]);

  titulo("Honorarios");
  const derecha = [false, false, true, true, true];
  const filas: Fila[] = [
    { celdas: [b("Concepto"), b("Unidad"), b("Cant."), b("Precio unitario"), b("Importe")], fondo: PRIN, colorTexto: BLANCO, derecha },
    {
      celdas: [
        r(d.servicio.nombre + notaDelConcepto(d)),
        r("Servicio"),
        r("1"),
        r(precioDeHonorarios(d)),
        r(d.honorario_tipo === "sin_costo" ? "Sin costo" : mx(d.honorarios)),
      ],
      derecha,
      lineaAbajo: true,
    },
  ];
  if (d.terceros > 0) {
    filas.push({ celdas: [r("Derechos y gastos de terceros (sin IVA)"), r("Concepto"), r("1"), r(mx(d.terceros)), r(mx(d.terceros))], derecha, lineaAbajo: true });
  }
  filas.push({ celdas: [[], [], [], r("Subtotal"), r(mx(d.honorarios + d.terceros))], derecha });
  if (d.requiere_factura) filas.push({ celdas: [[], [], [], r("IVA 16%"), r(mx(d.iva))], derecha });
  filas.push({ celdas: [[], [], [], b("TOTAL"), b(mx(d.total))], derecha, fondo: CLARO, fondoDesde: 3 });
  tabla(filas, [0.47, 0.14, 0.09, 0.15, 0.15]);
  y -= 3;
  const letras = `Son: ${enLetras(d.total)}`;
  cabe(11);
  pagina.drawText(letras, { x: W - mg - I.widthOfTextAtSize(letras, 7.8), y: y - 7.8, size: 7.8, font: I, color: NEGRO });
  y -= 11;
  if (!d.requiere_factura) parrafo(b("Precios sin IVA; en caso de requerir factura se agrega IVA."), { tam: 7.8 });
  if (d.honorario_tipo === "estimado") {
    parrafo(b("Honorario estimado. Honorario final por definir: se confirma antes de la entrega y el total se ajusta a él."), { tam: 7.8 });
  }

  y -= 4;
  parrafo([
    { texto: "Alcance: ", fuente: B },
    {
      texto: `${d.servicio.alcance ? d.servicio.alcance + " " : ""}No incluye levantamiento topográfico, deslinde, regularización documental ni trabajos adicionales a los aquí descritos, que se cotizarán por separado.`,
      fuente: R,
    },
  ]);

  titulo("Condiciones");
  const condiciones: [string, string][] = [
    ["Forma de pago:", "50% de anticipo para iniciar los trabajos y 50% contra entrega."],
    ["Tiempo de entrega:", `${d.servicio.tiempo_entrega ?? "se confirma al recibir el anticipo y la documentación completa"}. Los plazos corren a partir del anticipo y la documentación completa.`],
    ["Vigencia:", `esta propuesta es válida hasta el ${fechaLarga(d.vigente_hasta)}. Después de esa fecha los honorarios pueden cambiar.`],
    ["Aceptación:", `confírmela con ${d.comisionista} y realice el anticipo para programar el servicio.`],
    [
      "Facturación:",
      d.requiere_factura
        ? "el total incluye IVA 16% sobre honorarios. Si requiere factura con retenciones de ISR e IVA, indíquelo al aceptar: el total se considerará neto y las retenciones serán adicionales."
        : "precios sin IVA; en caso de requerir factura se agrega IVA 16% sobre honorarios.",
    ],
  ];
  for (const [k, v] of condiciones) parrafo([{ texto: k + " ", fuente: B }, { texto: v, fuente: R }], { tam: 7.8, interlinea: 9.5, sangria: 11, vineta: true });

  const documentos = (d.servicio.documentos ?? "").split("\n").map((s) => s.trim()).filter(Boolean);
  if (documentos.length) {
    titulo("Documentos requeridos");
    for (const doc of documentos) parrafo(r(doc), { tam: 7.8, interlinea: 9.5, sangria: 11, vineta: true });
  }

  // Formas de pago (izquierda, 64%) y firma (derecha).
  const pagos: [string, string][] = [
    ["Transferencia o depósito", `${d.cuenta.banco ? d.cuenta.banco + " · " : ""}CLABE ${d.cuenta.clabe} · Titular: ${d.cuenta.titular}`],
    ...(d.marca.formas_pago ?? "")
      .split("\n")
      .map((l) => l.split("|").map((s) => s.trim()))
      .filter((p) => p[0] && p[1])
      .map((p) => [p[0], p[1]] as [string, string]),
  ];
  const anchoIzq = ancho * 0.64;
  cabe(130);
  const yBloque = y;
  titulo("Formas de pago");
  for (const [k, v] of pagos) {
    const izq = renglones(b(k), 8.2, anchoIzq * 0.34 - 6);
    const der = renglones(r(v), 8.2, anchoIzq * 0.66 - 6);
    const alto = Math.max(izq.length, der.length) * 10.2 + 4;
    izq.forEach((linea, n) => pintar(linea, mg, y - 3 - 8.2 - n * 10.2, 8.2));
    der.forEach((linea, n) => pintar(linea, mg + anchoIzq * 0.34, y - 3 - 8.2 - n * 10.2, 8.2));
    pagina.drawLine({ start: { x: mg, y: y - alto }, end: { x: mg + anchoIzq, y: y - alto }, thickness: 0.4, color: GRIS_CLARO });
    y -= alto;
  }
  y -= 3;
  parrafo(r(`Envíe su comprobante a ${d.comisionista}, quien le compartió esta propuesta, indicando el número de cotización ${d.numero}.`), {
    tam: 7.8,
    interlinea: 10,
    anchoMax: anchoIzq,
  });
  const yFin = y;

  const xf = mg + anchoIzq + 10;
  const af = ancho - anchoIzq - 10;
  const centro = (t: string, yy: number, f: PDFFont, s: number) =>
    pagina.drawText(t, { x: xf + (af - f.widthOfTextAtSize(t, s)) / 2, y: yy, size: s, font: f, color: NEGRO });
  let yf = yBloque - 14;
  centro("Atentamente", yf, R, 8);
  yf -= 34;
  pagina.drawLine({ start: { x: xf + af * 0.1, y: yf + 10 }, end: { x: xf + af * 0.9, y: yf + 10 }, thickness: 0.6, color: NEGRO });
  for (const linea of renglones(b(d.marca.firmante ?? autor), 8.8, af)) {
    centro(linea.map((t) => t.texto).join(""), yf, B, 8.8);
    yf -= 11.5;
  }
  for (const linea of renglones(r(d.marca.firmante_cargo ?? ""), 8, af)) {
    if (!linea.length) continue;
    centro(linea.map((t) => t.texto).join(""), yf, R, 8);
    yf -= 10.5;
  }
  y = Math.min(yFin, yf) - 8;

  // Importante
  const avisos = [
    d.servicio.aviso,
    "El valor se determina con base en la documentación e información proporcionadas por el cliente, que se presumen verídicas. Las diferencias de superficies, linderos o situación legal no son responsabilidad del valuador.",
    "Si la visita no puede realizarse por causas ajenas a nosotros (falta de acceso, dirección incorrecta o cancelación con menos de 24 horas), una segunda visita podrá tener costo.",
    "Los datos personales y documentos recibidos se tratarán de forma confidencial, únicamente para la prestación del servicio.",
  ].filter((x): x is string => Boolean(x));
  const lineasAviso = avisos.map((a) => renglones(r("• " + a), 7.6, ancho - 16));
  const altoCaja = 14 + lineasAviso.reduce((s, l) => s + l.length * 9.6 + 1, 0) + 4;
  cabe(altoCaja);
  pagina.drawRectangle({ x: mg, y: y - altoCaja, width: ancho, height: altoCaja, color: CLARO });
  pagina.drawRectangle({ x: mg, y: y - altoCaja, width: 2.5, height: altoCaja, color: PRIN });
  pagina.drawText("Importante", { x: mg + 8, y: y - 10, size: 7.6, font: B, color: ACEN });
  let ya = y - 14;
  for (const lineas of lineasAviso) {
    for (const linea of lineas) {
      pintar(linea, mg + 8, ya - 7.6, 7.6);
      ya -= 9.6;
    }
    ya -= 1;
  }

  return pdf.save();
}
