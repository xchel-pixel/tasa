import { describe, expect, test } from "vitest";
import { aLonLat, aUtm, utmAGeografica, type Geometria, type Punto } from "@/lib/catastro/geo";
import { anillosDe, anillosUtm, bytesDxf, dxfDePredio, superficieUtm } from "@/lib/catastro/dxf";

/**
 * DXF del mapa catastral: coordenadas UTM 14N iguales al polígono guardado (Polygon, MultiPolygon y con hueco),
 * capas pedidas, nada prohibido y un archivo que un lector DXF recorre sin errores.
 */

const r6 = (n: number) => Math.round(n * 1e6) / 1e6;
/** Un rectángulo en UTM, guardado como en Tasa (longitud/latitud a 6 decimales). */
const rect = (x: number, y: number, w: number, h: number, horario = false): Punto[] => {
  const p: Punto[] = [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
  const anillo = horario ? p.reverse() : p;
  return [...anillo, anillo[0]].map(([a, b]) => aLonLat(a, b).map(r6) as Punto);
};

const POLIGONO: Geometria = { type: "Polygon", coordinates: [rect(352000, 2280000, 20, 30)] };
const CON_HUECO: Geometria = { type: "Polygon", coordinates: [rect(352000, 2280000, 40, 40), rect(352010, 2280010, 10, 10, true)] };
const CONDOMINIO: Geometria = { type: "MultiPolygon", coordinates: [[rect(352000, 2280000, 12, 15)], [rect(352030, 2280000, 3, 5)]] };

/** Lector mínimo: pares código/valor, secciones, capas declaradas y entidades. Falla ante cualquier cosa rara. */
function leer(dxf: string) {
  const lineas = dxf.split("\r\n");
  expect(lineas.pop()).toBe("");
  expect(lineas.length % 2).toBe(0);
  const pares: [number, string][] = [];
  for (let i = 0; i < lineas.length; i += 2) {
    expect(lineas[i]).toMatch(/^ *-?\d{1,4}$/);
    pares.push([Number(lineas[i]), lineas[i + 1]]);
  }
  expect(pares.at(-1)).toEqual([0, "EOF"]);
  const capas = new Set<string>();
  const entidades: { tipo: string; g: Map<number, string[]> }[] = [];
  let seccion = "";
  let actual: { tipo: string; g: Map<number, string[]> } | null = null;
  for (const [c, v] of pares) {
    if (c === 0) {
      if (v === "SECTION" || v === "ENDSEC" || v === "EOF") { seccion = v === "SECTION" ? "?" : ""; actual = null; continue; }
      actual = { tipo: v, g: new Map() };
      if (seccion === "ENTITIES") entidades.push(actual);
      continue;
    }
    if (c === 2 && seccion === "?") { seccion = v; continue; }
    if (actual) actual.g.set(c, [...(actual.g.get(c) ?? []), v]);
    if (seccion === "TABLES" && actual?.tipo === "LAYER" && c === 2) capas.add(v);
  }
  // Polilíneas bien cerradas: POLYLINE … VERTEX* … SEQEND.
  const anillos: Punto[][] = [];
  let abierta: Punto[] | null = null;
  for (const e of entidades) {
    expect(capas.has(e.g.get(8)?.[0] ?? "")).toBe(true);
    if (e.tipo === "POLYLINE") { expect(abierta).toBeNull(); expect(e.g.get(70)).toEqual(["1"]); abierta = []; }
    else if (e.tipo === "VERTEX") { expect(abierta).not.toBeNull(); abierta!.push([Number(e.g.get(10)![0]), Number(e.g.get(20)![0])]); }
    else if (e.tipo === "SEQEND") { anillos.push(abierta!); abierta = null; }
    else expect(e.tipo).toBe("TEXT");
  }
  expect(abierta).toBeNull();
  const textos = (capa: string) => entidades.filter((e) => e.tipo === "TEXT" && e.g.get(8)![0] === capa).map((e) => e.g.get(1)![0]);
  return { capas, entidades, anillos, textos };
}

describe("DXF del predio", () => {
  for (const [nombre, geo, anillosEsperados] of [["Polygon", POLIGONO, 1], ["con hueco", CON_HUECO, 2], ["MultiPolygon", CONDOMINIO, 2]] as const) {
    test(`${nombre}: las coordenadas son las del polígono guardado, en UTM y metros`, () => {
      const dxf = dxfDePredio({ clave: "149999990000001", geometria: geo, consultadoEn: "2026-11-09T18:00:00Z" });
      const { anillos } = leer(dxf);
      expect(anillos.length).toBe(anillosEsperados);
      // Cada vértice = el punto guardado (lon/lat) pasado a UTM 14N, al milímetro; sin repetir el de cierre.
      const guardados = (geo.type === "Polygon" ? [geo.coordinates] : geo.coordinates).flat();
      anillos.forEach((anillo, i) => {
        const esperado = guardados[i].slice(0, -1).map(([lon, lat]) => aUtm(lat, lon));
        expect(anillo.length).toBe(esperado.length);
        anillo.forEach(([x, y], k) => {
          expect(Math.abs(x - esperado[k][0])).toBeLessThan(0.0006);
          expect(Math.abs(y - esperado[k][1])).toBeLessThan(0.0006);
        });
        // Metros UTM, no grados.
        expect(anillo[0][0]).toBeGreaterThan(300000);
        expect(anillo[0][1]).toBeGreaterThan(2000000);
      });
    });
  }

  test("capas, cotas, vértices y textos", () => {
    const dxf = dxfDePredio({ clave: "149999990000001", geometria: POLIGONO, consultadoEn: "2026-11-09T18:00:00Z" });
    const { capas, textos } = leer(dxf);
    expect([...capas].sort()).toEqual(["0", "COTAS", "PREDIO", "TEXTOS", "VERTICES"]);
    expect(textos("VERTICES")).toEqual(["1", "2", "3", "4"]);
    // Cada cota = el lado del polígono guardado en UTM. (El guardado en grados a 6 decimales ya se aleja
    // hasta ~10 cm del rectángulo de 20 × 30 original: eso viene del guardado, no del DXF.)
    const cotas = textos("COTAS").map(Number);
    const a = anillosUtm(POLIGONO)[0][0];
    expect(cotas).toEqual(a.map(([x, y], i) => Number(Math.hypot(a[(i + 1) % 4][0] - x, a[(i + 1) % 4][1] - y).toFixed(2))));
    [20, 30, 20, 30].forEach((m, i) => expect(Math.abs(cotas[i] - m)).toBeLessThan(0.15));
    textos("COTAS").forEach((t) => expect(t).toMatch(/^\d+\.\d{2}$/));
    const t = textos("TEXTOS");
    expect(t[0]).toBe("Clave catastral: 149999990000001");
    // La del polígono guardado (≈ 600 m² del rectángulo original, con el margen del guardado).
    expect(t[1]).toBe(`Superficie del polígono: ${superficieUtm(anillosUtm(POLIGONO)).toFixed(2)} m²`);
    expect(Math.abs(superficieUtm(anillosUtm(POLIGONO)) / 600 - 1)).toBeLessThan(0.005);
    expect(t[2]).toBe("Fecha de consulta: 09/11/2026");
    expect(t[3]).toBe("Información sin validez oficial");
  });

  test("superficie: partes suman y los huecos restan", () => {
    // 40×40 − 10×10 y 12×15 + 3×5, con el margen del guardado a 6 decimales (±0.5 %).
    expect(Math.abs(superficieUtm(anillosUtm(CON_HUECO)) / 1500 - 1)).toBeLessThan(0.005);
    expect(Math.abs(superficieUtm(anillosUtm(CONDOMINIO)) / 195 - 1)).toBeLessThan(0.005);
    // Sin el redondeo: exacto.
    const exacto = (x: number, y: number, w: number, h: number, horario = false): Punto[] => {
      const p: Punto[] = [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
      return horario ? p.reverse() : p;
    };
    expect(superficieUtm([[exacto(0, 0, 40, 40), exacto(10, 10, 10, 10, true)], [exacto(100, 0, 3, 5)]])).toBe(1515);
  });

  test("nada de propietario, operación ni de la fuente", () => {
    const dxf = dxfDePredio({ clave: "149999990000002", geometria: CONDOMINIO, consultadoEn: "2026-11-09T18:00:00Z" }).toLowerCase();
    for (const prohibido of ["propietari", "dueñ", "operaci", "escritura", "notari", "contrato", "idecatq", "qsig", "gob.mx",
      "catastroedo", "gobierno", "fuente", "999\r\n"]) {
      expect(dxf).not.toContain(prohibido);
    }
    // Sin comentarios (código 999) ni nada fuera de las 4 capas.
    expect(dxf).not.toMatch(/^ *999$/m);
  });

  test("Windows-1252: acentos y ² en un byte", () => {
    const b = bytesDxf(dxfDePredio({ clave: "149999990000001", geometria: POLIGONO, consultadoEn: "2026-11-09T18:00:00Z" }));
    expect(b.includes(Buffer.from([0xf3]))).toBe(true); // ó
    expect(b.includes(Buffer.from([0xb2]))).toBe(true); // ²
    expect(b.toString("latin1")).toContain("$DWGCODEPAGE\r\n  3\r\nANSI_1252");
  });
});

describe("Geometría UTM de la fuente (0066)", () => {
  // Como la entrega la fuente: UTM 14N con decimales sueltos.
  const FUENTE: Geometria = { type: "Polygon", coordinates: [[[352000.137, 2280000.482], [352020.137, 2280000.482], [352020.137, 2280030.482],
    [352000.137, 2280030.482], [352000.137, 2280000.482]]] };

  test("UTM → grados (9 decimales) → UTM: el mismo punto al milímetro, en todo Querétaro", () => {
    for (const [x, y] of [[352000.137, 2280000.482], [295000.5, 2235000.25], [470000.9, 2370000.1], [410123.456, 2301234.567]] as Punto[]) {
      const g = utmAGeografica({ type: "Polygon", coordinates: [[[x, y], [x + 1, y], [x, y + 1], [x, y]]] });
      const [lon, lat] = (g as { coordinates: Punto[][] }).coordinates[0][0];
      const [x2, y2] = aUtm(lat, lon);
      expect(Math.abs(x2 - x)).toBeLessThan(0.001);
      expect(Math.abs(y2 - y)).toBeLessThan(0.001);
    }
  });

  test("con geometria_utm, el DXF lleva exactamente las coordenadas de la fuente: 20.00 × 30.00 y 600.00 m²", () => {
    const dxf = dxfDePredio({ clave: "149999990000001", geometria: utmAGeografica(FUENTE), geometriaUtm: FUENTE, consultadoEn: "2026-11-09T18:00:00Z" });
    const { anillos, textos } = leer(dxf);
    expect(anillos).toEqual([(FUENTE as { coordinates: Punto[][] }).coordinates[0].slice(0, -1)]);
    expect(textos("COTAS")).toEqual(["20.00", "30.00", "20.00", "30.00"]);
    expect(textos("TEXTOS")[1]).toBe("Superficie del polígono: 600.00 m²");
  });

  test("sin geometria_utm (guardados antes), se convierte desde grados como hasta hoy", () => {
    expect(anillosDe({ geometria: POLIGONO, geometriaUtm: null })).toEqual(anillosUtm(POLIGONO));
  });

  test("condominio y hueco desde la fuente: partes y huecos tal cual", () => {
    const multi: Geometria = { type: "MultiPolygon", coordinates: [
      [[[0, 0], [40, 0], [40, 40], [0, 40], [0, 0]], [[10, 10], [10, 20], [20, 20], [20, 10], [10, 10]]],
      [[[100, 0], [103, 0], [103, 5], [100, 5], [100, 0]]]].map((p) => p.map((a) => a.map(([x, y]) => [352000 + x, 2280000 + y] as Punto))) };
    const { anillos, textos } = leer(dxfDePredio({ clave: "149999990000002", geometria: utmAGeografica(multi), geometriaUtm: multi, consultadoEn: "2026-11-09" }));
    expect(anillos.length).toBe(3);
    expect(textos("TEXTOS")[1]).toBe("Superficie del polígono: 1,515.00 m²");
  });
});
