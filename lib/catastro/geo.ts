/**
 * Geometría del mapa catastral, sin dependencias: IDECATQ trabaja en UTM zona 14 norte (EPSG:32614) y el
 * mapa en latitud/longitud. Acepta Polygon y MultiPolygon (los condominios llegan como MultiPolygon).
 */

export type Punto = [number, number];
export type Geometria =
  | { type: "Polygon"; coordinates: Punto[][] }
  | { type: "MultiPolygon"; coordinates: Punto[][][] };

const A = 6378137, F = 1 / 298.257223563, K0 = 0.9996, E2 = F * (2 - F), EP2 = E2 / (1 - E2);
const LON0 = (-99 * Math.PI) / 180; // meridiano central de la zona 14

/** Latitud/longitud (WGS84) → UTM 14N [x, y] en metros. */
export function aUtm(lat: number, lon: number): Punto {
  const p = (lat * Math.PI) / 180, l = (lon * Math.PI) / 180;
  const N = A / Math.sqrt(1 - E2 * Math.sin(p) ** 2), T = Math.tan(p) ** 2, C = EP2 * Math.cos(p) ** 2, a = Math.cos(p) * (l - LON0);
  const M = A * ((1 - E2 / 4 - (3 * E2 ** 2) / 64 - (5 * E2 ** 3) / 256) * p - ((3 * E2) / 8 + (3 * E2 ** 2) / 32 + (45 * E2 ** 3) / 1024) * Math.sin(2 * p)
    + ((15 * E2 ** 2) / 256 + (45 * E2 ** 3) / 1024) * Math.sin(4 * p) - ((35 * E2 ** 3) / 3072) * Math.sin(6 * p));
  const x = K0 * N * (a + ((1 - T + C) * a ** 3) / 6 + ((5 - 18 * T + T ** 2 + 72 * C - 58 * EP2) * a ** 5) / 120) + 500000;
  const y = K0 * (M + N * Math.tan(p) * (a ** 2 / 2 + ((5 - T + 9 * C + 4 * C ** 2) * a ** 4) / 24 + ((61 - 58 * T + T ** 2 + 600 * C - 330 * EP2) * a ** 6) / 720));
  return [x, y];
}

/** UTM 14N [x, y] → [longitud, latitud] (orden GeoJSON). */
export function aLonLat(x: number, y: number): Punto {
  const e1 = (1 - Math.sqrt(1 - E2)) / (1 + Math.sqrt(1 - E2));
  const M = y / K0, mu = M / (A * (1 - E2 / 4 - (3 * E2 ** 2) / 64 - (5 * E2 ** 3) / 256));
  const p1 = mu + ((3 * e1) / 2 - (27 * e1 ** 3) / 32) * Math.sin(2 * mu) + ((21 * e1 ** 2) / 16 - (55 * e1 ** 4) / 32) * Math.sin(4 * mu)
    + ((151 * e1 ** 3) / 96) * Math.sin(6 * mu) + ((1097 * e1 ** 4) / 512) * Math.sin(8 * mu);
  const N1 = A / Math.sqrt(1 - E2 * Math.sin(p1) ** 2), T1 = Math.tan(p1) ** 2, C1 = EP2 * Math.cos(p1) ** 2;
  const R1 = (A * (1 - E2)) / (1 - E2 * Math.sin(p1) ** 2) ** 1.5, D = (x - 500000) / (N1 * K0);
  const lat = p1 - ((N1 * Math.tan(p1)) / R1) * (D ** 2 / 2 - ((5 + 3 * T1 + 10 * C1 - 4 * C1 ** 2 - 9 * EP2) * D ** 4) / 24
    + ((61 + 90 * T1 + 298 * C1 + 45 * T1 ** 2 - 252 * EP2 - 3 * C1 ** 2) * D ** 6) / 720);
  const lon = LON0 + (D - ((1 + 2 * T1 + C1) * D ** 3) / 6 + ((5 - 2 * C1 + 28 * T1 - 3 * C1 ** 2 + 8 * EP2 + 24 * T1 ** 2) * D ** 5) / 120) / Math.cos(p1);
  return [(lon * 180) / Math.PI, (lat * 180) / Math.PI];
}

const r6 = (n: number) => Math.round(n * 1e6) / 1e6;

/** Los anillos de cualquier geometría, como lista de polígonos (cada uno, su lista de anillos). */
function poligonos(g: Geometria): Punto[][][] {
  return g.type === "Polygon" ? [g.coordinates] : g.coordinates;
}

/** Valida y normaliza una geometría que llega de fuera; nulo si no es Polygon/MultiPolygon con números. */
export function geometriaValida(g: unknown): Geometria | null {
  if (!g || typeof g !== "object") return null;
  const { type, coordinates } = g as { type?: unknown; coordinates?: unknown };
  const esAnillo = (a: unknown) => Array.isArray(a) && a.length >= 4 && a.every((p) => Array.isArray(p) && p.length >= 2 && p.slice(0, 2).every((n) => Number.isFinite(n)));
  const esPoligono = (p: unknown) => Array.isArray(p) && p.length >= 1 && p.every(esAnillo);
  const limpiar = (p: Punto[][]) => p.map((anillo) => anillo.map(([x, y]) => [Number(x), Number(y)] as Punto));
  if (type === "Polygon" && esPoligono(coordinates)) return { type, coordinates: limpiar(coordinates as Punto[][]) };
  if (type === "MultiPolygon" && Array.isArray(coordinates) && coordinates.length >= 1 && coordinates.every(esPoligono)) {
    return { type, coordinates: (coordinates as Punto[][][]).map(limpiar) };
  }
  return null;
}

/** Pasa una geometría de UTM 14N a longitud/latitud (6 decimales, ~10 cm). */
export function utmAGeografica(g: Geometria): Geometria {
  const conv = (p: Punto[][]) => p.map((anillo) => anillo.map(([x, y]) => aLonLat(x, y).map(r6) as Punto));
  return g.type === "Polygon" ? { type: "Polygon", coordinates: conv(g.coordinates) } : { type: "MultiPolygon", coordinates: g.coordinates.map(conv) };
}

/** Área con signo de un anillo (fórmula del zapato). */
function areaAnillo(a: Punto[]): number {
  let s = 0;
  for (let i = 0, j = a.length - 1; i < a.length; j = i++) s += (a[j][0] + a[i][0]) * (a[j][1] - a[i][1]);
  return s / 2;
}

/**
 * Centroide de la geometría (para la liga de Maps): el del área de todos los polígonos juntos, restando huecos.
 * Si el área sale cero (polígono degenerado), el promedio de los vértices.
 */
export function centroide(g: Geometria): Punto {
  let ax = 0, ay = 0, at = 0, sx = 0, sy = 0, n = 0;
  for (const pol of poligonos(g)) {
    pol.forEach((anillo, i) => {
      const area = Math.abs(areaAnillo(anillo)) * (i === 0 ? 1 : -1);
      let cx = 0, cy = 0, a2 = 0;
      for (let k = 0, j = anillo.length - 1; k < anillo.length; j = k++) {
        const f = anillo[j][0] * anillo[k][1] - anillo[k][0] * anillo[j][1];
        cx += (anillo[j][0] + anillo[k][0]) * f;
        cy += (anillo[j][1] + anillo[k][1]) * f;
        a2 += f;
        sx += anillo[k][0];
        sy += anillo[k][1];
        n += 1;
      }
      if (a2 !== 0) {
        ax += (cx / (3 * a2)) * area;
        ay += (cy / (3 * a2)) * area;
        at += area;
      }
    });
  }
  return at > 0 ? [ax / at, ay / at] : [sx / n, sy / n];
}

/** [latMin, latMax, lonMin, lonMax] de una geometría en longitud/latitud. */
export function caja(g: Geometria): [number, number, number, number] {
  let lat0 = Infinity, lat1 = -Infinity, lon0 = Infinity, lon1 = -Infinity;
  for (const pol of poligonos(g)) for (const anillo of pol) for (const [lon, lat] of anillo) {
    lat0 = Math.min(lat0, lat); lat1 = Math.max(lat1, lat); lon0 = Math.min(lon0, lon); lon1 = Math.max(lon1, lon);
  }
  return [r6(lat0), r6(lat1), r6(lon0), r6(lon1)];
}

function dentroDeAnillo([x, y]: Punto, a: Punto[]): boolean {
  let dentro = false;
  for (let i = 0, j = a.length - 1; i < a.length; j = i++) {
    if (a[i][1] > y !== a[j][1] > y && x < ((a[j][0] - a[i][0]) * (y - a[i][1])) / (a[j][1] - a[i][1]) + a[i][0]) dentro = !dentro;
  }
  return dentro;
}

/** ¿El punto [lon, lat] cae dentro de la geometría (fuera de sus huecos)? */
export function contiene(g: Geometria, punto: Punto): boolean {
  return poligonos(g).some((pol) => dentroDeAnillo(punto, pol[0]) && !pol.slice(1).some((hueco) => dentroDeAnillo(punto, hueco)));
}

/** Liga de Google Maps a un punto. */
export function ligaMaps(lat: number, lon: number): string {
  return `https://www.google.com/maps/search/?api=1&query=${lat.toFixed(6)},${lon.toFixed(6)}`;
}

/** Liga al visor oficial de IDECATQ con la clave. */
export function ligaVisor(clave: string): string {
  return `https://catastroedo.queretaro.gob.mx/Qsig/?mun=${clave.slice(0, 2)}&clave=${clave}`;
}
