import { avisarSiBloqueo } from "./aviso-fuente";
import { CONSTRUCCIONES_ROTAS } from "./capas";
import type { Construccion } from "./construcciones";
import { geometriaValida, puntoInterior, type Geometria, type Punto } from "./geo";
import { CAPAS_RUSTICAS, CAPAS_URBANAS } from "./idecatq";

/**
 * Descarga por zona (0098): los predios y construcciones de un rectángulo de hasta 500 × 500 m, para un DXF.
 * La fuente no tiene WFS: tres GetFeatureInfo (urbanos, rústicos y construcciones) con la caja de la zona y un margen
 * que la cubre. Uno tras otro, nunca a la vez, con 1.5 s de pausa entre ellos. Si uno falla o tarda más de 10 s, se
 * detiene todo y no se reintenta. De la fuente solo se toman clave, polígono y nivel; nada más.
 */

export type Caja = [number, number, number, number];
export type PredioZona = { clave: string; municipio: string; rustico: boolean; anillos: Punto[][][] };
export type ResultadoZona =
  | { ok: true; predios: PredioZona[]; construcciones: Construccion[]; rotos: string[] }
  | { ok: false; paso: 1 | 2 | 3; codigo: string };

const BASE = "https://catastroedo.queretaro.gob.mx/geoserver/queretaro/wms";
export const LADO_MAX_M = 500;
export const LIMITE_ZONA_MS = 10_000;
export const PAUSA_MS = 1_500;
/** Más que esto en una consulta = la zona trae demasiado (o la fuente cortó la lista): se detiene. */
export const MAX_ELEMENTOS = 5_000;
const LADO_PX = 101;

/** La zona, ordenada; nula si no es un rectángulo válido de hasta 500 m por lado (y al menos 5 m). */
export function cajaDeZona(x0: number, y0: number, x1: number, y1: number): Caja | null {
  if (![x0, y0, x1, y1].every(Number.isFinite)) return null;
  const c: Caja = [Math.min(x0, x1), Math.min(y0, y1), Math.max(x0, x1), Math.max(y0, y1)];
  const [ancho, alto] = [c[2] - c[0], c[3] - c[1]];
  if (ancho < 5 || alto < 5 || ancho > LADO_MAX_M || alto > LADO_MAX_M) return null;
  if (c[0] < 250000 || c[2] > 480000 || c[1] < 2240000 || c[3] > 2400000) return null;
  return c;
}

/** El GetFeatureInfo de unas capas en toda la caja. */
export function urlZona(capas: string, [x0, y0, x1, y1]: Caja): string {
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, l = Math.max(x1 - x0, y1 - y0) / 2 + 2;
  const bbox = [cx - l, cy - l, cx + l, cy + l].map((v) => v.toFixed(2)).join(",");
  const centro = (LADO_PX - 1) / 2;
  return `${BASE}?service=WMS&version=1.1.1&request=GetFeatureInfo&layers=${capas}&query_layers=${capas}&srs=EPSG:32614&bbox=${bbox}`
    + `&width=${LADO_PX}&height=${LADO_PX}&x=${centro}&y=${centro}&info_format=application/json&feature_count=${MAX_ELEMENTOS}&buffer=${centro + 1}`;
}

type Feature = { id?: unknown; geometry?: unknown; properties?: Record<string, unknown> };

const sinCierre = (a: Punto[]) => {
  const [p, q] = [a[0], a[a.length - 1]];
  return a.length > 1 && p[0] === q[0] && p[1] === q[1] ? a.slice(0, -1) : a;
};
const anillosDe = (g: Geometria): Punto[][][] =>
  (g.type === "Polygon" ? [g.coordinates] : g.coordinates).map((pol) => pol.map((a) => sinCierre(a.map(([x, y]) => [x, y] as Punto))));

function areaAnillo(a: Punto[]): number {
  let s = 0;
  for (let i = 0, j = a.length - 1; i < a.length; j = i++) s += a[j][0] * a[i][1] - a[i][0] * a[j][1];
  return Math.abs(s / 2);
}

/** ¿La caja del polígono toca la zona? */
function tocaZona(anillos: Punto[][][], [x0, y0, x1, y1]: Caja): boolean {
  const pts = anillos.flat(2);
  return Math.max(...pts.map((p) => p[0])) >= x0 && Math.min(...pts.map((p) => p[0])) <= x1
    && Math.max(...pts.map((p) => p[1])) >= y0 && Math.min(...pts.map((p) => p[1])) <= y1;
}

const dentro = ([x, y]: Punto, [x0, y0, x1, y1]: Caja) => x >= x0 && x <= x1 && y >= y0 && y <= y1;

/** Los predios de una respuesta (urbanos o rústicos) que tocan la zona: clave, municipio de la capa y polígono. */
export function prediosDeZona(features: Feature[], zona: Caja): PredioZona[] {
  const salida: PredioZona[] = [];
  for (const f of features) {
    const m = /^M(0[1-9]|1[0-8])_(PA|PRA)[.]/.exec(String(f.id ?? ""));
    const g = geometriaValida(f.geometry);
    const clave = String(f.properties?.DGR_CVECAT ?? "").replace(/[^0-9]/g, "");
    if (!m || !g || !/^(0[1-9]|1[0-8])[0-9]{13}$/.test(clave)) continue;
    const anillos = anillosDe(g);
    if (tocaZona(anillos, zona)) salida.push({ clave, municipio: m[1], rustico: m[2] === "PRA", anillos });
  }
  return salida;
}

/** Las construcciones cuyo punto interior cae en la zona, con su nivel (de la capa). */
export function construccionesDeZona(features: Feature[], zona: Caja): Construccion[] {
  const salida: Construccion[] = [];
  for (const f of features) {
    const m = /^M(0[1-9]|1[0-8])_CIA_N0([1-5])[.]/.exec(String(f.id ?? ""));
    const g = geometriaValida(f.geometry);
    if (!m || !g || !dentro(puntoInterior(g), zona)) continue;
    const anillos = anillosDe(g);
    const m2 = anillos.reduce((t, pol) => t + pol.reduce((s, a, i) => s + areaAnillo(a) * (i === 0 ? 1 : -1), 0), 0);
    salida.push({ nivel: Number(m[2]), anillos, m2 });
  }
  return salida.sort((a, b) => a.nivel - b.nivel);
}

/** Las capas de construcción de los municipios de la zona, sin las que fallan en la fuente (una rota tumba la consulta). */
export function capasDeConstruccion(municipios: string[]): { capas: string; rotos: string[] } {
  const rotos = municipios.filter((m) => [1, 2, 3, 4, 5].some((n) => CONSTRUCCIONES_ROTAS.includes(`M${m}_CIA_N0${n}`)));
  const capas = municipios.filter((m) => !rotos.includes(m)).flatMap((m) => [1, 2, 3, 4, 5].map((n) => `queretaro:M${m}_CIA_N0${n}`));
  return { capas: capas.join(","), rotos };
}

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Una consulta: sus elementos, o el código de la falla ("paso_2_tiempo", "paso_1_http429", …). */
async function consulta(paso: 1 | 2 | 3, capas: string, zona: Caja): Promise<Feature[] | { codigo: string }> {
  try {
    const r = await fetch(urlZona(capas, zona), { cache: "no-store", signal: AbortSignal.timeout(LIMITE_ZONA_MS) });
    if (!r.ok) {
      await avisarSiBloqueo("zona", r.status);
      return { codigo: `paso_${paso}_http${r.status}` };
    }
    if (!(r.headers.get("content-type") ?? "").includes("json")) return { codigo: `paso_${paso}_formato` };
    const j = (await r.json()) as { features?: Feature[] };
    const features = j.features ?? [];
    if (features.length >= MAX_ELEMENTOS) return { codigo: `paso_${paso}_demasiados` };
    return features;
  } catch (e) {
    const nombre = e instanceof Error ? e.name : "";
    return { codigo: `paso_${paso}_${nombre === "TimeoutError" || nombre === "AbortError" ? "tiempo" : "red"}` };
  }
}

/** Las tres consultas en secuencia. `pausa` se puede acortar en pruebas. */
export async function consultarZona(zona: Caja, pausa = PAUSA_MS): Promise<ResultadoZona> {
  const urbanos = await consulta(1, CAPAS_URBANAS, zona);
  if (!Array.isArray(urbanos)) return { ok: false, paso: 1, codigo: urbanos.codigo };
  await esperar(pausa);
  const rusticos = await consulta(2, CAPAS_RUSTICAS, zona);
  if (!Array.isArray(rusticos)) return { ok: false, paso: 2, codigo: rusticos.codigo };
  const predios = [...prediosDeZona(urbanos, zona), ...prediosDeZona(rusticos, zona)];
  const municipios = [...new Set(predios.map((p) => p.municipio))].sort();
  const { capas, rotos } = capasDeConstruccion(municipios);
  if (!capas) return { ok: true, predios, construcciones: [], rotos };
  await esperar(pausa);
  const obras = await consulta(3, capas, zona);
  if (!Array.isArray(obras)) return { ok: false, paso: 3, codigo: obras.codigo };
  return { ok: true, predios, construcciones: construccionesDeZona(obras, zona), rotos };
}

/** El aviso de una falla, en palabras (la pantalla lo muestra tal cual). */
export function textoDeFalla(codigo: string): string {
  const paso = codigo.startsWith("paso_1") ? "los predios urbanos" : codigo.startsWith("paso_2") ? "los predios rústicos" : "las construcciones";
  if (codigo.endsWith("tiempo")) return `La fuente tardó más de 10 s en responder ${paso}. Se detuvo la descarga y no se cobró. Intenta más tarde.`;
  if (codigo.endsWith("http403") || codigo.endsWith("http429")) {
    return `La fuente rechazó la consulta de ${paso} (${codigo.slice(-3)}). Se detuvo la descarga y no se cobró. Puede que nos estén limitando: espera antes de intentar otra vez.`;
  }
  if (codigo.endsWith("demasiados")) return `La zona trae demasiados elementos en ${paso}. Dibuja una zona más chica.`;
  return `La fuente no respondió bien al pedir ${paso}. Se detuvo la descarga y no se cobró. Intenta más tarde.`;
}
