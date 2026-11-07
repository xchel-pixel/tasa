import { decodePDFRawStream, PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream, PDFRef, PDFStream } from "pdf-lib";

/**
 * El texto de un PDF hecho con pdf-lib (fuentes incrustadas con su tabla ToUnicode), con pdf-lib mismo: por cada
 * hoja, la tabla glifo → letra de cada fuente y lo que se escribe con "<…> Tj" bajo la fuente activa ("/F Tf").
 * Alcanza para revisar qué dice un PDF de Tasa en humo; no es un lector general de PDF.
 */

function bytesDe(pdf: PDFDocument, objeto: unknown): string {
  const s = objeto instanceof PDFRef ? pdf.context.lookup(objeto) : objeto;
  if (s instanceof PDFRawStream) return Buffer.from(decodePDFRawStream(s).decode()).toString("latin1");
  if (s instanceof PDFStream) return Buffer.from(s.getContents()).toString("latin1");
  return "";
}

function tablaDe(cmap: string): Map<string, string> {
  const mapa = new Map<string, string>();
  const letra = (hex: string) => String.fromCodePoint(...(hex.match(/.{4}/g) ?? []).map((h) => parseInt(h, 16)));
  for (const b of cmap.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const [, g, u] of b[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) mapa.set(g.toUpperCase(), letra(u));
  }
  for (const b of cmap.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const [, a, z, u] of b[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
      const [ia, iz, iu] = [parseInt(a, 16), parseInt(z, 16), parseInt(u, 16)];
      for (let i = ia; i <= iz; i++) mapa.set(i.toString(16).toUpperCase().padStart(a.length, "0"), String.fromCodePoint(iu + i - ia));
    }
  }
  return mapa;
}

export async function textoDePdf(bytes: Uint8Array): Promise<string> {
  const pdf = await PDFDocument.load(bytes);
  const renglones: string[] = [];
  for (const hoja of pdf.getPages()) {
    const fuentes = hoja.node.Resources()?.lookup(PDFName.of("Font"), PDFDict);
    const tablas = new Map<string, Map<string, string>>();
    for (const [nombre, ref] of fuentes?.entries() ?? []) {
      const fuente = pdf.context.lookup(ref, PDFDict);
      tablas.set(nombre.asString().replace(/^\//, ""), tablaDe(bytesDe(pdf, fuente.get(PDFName.of("ToUnicode")))));
    }
    const contenidos = hoja.node.Contents();
    const partes = contenidos instanceof PDFArray ? contenidos.asArray() : [contenidos];
    const flujo = partes.map((p) => bytesDe(pdf, p)).join("\n");
    let activa = new Map<string, string>();
    for (const m of flujo.matchAll(/\/([^\s/]+)\s+[\d.]+\s+Tf|<([0-9A-Fa-f]+)>\s*Tj/g)) {
      if (m[1]) activa = tablas.get(m[1]) ?? new Map();
      else renglones.push((m[2].match(/.{4}/g) ?? []).map((g) => activa.get(g.toUpperCase()) ?? "").join(""));
    }
  }
  return renglones.join("\n");
}
