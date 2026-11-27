/**
 * La petición de un mosaico de una capa del mapa, armada por completo en el servidor. Del navegador solo se acepta la
 * capa (de la lista fija de capas.ts) y el número de mosaico: zoom desde el mínimo de esa capa hasta 20 y x/y enteros
 * cuyo mosaico cae dentro de Querétaro, sin parámetros extra. Host, capas de la fuente, estilo de la fuente, formato
 * png, EPSG:3857 y 512×512 son fijos. Nulo = petición inválida (400).
 */

import { capaPorId, type Capa } from "./capas";

const FUENTE = "https://catastroedo.queretaro.gob.mx/geoserver/queretaro/wms";
const PREDIOS = capaPorId("predios")!;
// Urbanos y rústicos en un solo mosaico: las mismas capas que se consultan al tocar el mapa.
export const CAPAS_PREDIOS = PREDIOS.fuente;
const R = 20037508.342789244; // medio mundo en EPSG:3857
// Querétaro, con holgura (la misma que para consultar un punto).
const QRO = { latMin: 20, latMax: 21.8, lonMin: -100.7, lonMax: -99 };

/** Una semana en la caché de Vercel: la cartografía de la fuente cambia poco. */
export const CACHE_MOSAICO_S = 7 * 24 * 60 * 60;

const lonDeX = (x: number, n: number) => (x / n) * 360 - 180;
const latDeY = (y: number, n: number) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI;

export type Mosaico = { url: string; etiqueta: string };

/**
 * La petición a la fuente y su etiqueta de caché. La etiqueta (y la llave de la caché, que es la URL) solo lleva capa,
 * zoom y posición: nada de quién lo pidió.
 */
export function mosaicoDeCapa(capa: Capa, p: { z: string; x: string; y: string }, consulta: URLSearchParams): Mosaico | null {
  if ([...consulta.keys()].length) return null;
  const partes = [p.z, p.x, p.y.replace(/[.]png$/, "")];
  if (!partes.every((v) => /^[0-9]{1,7}$/.test(v))) return null;
  const [z, x, y] = partes.map(Number);
  if (z < capa.zoomMin || z > 20) return null;
  const n = 2 ** z;
  if (x >= n || y >= n) return null;
  // El mosaico completo, dentro de Querétaro.
  const [lon0, lon1, lat0, lat1] = [lonDeX(x, n), lonDeX(x + 1, n), latDeY(y + 1, n), latDeY(y, n)];
  if (lon0 < QRO.lonMin || lon1 > QRO.lonMax || lat0 < QRO.latMin || lat1 > QRO.latMax) return null;
  const lado = (2 * R) / n;
  const bbox = [-R + x * lado, R - (y + 1) * lado, -R + (x + 1) * lado, R - y * lado].map((v) => v.toFixed(2)).join(",");
  return {
    url: `${FUENTE}?service=WMS&version=1.1.1&request=GetMap&layers=${capa.fuente}&styles=&format=image/png&transparent=true`
      + `&srs=EPSG:3857&bbox=${bbox}&width=512&height=512`,
    etiqueta: `mosaico:${capa.id}:${z}:${x}:${y}`,
  };
}

/** Las líneas de predios (la ruta de siempre). */
export function peticionDeMosaico(p: { z: string; x: string; y: string }, consulta: URLSearchParams): string | null {
  return mosaicoDeCapa(PREDIOS, p, consulta)?.url ?? null;
}
