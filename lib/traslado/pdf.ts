import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { FuentesPdf } from "@/lib/pdf-cotizacion";
import type { Concepto, Resultado } from "./calculo";

/**
 * PDF SIN MARCA de la calculadora de traslado, como el de la skill: hoja 1 con datos, totales, conceptos
 * por parte y sugerencias; hoja 2 (opcional) con el detalle del cálculo y las observaciones. Leyenda fija.
 */

export const LEYENDA = "Estimación aproximada; el notario y las autoridades determinan las cifras definitivas. No es asesoría fiscal.";

const TINTA = rgb(0.122, 0.161, 0.2), TENUE = rgb(0.42, 0.455, 0.502), LINEA = rgb(0.875, 0.89, 0.91), SUAVE = rgb(0.957, 0.965, 0.973);
const ANCHO = 612, ALTO = 792, MARGEN = 56;
const pesos = (x: number) => `$${x.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const sinHtml = (s: string) => s.replace(/<[^>]+>/g, "");

/** Símbolos que Manrope no tiene (saldrían como un cuadro): en palabras. Lo demás sin glifo se quita. */
const EN_PALABRAS: Record<string, string> = { "→": ":", "≈": "aprox.", "≥": "mayor o igual a", "≤": "menor o igual a", "⚑": "" };
export function sinSimbolosFaltantes(texto: string, tiene: (c: number) => boolean): string {
  return [...texto].map((ch) => (tiene(ch.codePointAt(0)!) ? ch : (EN_PALABRAS[ch] ?? ""))).join("");
}

type Lienzo = { pdf: PDFDocument; pag: PDFPage; y: number; R: PDFFont; B: PDFFont; limpio: (t: string) => string };

function partir(texto: string, fuente: PDFFont, tam: number, ancho: number): string[] {
  const renglones: string[] = [];
  for (const parrafo of texto.split("\n")) {
    let actual = "";
    for (const palabra of parrafo.split(/\s+/)) {
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

function nuevaHoja(l: Lienzo) {
  l.pag = l.pdf.addPage([ANCHO, ALTO]);
  l.y = ALTO - MARGEN;
}

function texto(l: Lienzo, t: string, { tam = 9, negrita = false, color = TINTA, x = MARGEN, ancho = ANCHO - 2 * MARGEN, interlinea = 1.35 } = {}) {
  const f = negrita ? l.B : l.R;
  for (const r of partir(l.limpio(t), f, tam, ancho)) {
    if (l.y < MARGEN + tam * 2) nuevaHoja(l);
    l.pag.drawText(r, { x, y: l.y - tam, size: tam, font: f, color });
    l.y -= tam * interlinea;
  }
}

function bloque(l: Lienzo, titulo: string, filas: Concepto[], total: number, x: number, ancho: number, yInicio: number): number {
  let y = yInicio;
  const fila = (izq: string, der: string, { negrita = false, color = TINTA, tam = 9 } = {}) => {
    const f = negrita ? l.B : l.R;
    const lineas = partir(l.limpio(izq), f, tam, ancho * 0.64);
    lineas.forEach((r, i) => l.pag.drawText(r, { x, y: y - tam - i * tam * 1.3, size: tam, font: f, color }));
    if (der) l.pag.drawText(der, { x: x + ancho - f.widthOfTextAtSize(der, tam), y: y - tam, size: tam, font: f, color });
    y -= lineas.length * tam * 1.3 + 4;
  };
  l.pag.drawText(titulo, { x, y: y - 11, size: 11, font: l.B, color: TINTA });
  y -= 20;
  let grupo = "";
  for (const [g, k, v] of filas) {
    if (g !== grupo) {
      y -= 3;
      fila(g.toUpperCase(), "", { negrita: true, color: TENUE, tam: 7.5 });
      grupo = g;
    }
    fila(k, pesos(v));
    l.pag.drawLine({ start: { x, y: y + 2 }, end: { x: x + ancho, y: y + 2 }, thickness: 0.4, color: LINEA });
  }
  l.pag.drawLine({ start: { x, y: y }, end: { x: x + ancho, y }, thickness: 1, color: TINTA });
  y -= 4;
  fila("Total", pesos(total), { negrita: true });
  return y;
}

export async function pdfTraslado(r: Resultado & { avisos?: string[] }, opciones: { referencia?: string | null; operacion?: string; detalle: boolean; fuentes: FuentesPdf; usaInpc?: boolean }): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  pdf.setTitle("Estimación de gastos de traslado");
  const R = await pdf.embedFont(opciones.fuentes.regular, { subset: opciones.fuentes.subconjunto });
  const B = await pdf.embedFont(opciones.fuentes.negrita, { subset: opciones.fuentes.subconjunto });
  const glifos = new Set(R.getCharacterSet());
  const limpio = (t: string) => sinSimbolosFaltantes(t, (c) => glifos.has(c));
  const l: Lienzo = { pdf, pag: pdf.addPage([ANCHO, ALTO]), y: ALTO - MARGEN, R, B, limpio };
  const [a, mm, d] = r.fecha.split("-");
  const W = ANCHO - 2 * MARGEN;

  texto(l, "Estimación de gastos de traslado de dominio", { tam: 17, negrita: true });
  texto(l, [opciones.referencia, `${r.municipio}, Qro.`, `Firma estimada ${d}/${mm}/${a}`].filter(Boolean).join(" · "), { tam: 8.8, color: TENUE });
  l.y -= 8;

  // Datos de la operación.
  const datos: [string, string][] = [
    ["Operación", (opciones.operacion || "compraventa").replace(/^./, (c) => c.toUpperCase())],
    ["Valor de operación", r.vo ? pesos(r.vo) : "—"],
    ["Avalúo", r.va ? pesos(r.va) : "—"],
  ];
  datos.forEach(([e, v], i) => {
    const x = MARGEN + (W / 3) * i;
    l.pag.drawText(e, { x, y: l.y - 8, size: 7.8, font: R, color: TENUE });
    l.pag.drawText(v, { x, y: l.y - 21, size: 10, font: B, color: TINTA });
  });
  l.y -= 30;
  l.pag.drawLine({ start: { x: MARGEN, y: l.y }, end: { x: MARGEN + W, y: l.y }, thickness: 0.6, color: LINEA });
  l.y -= 12;

  // Totales.
  const tarjetas: [string, number][] = [];
  if (r.lado !== "V") tarjetas.push(["Total a cargo del comprador", r.totC]);
  if (r.lado !== "C") tarjetas.push(["Total a cargo del vendedor", r.totV]);
  if (r.lado === "AMBOS") tarjetas.push(["Total de la operación", r.totC + r.totV]);
  const anchoT = W / tarjetas.length;
  tarjetas.forEach(([e, v], i) => {
    const x = MARGEN + anchoT * i;
    l.pag.drawRectangle({ x: x + (i ? 3 : 0), y: l.y - 46, width: anchoT - (i ? 3 : 0) - (i < tarjetas.length - 1 ? 3 : 0), height: 46, color: SUAVE });
    l.pag.drawText(e, { x: x + 10, y: l.y - 15, size: 7.8, font: R, color: TENUE });
    l.pag.drawText(pesos(v), { x: x + 10, y: l.y - 36, size: 16, font: B, color: TINTA });
  });
  l.y -= 60;

  // Conceptos.
  if (r.lado === "AMBOS") {
    const w = (W - 24) / 2;
    const y1 = bloque(l, "Comprador", r.C, r.totC, MARGEN, w, l.y);
    const y2 = bloque(l, "Vendedor", r.V, r.totV, MARGEN + w + 24, w, l.y);
    l.y = Math.min(y1, y2) - 6;
  } else {
    l.y = bloque(l, r.lado === "C" ? "Comprador" : "Vendedor", r.lado === "C" ? r.C : r.V, r.lado === "C" ? r.totC : r.totV, MARGEN, W, l.y) - 6;
  }

  // Sugerencias.
  const sug: [string, string[]][] = [];
  if (r.lado !== "V" && r.SC.length) sug.push(["Comprador", r.SC]);
  if (r.lado !== "C" && r.SV.length) sug.push(["Vendedor", r.SV]);
  if (sug.length) {
    l.y -= 6;
    texto(l, "Sugerencias (informativas)", { tam: 10.5, negrita: true });
    for (const [quien, lista] of sug) {
      texto(l, quien.toUpperCase(), { tam: 7.5, negrita: true, color: TENUE });
      for (const s of lista) texto(l, `• ${sinHtml(s)}`, { tam: 8.2 });
    }
  }
  const avisos = (r.avisos ?? []).filter((a2) => !a2.includes("INPC") || opciones.usaInpc);
  if (avisos.length) {
    l.y -= 4;
    for (const a2 of avisos) texto(l, `Aviso: ${a2}`, { tam: 8, color: TENUE });
  }
  l.y -= 8;
  texto(l, `${LEYENDA}${opciones.detalle ? " Ver detalle y observaciones en la hoja 2." : ""}`, { tam: 7.8, color: TENUE });

  if (opciones.detalle && r.det.length) {
    nuevaHoja(l);
    texto(l, "Detalle del cálculo", { tam: 17, negrita: true });
    texto(l, [opciones.referencia, r.municipio, `${d}/${mm}/${a}`].filter(Boolean).join(" · "), { tam: 8.8, color: TENUE });
    for (const [titulo, pasos] of r.det) {
      l.y -= 6;
      texto(l, titulo, { tam: 10.5, negrita: true });
      for (const p of pasos) texto(l, p, { tam: 8.2 });
    }
    if (r.notas.length) {
      l.y -= 6;
      texto(l, "Observaciones", { tam: 10.5, negrita: true });
      for (const n of r.notas) texto(l, `• ${n}`, { tam: 8.2 });
    }
    l.y -= 10;
    texto(l, `Fuentes: ${r.ley_istd}; Ley de Hacienda de los Municipios del Estado de Querétaro; Ley del ISR arts. 93, 119-132 y Anexo 8 RMF 2026; `
      + "Ley del Notariado del Estado de Querétaro arts. 147, 158 y 171; Ley de Hacienda del Estado de Querétaro arts. 90-110; INPC (INEGI); UDI (Banxico).", { tam: 7.6, color: TENUE });
    texto(l, LEYENDA, { tam: 7.6, color: TENUE });
  }
  // Pie: "Hoja 1 de 2" en el detallado; el de una hoja va sin número.
  const hojas = pdf.getPages();
  if (hojas.length > 1) hojas.forEach((p, i) => {
    const t = `Hoja ${i + 1} de ${hojas.length}`;
    p.drawText(t, { x: ANCHO - MARGEN - R.widthOfTextAtSize(t, 7), y: 34, size: 7, font: R, color: TENUE });
  });
  return pdf.save();
}
