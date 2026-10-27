import { writeFileSync } from "node:fs";
import { PDFDocument } from "pdf-lib";
import { describe, expect, test } from "vitest";
import { generarPdfCotizacion } from "@/lib/pdf-cotizacion";

/**
 * El PDF de la cotización: que se genere con acentos y ñ (las fuentes
 * estándar de PDF los traen), que sea una sola hoja y que lleve los
 * datos bancarios. Con PDF_MUESTRA=ruta guarda el archivo para verlo.
 */
describe("PDF de cotización", () => {
  test("se genera con desglose y datos bancarios", async () => {
    const bytes = await generarPdfCotizacion({
      referencia: "A1B2C3D4",
      emitida: "26 oct 2026",
      vigente_hasta: "10 nov 2026",
      cliente: "Jorge Salinas Muñoz",
      servicio: "Avalúo Hacendario",
      inmueble: "Calle Hidalgo 45, El Pueblito, Corregidora",
      honorarios: 9500,
      iva: 1520,
      terceros: 2300,
      total: 13320,
      cuenta: { titular: "AP73", banco: "Banregio", clabe: "000000000000000002" },
    });

    expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe("%PDF-");
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
    expect(doc.getTitle()).toBe("Cotización A1B2C3D4");

    if (process.env.PDF_MUESTRA) writeFileSync(process.env.PDF_MUESTRA, bytes);
  });
});
