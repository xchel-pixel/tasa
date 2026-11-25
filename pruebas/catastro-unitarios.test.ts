import { describe, expect, test } from "vitest";
import { seccionesDeFicha, unitarioLegible, unitariosCatastrales } from "@/lib/catastro/etiquetas";
import type { Ficha } from "@/lib/catastro/servicio";

// Valores unitarios calculados en "Valores catastrales": valor ÷ superficie, sin inventar desglose.
describe("Valores unitarios catastrales", () => {
  test("división normal (140100141090006): terreno y construcción promedio, 2 decimales y miles", () => {
    const u = unitariosCatastrales({ valor_terreno: 42455313.05, valor_construccion: 90158801.4, sup_terreno: "6198.87", sup_construccion: "14877.69" });
    expect(u.map((x) => [x.etiqueta, unitarioLegible(x)])).toEqual([
      ["Valor unitario de terreno", "$6,848.88/m²"],
      ["Valor unitario de construcción (promedio)", "$6,060.00/m²"],
    ]);
  });

  test("superficie en 0 o vacía: '—', no se divide", () => {
    const u = unitariosCatastrales({ valor_terreno: 500000, sup_terreno: 0, valor_construccion: 300000, sup_construccion: "" });
    expect(u.map(unitarioLegible)).toEqual(["—", "—"]);
  });

  test("baldío: sin unitario de construcción", () => {
    const u = unitariosCatastrales({ valor_terreno: 1200000, sup_terreno: 300, valor_construccion: 0, sup_construccion: 0 });
    expect(u.map((x) => x.etiqueta)).toEqual(["Valor unitario de terreno"]);
    expect(unitarioLegible(u[0])).toBe("$4,000.00/m²");
    expect(unitariosCatastrales({ valor_terreno: 1200000, sup_terreno: 300 })).toHaveLength(1);
  });

  test("solo el total: no se inventa el desglose", () => {
    expect(unitariosCatastrales({ valor_catastral_total: 3000000, sup_terreno: 200, sup_construccion: 150 })).toEqual([]);
  });

  test("condominio con valor de terreno = privativo + común: proporcional y privativo", () => {
    // 060100113059119 (datos guardados): 118,250 + 586,819.33 = 705,069.33.
    const u = unitariosCatastrales({
      valor_terreno: 705069.33, valor_terreno_privativo: 118250, valor_terreno_comun: 586819.33, sup_terreno: 149.0633,
      sup_terreno_privativa: 25, sup_terreno_comun: 124.0633, indiviso: 0.771522,
      valor_construccion: 1050481.33, valor_construccion_privativa: 983763.3, sup_construccion: 104.2, sup_construccion_privativa: 95.79,
    });
    expect(u.map((x) => [x.etiqueta, unitarioLegible(x)])).toEqual([
      ["Valor unitario de terreno proporcional (privativo + común)", "$4,730.00/m²"],
      ["Valor unitario de terreno privativo", "$4,730.00/m²"],
      ["Valor unitario de construcción privativa (promedio)", "$10,270.00/m²"],
    ]);
  });

  test("condominio donde el valor de terreno es solo el privativo: sin proporcional (sería falso)", () => {
    // 140100136031048: valor_terreno = privativo (1,710,000) aunque la superficie total incluye lo común.
    const u = unitariosCatastrales({
      valor_terreno: 1710000, valor_terreno_privativo: 1710000, valor_terreno_comun: 45698.1, sup_terreno: 276.49,
      sup_terreno_privativa: 180, indiviso: 1.5977, valor_construccion_privativa: 0, sup_construccion_privativa: 0,
    });
    expect(u.map((x) => [x.etiqueta, unitarioLegible(x)])).toEqual([["Valor unitario de terreno privativo", "$9,500.00/m²"]]);
  });

  test("la ficha los pone junto a su valor, marcados 'calculado', y se copian", () => {
    const ficha = {
      clave: "140100141090006", municipio: "14",
      campos: { valor_terreno: 42455313.05, valor_construccion: 90158801.4, valor_catastral_total: 132614114.45, sup_terreno: "6198.87", sup_construccion: "14877.69" },
    } as unknown as Ficha;
    const v = seccionesDeFicha(ficha).find((s) => s.id === "valores")!;
    expect(v.filas.map(([e]) => e)).toEqual(["Terreno", "Valor unitario de terreno", "Construcción", "Valor unitario de construcción (promedio)", "Total"]);
    expect(v.calculadas).toEqual([1, 3]);
    expect(v.copiar).toContain("Valor unitario de terreno: $6,848.88/m² (calculado)");
    expect(v.copiar).toContain("Terreno: $42,455,313.05");
  });

  test("si el rol no ve la superficie, no hay unitario", () => {
    expect(unitariosCatastrales({ valor_terreno: 42455313.05 }).map(unitarioLegible)).toEqual(["—"]);
  });
});
