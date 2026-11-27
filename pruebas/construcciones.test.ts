import { afterEach, describe, expect, test, vi } from "vitest";
import { consultarConstrucciones, construccionesDelPredio, construccionesRotas, urlConstrucciones } from "@/lib/catastro/construcciones";
import type { Geometria } from "@/lib/catastro/geo";

/** Construcciones para el DXF del equipo: un pedido fijo a la fuente, solo polígono y nivel, solo las del predio. */

const PREDIO: Geometria = { type: "Polygon", coordinates: [[[100, 100], [140, 100], [140, 130], [100, 130], [100, 100]]] };
const cuadro = (x: number, y: number, l: number) => ({ type: "Polygon", coordinates: [[[x, y], [x + l, y], [x + l, y + l], [x, y + l], [x, y]]] });

afterEach(() => vi.unstubAllGlobals());

describe("Construcciones del predio", () => {
  test("pedido fijo: host, las 5 capas de construcción del municipio, la caja del predio y un margen que la cubre", () => {
    const u = new URL(urlConstrucciones("14", [100, 100, 140, 130]));
    expect(u.origin + u.pathname).toBe("https://catastroedo.queretaro.gob.mx/geoserver/queretaro/wms");
    expect(u.searchParams.get("request")).toBe("GetFeatureInfo");
    expect(u.searchParams.get("query_layers")).toBe([1, 2, 3, 4, 5].map((n) => `queretaro:M14_CIA_N0${n}`).join(","));
    expect(u.searchParams.get("bbox")).toBe("98.00,93.00,142.00,137.00");
    expect(Number(u.searchParams.get("buffer"))).toBeGreaterThan((Number(u.searchParams.get("width")) - 1) / 2);
  });
  test("capas rotas en la fuente: Amealco, Cadereyta, Colón y Huimilpan salen sin construcciones (sin pedirlas)", async () => {
    expect(["01", "04", "05", "08"].every(construccionesRotas)).toBe(true);
    expect(construccionesRotas("14")).toBe(false);
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    expect(await consultarConstrucciones("04", PREDIO)).toEqual({ estado: "rota" });
    expect(f).not.toHaveBeenCalled();
  });
  test("solo las que caen dentro del predio, del municipio pedido; nivel de la capa; nada de los atributos", () => {
    const json = { features: [
      { id: "M14_CIA_N01.1", geometry: cuadro(105, 105, 10), properties: { DGR_CVECAT: "x", TCONSTR: "y" } },
      { id: "M14_CIA_N02.7", geometry: cuadro(120, 110, 5), properties: {} },
      { id: "M14_CIA_N01.2", geometry: cuadro(200, 200, 10), properties: {} },
      { id: "M06_CIA_N01.3", geometry: cuadro(105, 105, 10), properties: {} },
      { id: "M14_PA.9", geometry: cuadro(105, 105, 10), properties: {} },
    ] };
    const c = construccionesDelPredio(json, "14", PREDIO);
    expect(c.map((x) => [x.nivel, x.m2])).toEqual([[1, 100], [2, 25]]);
    expect(Object.keys(c[0]).sort()).toEqual(["anillos", "m2", "nivel"]);
  });
  test("la capa que falla responde XML: 'rota'; sin respuesta: 'falla'", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<ServiceExceptionReport/>", { headers: { "content-type": "application/vnd.ogc.se_xml" } })));
    expect(await consultarConstrucciones("14", PREDIO)).toEqual({ estado: "rota" });
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("timeout"); }));
    expect(await consultarConstrucciones("14", PREDIO)).toEqual({ estado: "falla" });
  });
});
