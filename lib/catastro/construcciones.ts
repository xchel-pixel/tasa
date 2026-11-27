import { avisarSiBloqueo } from "./aviso-fuente";
import { CONSTRUCCIONES_ROTAS } from "./capas";
import { contiene, geometriaValida, puntoInterior, type Geometria, type Punto } from "./geo";
import { LIMITE_MS } from "./idecatq";

/**
 * Las construcciones de un predio, para el DXF del equipo (admin_org y equipo; lo decide catastro_dxf() en la base).
 * La fuente no tiene WFS: se usa un solo GetFeatureInfo a las capas de construcción del municipio (CIA_N01…N05), con
 * la caja del predio y un margen (`buffer`) que la cubre toda. Se leen al momento y no se guardan.
 * De cada construcción solo se toma su polígono (UTM 14N, tal cual) y su nivel (de la capa): nada más de la fuente.
 * Una construcción es del predio si su punto interior cae dentro del polígono del predio.
 */

export type Construccion = { nivel: number; anillos: Punto[][][]; m2: number };

/** ok: las del predio (pueden ser cero). rota: la capa del municipio falla en la fuente. falla: no respondió. */
export type RespuestaConstrucciones = { estado: "ok"; construcciones: Construccion[] } | { estado: "rota" } | { estado: "falla" };

const BASE = "https://catastroedo.queretaro.gob.mx/geoserver/queretaro/wms";
const NIVELES = [1, 2, 3, 4, 5];
/** Píxeles de la imagen de consulta: el punto al centro y el margen hasta la orilla. */
const LADO_PX = 101;

const capasDe = (municipio: string) => NIVELES.map((n) => `M${municipio}_CIA_N0${n}`);

/** ¿Alguna capa de construcción del municipio está rota en la fuente? Entonces el DXF sale sin construcciones. */
export function construccionesRotas(municipio: string): boolean {
  return capasDe(municipio).some((c) => CONSTRUCCIONES_ROTAS.includes(c));
}

/** El GetFeatureInfo de las construcciones dentro de la caja [x0, y0, x1, y1] (UTM 14N) del predio. */
export function urlConstrucciones(municipio: string, [x0, y0, x1, y1]: [number, number, number, number]): string {
  const capas = capasDe(municipio).map((c) => `queretaro:${c}`).join(",");
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, l = Math.max(x1 - x0, y1 - y0) / 2 + 2;
  const bbox = [cx - l, cy - l, cx + l, cy + l].map((v) => v.toFixed(2)).join(",");
  const centro = (LADO_PX - 1) / 2;
  return `${BASE}?service=WMS&version=1.1.1&request=GetFeatureInfo&layers=${capas}&query_layers=${capas}&srs=EPSG:32614&bbox=${bbox}`
    + `&width=${LADO_PX}&height=${LADO_PX}&x=${centro}&y=${centro}&info_format=application/json&feature_count=2000&buffer=${centro + 1}`;
}

function areaAnillo(a: Punto[]): number {
  let s = 0;
  for (let i = 0, j = a.length - 1; i < a.length; j = i++) s += a[j][0] * a[i][1] - a[i][0] * a[j][1];
  return Math.abs(s / 2);
}

const sinCierre = (a: Punto[]) => {
  const [p, q] = [a[0], a[a.length - 1]];
  return a.length > 1 && p[0] === q[0] && p[1] === q[1] ? a.slice(0, -1) : a;
};

/** De la respuesta de la fuente, solo las construcciones dentro del predio, con su nivel, en orden por nivel. */
export function construccionesDelPredio(json: unknown, municipio: string, predioUtm: Geometria): Construccion[] {
  const features = (json as { features?: { id?: unknown; geometry?: unknown }[] } | null)?.features ?? [];
  const salida: Construccion[] = [];
  for (const f of features) {
    const m = /^M([0-9]{2})_CIA_N0([1-5])[.]/.exec(String(f.id ?? ""));
    const g = geometriaValida(f.geometry);
    if (!m || m[1] !== municipio || !g) continue;
    if (!contiene(predioUtm, puntoInterior(g))) continue;
    const pols = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
    const anillos = pols.map((pol) => pol.map((a) => sinCierre(a.map(([x, y]) => [x, y] as Punto))));
    const m2 = anillos.reduce((t, pol) => t + pol.reduce((s, a, i) => s + areaAnillo(a) * (i === 0 ? 1 : -1), 0), 0);
    salida.push({ nivel: Number(m[2]), anillos, m2 });
  }
  return salida.sort((a, b) => a.nivel - b.nivel);
}

/** La caja UTM del predio. */
export function cajaUtm(g: Geometria): [number, number, number, number] {
  const pts = (g.type === "Polygon" ? [g.coordinates] : g.coordinates).flat(2);
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

/** Las construcciones del predio, de la fuente, al momento. Un solo pedido, 12 s, sin reintento. */
export async function consultarConstrucciones(municipio: string, predioUtm: Geometria): Promise<RespuestaConstrucciones> {
  if (!/^(0[1-9]|1[0-8])$/.test(municipio)) return { estado: "falla" };
  if (construccionesRotas(municipio)) return { estado: "rota" };
  try {
    const r = await fetch(urlConstrucciones(municipio, cajaUtm(predioUtm)), { cache: "no-store", signal: AbortSignal.timeout(LIMITE_MS) });
    if (!r.ok) {
      await avisarSiBloqueo("construcciones", r.status);
      throw new Error(`HTTP${r.status}`);
    }
    // La capa rota responde 200 con un error XML ("Internal error occurred"), no JSON.
    if (!(r.headers.get("content-type") ?? "").includes("json")) return { estado: "rota" };
    return { estado: "ok", construcciones: construccionesDelPredio(await r.json(), municipio, predioUtm) };
  } catch (e) {
    console.warn(`Construcciones: ${e instanceof Error ? e.name : "error"}`);
    return { estado: "falla" };
  }
}
