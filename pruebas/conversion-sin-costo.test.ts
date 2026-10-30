import { describe, expect, test } from "vitest";
import { conversionSinCosto, type FilaSinCosto } from "@/lib/conversion-sin-costo";

const hoy = new Date("2026-10-30T12:00:00Z");
const hace = (dias: number) => new Date(hoy.getTime() - dias * 86_400_000).toISOString();

const filas: FilaSinCosto[] = [
  // Convertido: su avalúo ligado ya es trabajo.
  { aceptada_en: hace(40), convenio: "Notaría 4", comisionista: "Ana", ligada: { estado: "tramite", monto_honorarios: 4500 } },
  // Ligado, pero el avalúo sigue cotizado: no cuenta como contratado; más de 30 días.
  { aceptada_en: hace(35), convenio: "Notaría 4", comisionista: "Beto", ligada: { estado: "cotizada", monto_honorarios: null } },
  // Sin ligar, reciente: todavía no cuenta en "más de 30 días".
  { aceptada_en: hace(10), convenio: "Notaría 4", comisionista: "Ana", ligada: null },
  // Sin ligar y viejo, sin convenio ni comisionista.
  { aceptada_en: hace(31), convenio: null, comisionista: null, ligada: null },
];

describe("Sin costo → conversión", () => {
  test("total: cuántos, convertidos con su monto y más de 30 días sin ligar", () => {
    expect(conversionSinCosto(filas, hoy).total).toEqual({ clave: "Total", sinCosto: 4, convertidos: 1, monto: 4500, sinLigar30: 2 });
  });

  test("por convenio y por comisionista", () => {
    const r = conversionSinCosto(filas, hoy);
    expect(r.porConvenio).toEqual([
      { clave: "Notaría 4", sinCosto: 3, convertidos: 1, monto: 4500, sinLigar30: 1 },
      { clave: "Sin convenio", sinCosto: 1, convertidos: 0, monto: 0, sinLigar30: 1 },
    ]);
    expect(r.porComisionista.map((c) => [c.clave, c.sinCosto, c.convertidos, c.sinLigar30])).toEqual([
      ["Ana", 2, 1, 0],
      ["Beto", 1, 0, 1],
      ["Liga de equipo u organización", 1, 0, 1],
    ]);
  });

  test("sin trabajos sin costo, todo en cero", () => {
    expect(conversionSinCosto([], hoy).total).toEqual({ clave: "Total", sinCosto: 0, convertidos: 0, monto: 0, sinLigar30: 0 });
  });
});
