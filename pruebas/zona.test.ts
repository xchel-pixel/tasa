import { afterEach, describe, expect, test, vi } from "vitest";
import { dxfDeZona, lineasPredio } from "@/lib/catastro/dxf";
import { cajaDeZona, capasDeConstruccion, consultarZona, prediosDeZona, textoDeFalla, urlZona, type Caja } from "@/lib/catastro/zona";

/** DXF por zona (0098): rectángulo de hasta 500 m por lado, tres consultas en secuencia, solo clave, polígono y nivel. */

const ZONA: Caja = [350000, 2287000, 350200, 2287100];
const cuadro = (x: number, y: number, l: number) => ({ type: "Polygon", coordinates: [[[x, y], [x + l, y], [x + l, y + l], [x, y + l], [x, y]]] });
const json = (features: unknown[]) => new Response(JSON.stringify({ features }), { headers: { "content-type": "application/json" } });
const URBANOS = [
  { id: "M14_PA.1", geometry: cuadro(350010, 2287010, 20), properties: { DGR_CVECAT: "140100123619158", FOLIOINMB: 987654, CURT_1: "SECRETO" } },
  { id: "M14_PA.2", geometry: cuadro(351000, 2288000, 20), properties: { DGR_CVECAT: "140100123619159" } },
];
const RUSTICOS = [{ id: "M05_PRA.9", geometry: cuadro(350150, 2287050, 30), properties: { DGR_CVECAT: "050302201026043" } }];
const OBRAS = [{ id: "M14_CIA_N01.4", geometry: cuadro(350012, 2287012, 8), properties: { ORIGEN: "x" } },
  { id: "M14_CIA_N02.5", geometry: cuadro(350012, 2287012, 8), properties: {} }];

afterEach(() => vi.unstubAllGlobals());

describe("La zona", () => {
  test("hasta 500 m por lado (25 ha); ni más, ni de menos de 5 m, ni fuera de Querétaro", () => {
    expect(cajaDeZona(350500, 2287500, 350000, 2287000)).toEqual([350000, 2287000, 350500, 2287500]);
    expect(cajaDeZona(350000, 2287000, 350501, 2287100)).toBeNull();
    expect(cajaDeZona(350000, 2287000, 350004, 2287100)).toBeNull();
    expect(cajaDeZona(100000, 2287000, 100100, 2287100)).toBeNull();
    expect(cajaDeZona(Number.NaN, 2287000, 350100, 2287100)).toBeNull();
  });
  test("pedido fijo a la fuente con margen que cubre la zona y tope de 5,000 elementos", () => {
    const u = new URL(urlZona("queretaro:M14_PA", ZONA));
    expect(u.origin + u.pathname).toBe("https://catastroedo.queretaro.gob.mx/geoserver/queretaro/wms");
    expect(u.searchParams.get("bbox")).toBe("349998.00,2286948.00,350202.00,2287152.00");
    expect(u.searchParams.get("feature_count")).toBe("5000");
    expect(Number(u.searchParams.get("buffer"))).toBeGreaterThan(50);
  });
  test("construcciones solo de los municipios de la zona, sin los que tienen capa rota", () => {
    expect(capasDeConstruccion(["05", "14"])).toEqual({ capas: [1, 2, 3, 4, 5].map((n) => `queretaro:M14_CIA_N0${n}`).join(","), rotos: ["05"] });
  });
  test("de cada predio solo clave, municipio, tipo y polígono; los que no tocan la zona fuera", () => {
    const p = prediosDeZona(URBANOS, ZONA);
    expect(p.map((x) => x.clave)).toEqual(["140100123619158"]);
    expect(Object.keys(p[0]).sort()).toEqual(["anillos", "clave", "municipio", "rustico"]);
  });
});

describe("Las tres consultas", () => {
  test("en secuencia, nunca a la vez, con pausa; la tercera solo con las capas de los municipios encontrados", async () => {
    let activas = 0, maximo = 0;
    const urls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (u: string) => {
      activas += 1; maximo = Math.max(maximo, activas); urls.push(u);
      await new Promise((r) => setTimeout(r, 5));
      activas -= 1;
      return json(urls.length === 1 ? URBANOS : urls.length === 2 ? RUSTICOS : OBRAS);
    }));
    const t0 = Date.now();
    const r = await consultarZona(ZONA, 30);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(60);
    expect(maximo).toBe(1);
    expect(urls).toHaveLength(3);
    expect(new URL(urls[2]).searchParams.get("query_layers")).toBe([1, 2, 3, 4, 5].map((n) => `queretaro:M14_CIA_N0${n}`).join(","));
    expect(r).toMatchObject({ ok: true, rotos: ["05"] });
    if (r.ok) {
      expect(r.predios.map((p) => [p.clave, p.rustico])).toEqual([["140100123619158", false], ["050302201026043", true]]);
      expect(r.construcciones.map((c) => c.nivel)).toEqual([1, 2]);
    }
  });
  test("si una tarda más de 10 s o la fuente rechaza, se detiene ahí, sin reintentar", async () => {
    const f = vi.fn(async () => { throw Object.assign(new Error("t"), { name: "TimeoutError" }); });
    vi.stubGlobal("fetch", f);
    expect(await consultarZona(ZONA, 0)).toEqual({ ok: false, paso: 1, codigo: "paso_1_tiempo" });
    expect(f).toHaveBeenCalledTimes(1);
    let n = 0;
    const g = vi.fn(async () => (++n === 1 ? json(URBANOS) : new Response("no", { status: 429 })));
    vi.stubGlobal("fetch", g);
    expect(await consultarZona(ZONA, 0)).toEqual({ ok: false, paso: 2, codigo: "paso_2_http429" });
    expect(g).toHaveBeenCalledTimes(2);
    expect(textoDeFalla("paso_2_http429")).toMatch(/rechazó.*429.*no se cobró/);
    expect(textoDeFalla("paso_3_tiempo")).toMatch(/más de 10 s/);
  });
});

describe("DXF de la zona", () => {
  test("capas PREDIO, CONST_N1…, TEXTO con la clave de cada predio; nada más de la fuente; m2 sin ²", async () => {
    let n = 0;
    vi.stubGlobal("fetch", vi.fn(async () => json(++n === 1 ? URBANOS : n === 2 ? RUSTICOS : OBRAS)));
    const r = await consultarZona(ZONA, 0);
    if (!r.ok) throw new Error("zona");
    const dxf = dxfDeZona({ zona: ZONA, predios: r.predios, construcciones: r.construcciones, rotos: r.rotos, fecha: "2026-11-27T18:00:00Z" });
    const lineas = dxf.split(String.fromCharCode(13, 10));
    const capas = lineas.filter((_, i) => lineas[i - 2] === "LAYER" && lineas[i - 1] === "  2");
    expect(capas).toEqual(["0", "PREDIO", "CONST_N1", "CONST_N2", "TEXTO"]);
    expect(dxf).toContain("140100123619158");
    expect(dxf).toContain("050302201026043");
    expect(dxf).toContain("Predios: 2 (1 urbanos, 1 rústicos)");
    expect(dxf).toContain("Sin construcciones en la cartografía de los municipios 05");
    expect(dxf).not.toMatch(/987654|SECRETO|ORIGEN|catastroedo|IDECATQ/);
    expect(dxf).not.toContain("²");
  });
});

describe("Predios en varias partes, repetidos o con hueco", () => {
  const conHueco = { type: "Polygon", coordinates: [
    [[350100, 2287010], [350160, 2287010], [350160, 2287070], [350100, 2287070], [350100, 2287010]],
    [[350120, 2287030], [350140, 2287030], [350140, 2287050], [350120, 2287050], [350120, 2287030]]] };
  const features = [
    { id: "M14_PA.1", geometry: cuadro(350010, 2287010, 20), properties: { DGR_CVECAT: "140100123619158" } },
    // La misma parte otra vez (repetida tal cual): se descarta.
    { id: "M14_PA.7", geometry: cuadro(350010, 2287010, 20), properties: { DGR_CVECAT: "140100123619158" } },
    // Otra parte del mismo predio (otro elemento con la misma clave): se junta.
    { id: "M14_PA.8", geometry: cuadro(350040, 2287010, 5), properties: { DGR_CVECAT: "140100123619158" } },
    { id: "M14_PA.9", geometry: conHueco, properties: { DGR_CVECAT: "140100123619995" } },
  ];
  test("un predio por clave, sin partes repetidas; el aviso explica las líneas de más", () => {
    const p = prediosDeZona(features, ZONA);
    expect(p.map((x) => [x.clave, x.anillos.length])).toEqual([["140100123619158", 2], ["140100123619995", 1]]);
    expect(lineasPredio(p)).toBe("  2 predios en 4 líneas cerradas: 1 parte de más (predios en varias partes, con la misma clave) y 1 hueco interior (1 predio)");
    expect(lineasPredio(prediosDeZona([features[0]], ZONA))).toBeNull();
  });
  test("cada parte lleva la clave del predio en TEXTO", () => {
    const dxf = dxfDeZona({ zona: ZONA, predios: prediosDeZona(features, ZONA), construcciones: [], rotos: [], fecha: "2026-11-27T18:00:00Z" });
    expect(dxf.split("140100123619158").length - 1).toBe(2);
    expect(dxf.split("140100123619995").length - 1).toBe(1);
    expect(dxf).toContain("2 predios en 4 líneas cerradas");
  });
});
