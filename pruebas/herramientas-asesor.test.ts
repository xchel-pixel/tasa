import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { ARCHIVO, cspHerramienta, prepararHerramienta, type ClaveHerramientaAsesor, type Inyeccion } from "@/lib/herramientas-asesor/preparar";

/**
 * Herramientas de asesor (0100): lo que Tasa les cambia antes de entregarlas. Sin dependencias externas, sin scripts sin
 * nonce, sin encabezado propio, con las conexiones TASA_* y el borrado a las 24 h.
 */

const original = (c: ClaveHerramientaAsesor) => readFileSync(join(import.meta.dirname, "..", "assets", "herramientas", ARCHIVO[c]), "utf8");
const base = (herramienta: ClaveHerramientaAsesor, extra: Partial<Inyeccion> = {}): Inyeccion => ({
  nonce: "NONCE123", herramienta, asesor: null, prellenar: null, catastro: false, solicitar: null, revisado: null, ...extra,
});
// El contrato (fase 3) todavía trae Tesseract de un CDN: hasta servirlo desde Tasa, no se entrega.
const CLAVES: ClaveHerramientaAsesor[] = ["ficha_captacion", "checklist_documentos", "acta_entrega"];

describe("Preparar las herramientas", () => {
  test.each(CLAVES)("%s: sin CDN ni Google Fonts; jsPDF, pdf.js y QRious desde /vendor con versión fija", (c) => {
    const html = prepararHerramienta(original(c), base(c));
    expect(html).not.toMatch(/cdnjs|cdn[.]jsdelivr|fonts[.]googleapis|fonts[.]gstatic|DM Sans/);
    expect(html).toContain('src="/vendor/jspdf-2.5.1/jspdf.umd.min.js"');
    expect(html).toContain('href="/vendor/manrope/manrope.css"');
  });
  test.each(CLAVES)("%s: todo <script> lleva el nonce; nada de window.claude ni comentarios de integración", (c) => {
    const html = prepararHerramienta(original(c), base(c));
    const scripts = html.match(/<script[^>]*>/g) ?? [];
    expect(scripts.length).toBeGreaterThan(1);
    expect(scripts.every((s) => s.includes('nonce="NONCE123"'))).toBe(true);
    expect(html).not.toMatch(/window[.]claude|INTEGRACIÓN CON TASA|Xchel/);
  });
  test("sin su encabezado (lo pone Tasa), pero con el botón Borrar datos de este equipo", () => {
    const html = prepararHerramienta(original("ficha_captacion"), base("ficha_captacion"));
    expect(html).toContain("header>div{display:none!important}");
    expect(html).toContain('id="borrar"');
  });
  test("TASA_asesor y TASA_prellenar en JSON que no puede cerrar el <script>", () => {
    const html = prepararHerramienta(original("ficha_captacion"), base("ficha_captacion", {
      asesor: { nombre: "Ana </script><script>alert(1)</script>", empresa: "", telefono: "4421234567", correo: "a@b.mx", logo: null },
      prellenar: { cat: "140100123619995" },
    }));
    expect(html).toContain("window.TASA_asesor=");
    expect(html).not.toContain("Ana </script>");
    expect(html).toContain('window.TASA_prellenar={"cat":"140100123619995"}');
  });
  test("TASA_catastro solo si la persona tiene el Mapa catastral; va a Tasa, nunca a la fuente", () => {
    expect(prepararHerramienta(original("ficha_captacion"), base("ficha_captacion"))).not.toContain("window.TASA_catastro=");
    const con = prepararHerramienta(original("ficha_captacion"), base("ficha_captacion", { catastro: true }));
    expect(con).toContain('fetch("/h/catastro?clave="');
  });
  test("borradores: se borran a las 24 h todos los mgp_* menos los datos del propio asesor", () => {
    const html = prepararHerramienta(original("acta_entrega"), base("acta_entrega"));
    expect(html).toContain("DIA=864e5");
    expect(html).toContain('n==="mgp_asesor_v1"');
  });
  test("Solicitar a MGP: solo con servicios (comisionista); abre la solicitud con el servicio", () => {
    expect(prepararHerramienta(original("checklist_documentos"), base("checklist_documentos"))).not.toContain("Solicitar a MGP");
    const html = prepararHerramienta(original("checklist_documentos"), base("checklist_documentos", { solicitar: { clg: "id-clg", regimen: "id-reg" } }));
    expect(html).toContain('"clg":"id-clg"');
    expect(html).toContain("/solicitudes/nueva?");
  });
  test("checklist: la fecha de revisión sale de Ajustes (arriba y en el PDF)", () => {
    const html = prepararHerramienta(original("checklist_documentos"), base("checklist_documentos", { revisado: "15 de enero de 2027" }));
    expect(html).toContain('const REV="15 de enero de 2027";');
    expect(html).toContain("Requisitos revisados al <b>15 de enero de 2027</b>");
    expect(html).not.toContain("27 de noviembre de 2026");
  });
  test("el contrato no se sirve mientras dependa de un CDN (Tesseract, fase 3)", () => {
    expect(() => prepararHerramienta(original("contrato_arrendamiento"), base("contrato_arrendamiento"))).toThrow(/dependencia externa/);
  });
  test("si una versión nueva cambia lo que se espera, falla claro (no sirve a medias)", () => {
    expect(() => prepararHerramienta("<html><head></head><body></body></html>", base("ficha_captacion"))).toThrow(/Herramienta/);
  });
  test("CSP: scripts solo con nonce (sin unsafe-inline), nada sale a otro sitio, solo dentro de Tasa", () => {
    const csp = cspHerramienta("N");
    expect(csp).toContain("script-src 'self' 'nonce-N' 'wasm-unsafe-eval'");
    expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/);
    expect(csp).toContain("connect-src 'self'");
    expect(csp).toContain("frame-ancestors 'self'");
  });
});
