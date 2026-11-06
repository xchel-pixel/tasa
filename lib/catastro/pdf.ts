import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import QRCode from "qrcode";
import type { FuentesPdf } from "@/lib/pdf-cotizacion";
import { municipioPorClave } from "@/lib/traslado/calculo";
import { sinSimbolosFaltantes } from "@/lib/traslado/pdf";
import { fechaLegible, seccionesDeFicha } from "./etiquetas";
import { aUtm, ligaMaps, type Geometria, type Punto } from "./geo";
import type { Ficha } from "./servicio";
import { NOTA_FUENTE } from "./textos";

/**
 * PDF SIN MARCA de la ficha del predio (como el de la calculadora). Lleva exactamente lo que trae `ficha`,
 * que sale de catastro_pdf() en la base (campos de PDF del rol). Croquis del polígono dibujado (contorno,
 * norte y escala gráfica, sin mosaicos de mapa), liga de Google Maps con su QR y la nota de fuente externa.
 * Nunca nombra la fuente.
 */

const TINTA = rgb(0.122, 0.161, 0.2), TENUE = rgb(0.42, 0.455, 0.502), LINEA = rgb(0.875, 0.89, 0.91);
const ANCHO = 612, ALTO = 792, MARGEN = 56;

/** Todo el texto del PDF, en orden (también lo usa la prueba de glifos). */
export function contenidoPdf(f: Ficha) {
  const municipio = municipioPorClave(f.clave) ?? f.municipio;
  const punto = f.latitud && f.longitud ? { lat: Number(f.latitud), lon: Number(f.longitud) } : null;
  return {
    titulo: "Ficha del predio",
    subtitulo: `Clave catastral ${f.clave} · ${municipio}, Qro. · Consultado el ${fechaLegible(f.consultado_en)}${f.expediente === "pendiente" ? " · expediente incompleto" : ""}`,
    // Las mismas secciones y el mismo orden que la pantalla.
    secciones: seccionesDeFicha(f),
    croquis: "Croquis del polígono",
    sinPoligono: "Sin polígono disponible.",
    liga: punto ? ligaMaps(punto.lat, punto.lon) : null,
    ligaTitulo: "Ubicación en Google Maps",
    nota: NOTA_FUENTE,
  };
}

function partir(texto: string, fuente: PDFFont, tam: number, ancho: number): string[] {
  const renglones: string[] = [];
  for (const parrafo of texto.split("\n")) {
    let actual = "";
    for (const palabraLarga of parrafo.split(/\s+/)) for (const palabra of trozos(palabraLarga, fuente, tam, ancho)) {
      const prueba = actual ? `${actual} ${palabra}` : palabra;
      if (fuente.widthOfTextAtSize(prueba, tam) > ancho && actual) {
        renglones.push(actual);
        actual = palabra;
      } else actual = prueba;
    }
    renglones.push(actual);
  }
  return renglones;
}

/** Una "palabra" más ancha que el renglón (una liga) se corta por letras. */
function trozos(palabra: string, fuente: PDFFont, tam: number, ancho: number): string[] {
  if (fuente.widthOfTextAtSize(palabra, tam) <= ancho) return [palabra];
  const salida: string[] = [];
  let actual = "";
  for (const ch of palabra) {
    if (fuente.widthOfTextAtSize(actual + ch, tam) > ancho && actual) {
      salida.push(actual);
      actual = ch;
    } else actual += ch;
  }
  return actual ? [...salida, actual] : salida;
}

type Lienzo = { pdf: PDFDocument; pag: PDFPage; y: number; R: PDFFont; B: PDFFont; limpio: (t: string) => string };

function nuevaHoja(l: Lienzo) {
  l.pag = l.pdf.addPage([ANCHO, ALTO]);
  l.y = ALTO - MARGEN;
}

function texto(l: Lienzo, t: string, { tam = 9, negrita = false, color = TINTA, x = MARGEN, ancho = ANCHO - 2 * MARGEN } = {}) {
  const f = negrita ? l.B : l.R;
  for (const r of partir(l.limpio(t), f, tam, ancho)) {
    if (l.y < MARGEN + tam * 2) nuevaHoja(l);
    l.pag.drawText(r, { x, y: l.y - tam, size: tam, font: f, color });
    l.y -= tam * 1.35;
  }
}

/** Renglones etiqueta/valor; el valor puede ocupar varias líneas. */
function tabla(l: Lienzo, filas: [string, string][]) {
  const W = ANCHO - 2 * MARGEN, colEtiqueta = 175, tam = 8.8;
  for (const [etiqueta, valor] of filas) {
    const lineas = partir(l.limpio(valor), l.R, tam, W - colEtiqueta);
    const lineasEtiqueta = partir(l.limpio(etiqueta), l.R, tam, colEtiqueta - 10);
    const alto = Math.max(1, lineas.length, lineasEtiqueta.length) * tam * 1.3 + 4;
    if (l.y - alto < MARGEN + 20) nuevaHoja(l);
    lineasEtiqueta.forEach((r, i) => l.pag.drawText(r, { x: MARGEN, y: l.y - tam - i * tam * 1.3, size: tam, font: l.R, color: TENUE }));
    lineas.forEach((r, i) => l.pag.drawText(r, { x: MARGEN + colEtiqueta, y: l.y - tam - i * tam * 1.3, size: tam, font: l.R, color: TINTA }));
    l.y -= alto;
    l.pag.drawLine({ start: { x: MARGEN, y: l.y + 2 }, end: { x: MARGEN + W, y: l.y + 2 }, thickness: 0.4, color: LINEA });
  }
}

/** Un número "redondo" (1, 2 o 5 × 10ⁿ) cercano a x, para la escala gráfica. */
export function escalaRedonda(x: number): number {
  const p = 10 ** Math.floor(Math.log10(x));
  return [1, 2, 5, 10].map((m) => m * p).reduce((a, b) => (Math.abs(b - x) < Math.abs(a - x) ? b : a));
}

/** Croquis: el polígono en metros (UTM), ajustado a la caja; norte arriba y escala gráfica. */
function croquis(l: Lienzo, g: Geometria, x0: number, yArriba: number, ancho: number, alto: number) {
  const pols: Punto[][][] = (g.type === "Polygon" ? [g.coordinates] : g.coordinates)
    .map((pol) => pol.map((anillo) => anillo.map(([lon, lat]) => aUtm(lat, lon))));
  const todos = pols.flat(2);
  const xs = todos.map((p) => p[0]), ys = todos.map((p) => p[1]);
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const margenInterno = 18;
  const escala = Math.min((ancho - 2 * margenInterno) / Math.max(maxX - minX, 0.5), (alto - 2 * margenInterno - 16) / Math.max(maxY - minY, 0.5));
  const dx = x0 + (ancho - (maxX - minX) * escala) / 2, dyArriba = (alto - 16 - (maxY - minY) * escala) / 2;
  // drawSvgPath: origen arriba a la izquierda, y hacia abajo.
  const camino = pols.flatMap((pol) => pol.map((anillo) =>
    anillo.map(([x, y], i) => `${i ? "L" : "M"}${((x - minX) * escala).toFixed(2)} ${((maxY - y) * escala).toFixed(2)}`).join(" ") + " Z")).join(" ");
  l.pag.drawRectangle({ x: x0, y: yArriba - alto, width: ancho, height: alto, borderColor: LINEA, borderWidth: 0.6 });
  l.pag.drawSvgPath(camino, { x: dx, y: yArriba - dyArriba, borderColor: TINTA, borderWidth: 1.2, color: rgb(0.86, 0.9, 0.95) });
  // Norte
  const nx = x0 + ancho - 16, ny = yArriba - 14;
  l.pag.drawSvgPath("M0 0 L5 14 L0 10 L-5 14 Z", { x: nx, y: ny, color: TINTA });
  l.pag.drawText("N", { x: nx - 3, y: ny - 24, size: 8, font: l.B, color: TINTA });
  // Escala gráfica: ~1/4 del ancho
  const metros = escalaRedonda(((ancho - 2 * margenInterno) / 4) / escala);
  const largo = metros * escala, ex = x0 + 10, ey = yArriba - alto + 10;
  l.pag.drawRectangle({ x: ex, y: ey, width: largo / 2, height: 3, color: TINTA });
  l.pag.drawRectangle({ x: ex + largo / 2, y: ey, width: largo / 2, height: 3, borderColor: TINTA, borderWidth: 0.6 });
  l.pag.drawText("0", { x: ex - 1, y: ey + 5, size: 6.5, font: l.R, color: TENUE });
  const etiqueta = `${metros.toLocaleString("es-MX")} m`;
  l.pag.drawText(etiqueta, { x: ex + largo - l.R.widthOfTextAtSize(etiqueta, 6.5) / 2, y: ey + 5, size: 6.5, font: l.R, color: TENUE });
}

/** El QR de la liga, en cuadritos vectoriales. */
function qr(l: Lienzo, texto: string, x: number, yArriba: number, lado: number) {
  const { modules } = QRCode.create(texto, { errorCorrectionLevel: "M" });
  const n = modules.size, m = lado / (n + 2);
  for (let fila = 0; fila < n; fila++) for (let col = 0; col < n; col++) {
    if (modules.get(fila, col)) l.pag.drawRectangle({ x: x + (col + 1) * m, y: yArriba - (fila + 2) * m, width: m, height: m, color: TINTA });
  }
}

export async function pdfPredio(f: Ficha, fuentes: FuentesPdf): Promise<Uint8Array> {
  const c = contenidoPdf(f);
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  pdf.setTitle(`${c.titulo} ${f.clave}`);
  const R = await pdf.embedFont(fuentes.regular, { subset: fuentes.subconjunto });
  const B = await pdf.embedFont(fuentes.negrita, { subset: fuentes.subconjunto });
  const glifos = new Set(R.getCharacterSet());
  const limpio = (t: string) => sinSimbolosFaltantes(t, (ch) => glifos.has(ch));
  const l: Lienzo = { pdf, pag: pdf.addPage([ANCHO, ALTO]), y: ALTO - MARGEN, R, B, limpio };
  const W = ANCHO - 2 * MARGEN;

  texto(l, c.titulo, { tam: 17, negrita: true });
  texto(l, c.subtitulo, { tam: 8.8, color: TENUE });
  l.y -= 10;

  // Croquis a la izquierda; liga y QR a la derecha.
  const altoCroquis = 210, anchoCroquis = W - 150;
  texto(l, c.croquis, { tam: 10, negrita: true });
  l.y -= 2;
  const arriba = l.y;
  if (f.geometria) croquis(l, f.geometria, MARGEN, arriba, anchoCroquis, altoCroquis);
  else {
    l.pag.drawRectangle({ x: MARGEN, y: arriba - altoCroquis, width: anchoCroquis, height: altoCroquis, borderColor: LINEA, borderWidth: 0.6 });
    l.pag.drawText(limpio(c.sinPoligono), { x: MARGEN + 12, y: arriba - 24, size: 9, font: R, color: TENUE });
  }
  if (c.liga) {
    const xq = MARGEN + anchoCroquis + 16, ancho = W - anchoCroquis - 16;
    qr(l, c.liga, xq, arriba, ancho);
    let y = arriba - ancho - 4;
    l.pag.drawText(limpio(c.ligaTitulo), { x: xq, y: y - 8, size: 8, font: B, color: TINTA });
    y -= 12;
    for (const r of partir(c.liga, R, 6.5, ancho)) {
      l.pag.drawText(r, { x: xq, y: y - 6.5, size: 6.5, font: R, color: TENUE });
      y -= 8.5;
    }
  }
  l.y = arriba - altoCroquis - 16;

  for (const s of c.secciones) {
    // Que el título no quede solo al pie de la hoja.
    if (l.y < MARGEN + 60) nuevaHoja(l);
    texto(l, s.titulo, { tam: 10, negrita: true });
    l.y -= 2;
    tabla(l, s.filas);
    l.y -= 10;
  }
  l.y -= 4;
  texto(l, c.nota, { tam: 7.8, color: TENUE });

  const hojas = pdf.getPages();
  if (hojas.length > 1) hojas.forEach((h, i) => {
    const t = `Hoja ${i + 1} de ${hojas.length}`;
    h.drawText(t, { x: ANCHO - MARGEN - R.widthOfTextAtSize(t, 7.5), y: MARGEN / 2, size: 7.5, font: R, color: TENUE });
  });
  return pdf.save();
}
