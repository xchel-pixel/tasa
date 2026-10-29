import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { PDFDocument } from "pdf-lib";
import { describe, expect, test } from "vitest";
import { fuentesDe } from "@/lib/fuentes-pdf";
import { enLetras, generarPdfCotizacion, type DatosPdf, type MarcaPdf } from "@/lib/pdf-cotizacion";

/**
 * El PDF de la marca ejecutora: que se genere con cada tipografía y
 * hoja, que no mencione Tasa y que la regla del IVA se respete. Con
 * PDF_MUESTRA=<carpeta> guarda un PDF por marca para verlo.
 */

const marcas: Record<string, MarcaPdf> = {
  MGP: {
    clave: "MGP", nombre_legal: "MGP Ingeniería & Consultoría Inmobiliaria",
    direccion: "High Park Corporate Centro Sur, Oficina 15H, C.P. 76090, Querétaro, Qro.",
    correo: "avaluosmgp@gmail.com", telefonos: "442 682 1525 · 442 109 1882",
    firmante: "M. en C. Mitzin Xchel Guerrero Solorio", firmante_cargo: "Director de Operaciones",
    formas_pago: "Efectivo | Al momento de la visita al inmueble.",
    color: "#04386C", color_acento: "#006DB3", color_claro: "#E7F0F8", hoja: "carta",
  },
  AP73: {
    clave: "AP73", nombre_legal: "AP73 · Adrián Puente",
    direccion: "High Park Corporate Centro Sur, Oficina 15H, C.P. 76090, Querétaro, Qro.",
    correo: "gerencia@ap73.mx · apuente@ap73.mx", telefonos: "442 682 1525 · 442 426 1073",
    firmante: "M. en C. Adrián Gonzalo Puente Suárez", firmante_cargo: "Tasador con registro en el Estado de Querétaro",
    formas_pago: "Tarjeta de débito o crédito | Solicite su liga de pago en línea.\nEfectivo | Al momento de la visita al inmueble.",
    color: "#262626", color_acento: "#262626", color_claro: "#EFEFEF", hoja: "oficio",
  },
  ARQOS: {
    clave: "ARQOS", nombre_legal: "ARQOS Unidad de Valuación en Inteligencia Inmobiliaria, S.A. de C.V.",
    direccion: "High Park Corporate Centro Sur, Oficina 15H, C.P. 76090, Querétaro, Qro.",
    correo: "avaluosmgp@gmail.com", telefonos: "442 682 1525 · 442 109 1882",
    firmante: "M. en C. Mitzin Xchel Guerrero Solorio", firmante_cargo: "Director de Operaciones",
    formas_pago: "Efectivo | Al momento de la visita al inmueble.",
    color: "#1F3C6E", color_acento: "#1F3C6E", color_claro: "#E8EDF5", hoja: "carta",
  },
};

const base = (marca: MarcaPdf, factura: boolean): DatosPdf => ({
  numero: "261103-T1",
  fecha: "2026-11-03",
  vigente_hasta: "2026-12-03",
  cliente: "Jorge Salinas Muñoz",
  inmueble: { ubicacion: "Calle Hidalgo 45, El Pueblito, Corregidora", clave_catastral: "060100101404002", descripcion: "Casa habitación de dos niveles." },
  servicio: {
    nombre: "Avalúo Comercial",
    alcance: "Revisión documental, inspección física, investigación de mercado e informe firmado por perito valuador.",
    tiempo_entrega: "5 días hábiles posteriores a la visita",
    documentos: "Escritura o título de propiedad.\nBoleta predial vigente.",
    aviso: "El avalúo es válido únicamente para el propósito declarado durante 6 meses.",
  },
  honorarios: 9500,
  terceros: 2300,
  requiere_factura: factura,
  iva: factura ? 1520 : 0,
  total: factura ? 13320 : 11800,
  cuenta: { titular: "Conjuntos Habitacionales y Comerciales ROMI, S.A. de C.V.", banco: "Fondeadora", clabe: "699180600008088771" },
  comisionista: "Beto Prueba",
  marca,
});

/** El texto que se ve en el PDF (las fuentes insertadas guardan el texto en hexadecimal). */
async function tamanoHoja(bytes: Uint8Array) {
  const doc = await PDFDocument.load(bytes);
  return { paginas: doc.getPageCount(), alto: doc.getPage(0).getHeight(), autor: doc.getAuthor() ?? "", titulo: doc.getTitle() };
}

describe("PDF de cotización por marca", () => {
  test("números en letras", () => {
    expect(enLetras(13320)).toBe("TRECE MIL TRESCIENTOS VEINTE PESOS 00/100 M.N.");
    expect(enLetras(1001.5)).toBe("MIL UN PESOS 50/100 M.N.");
  });

  for (const [clave, marca] of Object.entries(marcas)) {
    test(`${clave}: se genera con su tipografía y hoja, sin mencionar Tasa`, async () => {
      const fuentes = await fuentesDe(clave === "MGP" ? "manrope" : "adventor");
      const bytes = await generarPdfCotizacion(base(marca, clave !== "ARQOS"), fuentes);
      expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe("%PDF-");
      const info = await tamanoHoja(bytes);
      expect(info.paginas).toBeLessThanOrEqual(2);
      expect(info.alto).toBe(marca.hoja === "oficio" ? 1008 : 792);
      expect(info.titulo).toBe("Cotización 261103-T1");
      expect(info.autor).toBe(marca.nombre_legal);
      expect(Buffer.from(bytes).toString("latin1")).not.toMatch(/Tasa/);
      expect(bytes.length).toBeLessThan(clave === "MGP" ? 150_000 : 500_000);
      if (process.env.PDF_MUESTRA) writeFileSync(join(process.env.PDF_MUESTRA, `muestra-${clave}.pdf`), bytes);
    });
  }

  test("Sin costo y estimado con rango: se generan sin pasar de la hoja", async () => {
    const fuentes = await fuentesDe("manrope");
    const sinCosto = await generarPdfCotizacion({ ...base(marcas.MGP, true), honorario_tipo: "sin_costo", honorarios: 0, iva: 0, total: 0 }, fuentes);
    const estimado = await generarPdfCotizacion(
      { ...base(marcas.MGP, true), honorario_tipo: "estimado", honorario_minimo: 6000, honorarios: 9500 },
      fuentes
    );
    for (const bytes of [sinCosto, estimado]) {
      expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe("%PDF-");
      expect((await tamanoHoja(bytes)).paginas).toBeLessThanOrEqual(2);
    }
    if (process.env.PDF_MUESTRA) {
      writeFileSync(join(process.env.PDF_MUESTRA, "muestra-sin-costo.pdf"), sinCosto);
      writeFileSync(join(process.env.PDF_MUESTRA, "muestra-estimado.pdf"), estimado);
    }
  });
});
