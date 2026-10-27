import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { pesos } from "@/lib/formato";

/**
 * El PDF simple de la cotización. Sin logo ni nombre de marca: es un
 * documento de Tasa para que el comisionista se lo pase al cliente. Los
 * datos bancarios llevan el TITULAR real (es lo que el cliente necesita
 * para transferir); en ningún otro lado se usa el titular.
 *
 * Las fuentes estándar de PDF (Helvetica) traen acentos y ñ; no hace
 * falta incrustar ninguna.
 */
export type DatosPdf = {
  referencia: string;
  emitida: string; // "26 oct 2026"
  vigente_hasta: string;
  cliente: string;
  servicio: string;
  inmueble: string;
  honorarios: number;
  iva: number | null;
  terceros: number;
  total: number;
  cuenta: { titular: string; banco: string | null; clabe: string };
};

const MARINO = rgb(4 / 255, 56 / 255, 108 / 255);
const TEXTO = rgb(16 / 255, 32 / 255, 47 / 255);
const SECUNDARIO = rgb(90 / 255, 101 / 255, 115 / 255);
const LINEA = rgb(213 / 255, 219 / 255, 227 / 255);
const TINTE = rgb(231 / 255, 240 / 255, 248 / 255);

export async function generarPdfCotizacion(d: DatosPdf): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Cotización ${d.referencia}`);
  const pagina = pdf.addPage([612, 792]); // carta
  const normal = await pdf.embedFont(StandardFonts.Helvetica);
  const negrita = await pdf.embedFont(StandardFonts.HelveticaBold);

  const margen = 56;
  const ancho = 612 - margen * 2;
  let y = 792 - margen;

  const texto = (t: string, x: number, tam = 11, fuente = normal, color = TEXTO) =>
    pagina.drawText(t, { x, y, size: tam, font: fuente, color });

  texto("Cotización de servicios de valuación", margen, 18, negrita, MARINO);
  y -= 22;
  texto(`Referencia ${d.referencia} · Emitida el ${d.emitida} · Vigente hasta el ${d.vigente_hasta}`, margen, 10, normal, SECUNDARIO);
  y -= 30;

  for (const [etiqueta, valor] of [
    ["Cliente", d.cliente],
    ["Servicio", d.servicio],
    ["Inmueble", d.inmueble],
  ] as const) {
    texto(etiqueta, margen, 10, normal, SECUNDARIO);
    y -= 15;
    for (const renglon of partir(valor, negrita, 12, ancho)) {
      texto(renglon, margen, 12, negrita);
      y -= 16;
    }
    y -= 8;
  }

  // Desglose sobre fondo tinte, total en marino.
  const filas: [string, number][] = [["Honorarios", d.honorarios]];
  if (d.iva !== null) filas.push(["IVA (16%)", d.iva]);
  if (d.terceros > 0) filas.push(["Derechos y terceros", d.terceros]);
  const alto = filas.length * 20 + 44;
  y -= 6;
  pagina.drawRectangle({ x: margen, y: y - alto + 14, width: ancho, height: alto, color: TINTE });
  y -= 6;
  for (const [etiqueta, monto] of filas) {
    texto(etiqueta, margen + 14, 11, normal, SECUNDARIO);
    pagina.drawText(pesos(monto), {
      x: margen + ancho - 14 - normal.widthOfTextAtSize(pesos(monto), 11),
      y, size: 11, font: normal, color: TEXTO,
    });
    y -= 20;
  }
  pagina.drawLine({ start: { x: margen + 14, y: y + 10 }, end: { x: margen + ancho - 14, y: y + 10 }, thickness: 0.8, color: LINEA });
  y -= 8;
  texto("Total", margen + 14, 13, negrita);
  pagina.drawText(pesos(d.total), {
    x: margen + ancho - 14 - negrita.widthOfTextAtSize(pesos(d.total), 15),
    y, size: 15, font: negrita, color: MARINO,
  });
  y -= 48;

  texto("Datos para transferir", margen, 13, negrita, MARINO);
  y -= 22;
  texto("CLABE", margen, 10, normal, SECUNDARIO);
  y -= 18;
  const c = d.cuenta.clabe;
  texto(`${c.slice(0, 3)} ${c.slice(3, 6)} ${c.slice(6, 17)} ${c.slice(17)}`, margen, 16, negrita, MARINO);
  y -= 22;
  texto(`Titular: ${d.cuenta.titular}`, margen, 11);
  y -= 16;
  if (d.cuenta.banco) {
    texto(`Banco: ${d.cuenta.banco}`, margen, 11);
    y -= 16;
  }
  y -= 18;

  for (const renglon of partir(
    "Precios en pesos mexicanos. Al transferir, usa como concepto la referencia de esta cotización. La cotización vence en la fecha indicada; después se emite una nueva.",
    normal, 9.5, ancho
  )) {
    texto(renglon, margen, 9.5, normal, SECUNDARIO);
    y -= 13;
  }

  return pdf.save();
}

/** Corta un texto largo en renglones que caben en `ancho`. */
function partir(texto: string, fuente: { widthOfTextAtSize: (t: string, s: number) => number }, tam: number, ancho: number): string[] {
  const palabras = texto.split(/\s+/);
  const renglones: string[] = [];
  let actual = "";
  for (const p of palabras) {
    const prueba = actual ? `${actual} ${p}` : p;
    if (fuente.widthOfTextAtSize(prueba, tam) > ancho && actual) {
      renglones.push(actual);
      actual = p;
    } else {
      actual = prueba;
    }
  }
  if (actual) renglones.push(actual);
  return renglones;
}
