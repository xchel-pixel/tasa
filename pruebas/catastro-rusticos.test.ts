import { afterEach, describe, expect, test, vi } from "vitest";
import { aUtm } from "@/lib/catastro/geo";
import { CAPAS_DE_PREDIOS, CAPAS_RUSTICAS, CAPAS_URBANAS, consultarMapa } from "@/lib/catastro/idecatq";
import { CAPAS_PREDIOS } from "@/lib/catastro/mosaicos";
import { limpiarExpediente, superficieTerreno } from "@/lib/catastro/limpiar";
import { seccionesDeFicha, unitarioLegible, unitariosCatastrales, valorLegible } from "@/lib/catastro/etiquetas";
import { SIN_DATO } from "@/lib/catastro/textos";
import type { Ficha } from "@/lib/catastro/servicio";

/**
 * Predios rústicos (nov-2026). Están en otra capa (M01_PRA…M18_PRA) con la misma clave de 15 dígitos; su expediente
 * trae la superficie de terreno en hectáreas y "ND" en calle, colonia y CP. Formas copiadas de respuestas reales
 * (140211165140013, 140303755346229), sin datos personales.
 */

const [x, y] = aUtm(20.6614, -100.5135);
const cuadro = (d: number, dx = 0) => ({
  type: "Polygon", coordinates: [[[x + dx - d, y - d], [x + dx + d, y - d], [x + dx + d, y + d], [x + dx - d, y + d], [x + dx - d, y - d]]],
});
const rustico = { id: "M14_PRA.fid-1", geometry: cuadro(400), properties: { DGR_CVECAT: "140211165140013", FOLIOINMB: 0, SHAPE_AREA: 727013.64 } };
const urbanoQueContiene = { id: "M14_PA.9", geometry: cuadro(5), properties: { DGR_CVECAT: "140100141090006" } };
// Urbano a 4 m del punto: sale en la consulta (caja de 10 m) pero no lo contiene.
const urbanoVecino = { id: "M14_PA.10", geometry: cuadro(2, 6), properties: { DGR_CVECAT: "140100141090007" } };

/** La fuente responde según las capas pedidas: urbanas o rústicas. */
function fuente(urbanos: unknown[], rusticos: unknown[]) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
    const capas = new URL(String(url)).searchParams.get("query_layers");
    return new Response(JSON.stringify({ features: capas === CAPAS_URBANAS ? urbanos : rusticos }), { status: 200 });
  });
}
const capasPedidas = (f: ReturnType<typeof fuente>) => f.mock.calls.map(([u]) => new URL(String(u)).searchParams.get("query_layers"));

afterEach(() => vi.restoreAllMocks());

describe("Capas de predios: urbanos y rústicos", () => {
  test("18 urbanas y 18 rústicas; el mosaico de líneas del equipo lleva las 36 en un solo viaje", () => {
    expect(CAPAS_URBANAS.split(",").every((c) => /^queretaro:M(0[1-9]|1[0-8])_PA$/.test(c))).toBe(true);
    expect(CAPAS_RUSTICAS.split(",").every((c) => /^queretaro:M(0[1-9]|1[0-8])_PRA$/.test(c))).toBe(true);
    expect(CAPAS_URBANAS.split(",")).toHaveLength(18);
    expect(CAPAS_RUSTICAS.split(",")).toHaveLength(18);
    expect(CAPAS_PREDIOS).toBe(CAPAS_DE_PREDIOS);
    expect(CAPAS_PREDIOS.split(",")).toHaveLength(36);
  });

  test("toque en zona urbana: UNA consulta, solo a las 18 urbanas", async () => {
    const f = fuente([urbanoQueContiene], [rustico]);
    const r = await consultarMapa(20.6614, -100.5135);
    expect(r.ok && r.predio?.clave).toBe("140100141090006");
    expect(capasPedidas(f)).toEqual([CAPAS_URBANAS]);
  });

  test("toque en un rústico: urbanas sin resultado → rústicas; clave, municipio y polígono como un urbano", async () => {
    const f = fuente([], [rustico]);
    const r = await consultarMapa(20.6614, -100.5135);
    expect(r.ok && r.predio?.clave).toBe("140211165140013");
    expect(r.ok && r.predio?.municipio).toBe("14");
    expect(r.ok && r.predio?.geometria?.type).toBe("Polygon");
    expect(capasPedidas(f)).toEqual([CAPAS_URBANAS, CAPAS_RUSTICAS]);
  });

  test("sin perder exactitud: dentro de un rústico pero a 4 m de un urbano, gana el rústico", async () => {
    fuente([urbanoVecino], [rustico]);
    const r = await consultarMapa(20.6614, -100.5135);
    expect(r.ok && r.predio?.clave).toBe("140211165140013");
  });

  test("si ninguno contiene el punto, el urbano cercano (como antes); sin nada, ningún predio", async () => {
    fuente([urbanoVecino], []);
    const r = await consultarMapa(20.6614, -100.5135);
    expect(r.ok && r.predio?.clave).toBe("140100141090007");
    vi.restoreAllMocks();
    fuente([], []);
    expect(await consultarMapa(20.6614, -100.5135)).toEqual({ ok: true, predio: null });
  });

  test("si falla la consulta de rústicos pero hubo un urbano cercano, se usa el urbano; si falla la urbana, falla", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const f = vi.spyOn(globalThis, "fetch").mockImplementation(async (url) =>
      new URL(String(url)).searchParams.get("query_layers") === CAPAS_URBANAS
        ? new Response(JSON.stringify({ features: [urbanoVecino] }), { status: 200 })
        : new Response("", { status: 500 }));
    const r = await consultarMapa(20.6614, -100.5135);
    expect(r.ok && r.predio?.clave).toBe("140100141090007");
    f.mockImplementation(async () => new Response("", { status: 500 }));
    expect(await consultarMapa(20.6614, -100.5135)).toEqual({ ok: false });
  });

  test("otras capas que no son de predios no cuentan", async () => {
    fuente([{ ...rustico, id: "M14_MA.3" }], [{ ...rustico, id: "M14_MA.3" }]);
    expect(await consultarMapa(20.6614, -100.5135)).toEqual({ ok: true, predio: null });
  });
});

describe("Expediente de un rústico", () => {
  const expediente = {
    ok: true, cantidad: 1,
    predio: {
      claveCatastral: "140211165140013", tipoPredio: "RUSTICO", estatus: "AC", areaTotalTerreno: "69.0976", areaTotalConstruccion: "0",
      superficie: "---", valorActTer: "11268436.61", valorActCon: "0", fechaValidez: "06/06/1995",
      seriesValor: [{ area: "690976", tipo: "000", areaCons: "0", serie: "T", areaT: "69.0976", factor: "1" }],
      ubicacion: { calle: "ND", tipoCalle: "ND", colonia: "ND", tipoColonia: "ND", codigoPostal: "ND", exterior: "---", interior: "---", letra: "---",
        localidad: "SANTO NIÑO DE PRAGA", municipio: "QUERETARO", estado: "QUERÉTARO" },
      centroide: { x: 341348.96, y: 2285615.47 },
    },
  };
  const ficha = () => ({ clave: "140211165140013", municipio: "14", campos: limpiarExpediente(expediente)!.datos } as unknown as Ficha);

  test("la superficie viene en hectáreas: se guarda en m² (y los urbanos no cambian)", () => {
    expect(superficieTerreno("69.0976", "RUSTICO")).toBe(690976);
    expect(superficieTerreno("4.95", "rustico")).toBe(49500);
    expect(superficieTerreno("160.00", "URBANO")).toBe(160);
    expect(superficieTerreno("---", "RUSTICO")).toBeNull();
    const { datos } = limpiarExpediente(expediente)!;
    expect(datos.sup_terreno).toBe(690976);
    expect(datos.tipo_predio).toBe("RUSTICO");
  });

  test("'ND' en calle, colonia y CP: 'Sin dato' (no vacío); la ubicación queda con localidad y municipio", () => {
    const { datos } = limpiarExpediente(expediente)!;
    expect(datos.ubicacion).toBe("SANTO NIÑO DE PRAGA, QUERETARO");
    expect([datos.calle, datos.colonia, datos.codigo_postal]).toEqual([SIN_DATO, SIN_DATO, SIN_DATO]);
    expect(datos.localidad).toBe("SANTO NIÑO DE PRAGA");
    const registro = seccionesDeFicha(ficha()).find((s) => s.id === "registro")!;
    expect(registro.filas).toContainEqual(["Colonia", SIN_DATO]);
    expect(registro.filas).toContainEqual(["Código postal", SIN_DATO]);
    // Con la dirección completa no cambia; sin ella, la armada con las partes no mete "Sin dato" a media frase.
    expect(seccionesDeFicha(ficha()).find((s) => s.id === "ubicacion")!.filas).toEqual([["Dirección", "SANTO NIÑO DE PRAGA, QUERETARO"]]);
    const sinDireccion = { ...ficha(), campos: { ...ficha().campos, ubicacion: undefined } } as unknown as Ficha;
    expect(seccionesDeFicha(sinDireccion).find((s) => s.id === "ubicacion")!.filas).toEqual([["Dirección", SIN_DATO]]);
  });

  test("superficie: hectáreas con 4 decimales y su equivalente en m²; los urbanos, solo m²", () => {
    const sup = seccionesDeFicha(ficha()).find((s) => s.id === "superficies")!;
    expect(sup.filas).toContainEqual(["Superficie de terreno (catastro)", "69.0976 ha (690,976.00 m²)"]);
    expect(valorLegible("sup_terreno", 160)).toBe("160.00 m²");
    expect(valorLegible("sup_terreno", 74235.04)).toBe("74,235.04 m²");
  });

  test("valor unitario de terreno en $/m² y $/ha (del valor, sin arrastrar el redondeo); los urbanos solo $/m²", () => {
    const { datos } = limpiarExpediente(expediente)!;
    // 11,268,436.61 ÷ 690,976 m² = 16.31 · ÷ 69.0976 ha = 163,080.00
    expect(unitariosCatastrales(datos as Record<string, unknown>).map(unitarioLegible)).toEqual(["$16.31/m² · $163,080.00/ha"]);
    expect(unitariosCatastrales({ valor_terreno: 1200000, sup_terreno: 300 }).map(unitarioLegible)).toEqual(["$4,000.00/m²"]);
    const valores = seccionesDeFicha(ficha()).find((s) => s.id === "valores")!;
    expect(valores.copiar).toContain("Valor unitario de terreno: $16.31/m² · $163,080.00/ha (calculado)");
  });
});
