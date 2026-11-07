/**
 * La petición de un mosaico de líneas de predios, armada por completo en el servidor. Del navegador solo se acepta
 * el número de mosaico: zoom 17 a 20 y x/y enteros cuyo mosaico cae dentro de Querétaro, sin parámetros extra.
 * Host, capas (M01_PA…M18_PA), formato png, EPSG:3857 y 512×512 son fijos. Nulo = petición inválida (400).
 */

const FUENTE = "https://catastroedo.queretaro.gob.mx/geoserver/queretaro/wms";
export const CAPAS_PREDIOS = Array.from({ length: 18 }, (_, i) => `queretaro:M${String(i + 1).padStart(2, "0")}_PA`).join(",");
const R = 20037508.342789244; // medio mundo en EPSG:3857
// Querétaro, con holgura (la misma que para consultar un punto).
const QRO = { latMin: 20, latMax: 21.8, lonMin: -100.7, lonMax: -99 };

const lonDeX = (x: number, n: number) => (x / n) * 360 - 180;
const latDeY = (y: number, n: number) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI;

export function peticionDeMosaico(p: { z: string; x: string; y: string }, consulta: URLSearchParams): string | null {
  if ([...consulta.keys()].length) return null;
  const partes = [p.z, p.x, p.y.replace(/\.png$/, "")];
  if (!partes.every((v) => /^\d{1,7}$/.test(v))) return null;
  const [z, x, y] = partes.map(Number);
  if (z < 17 || z > 20) return null;
  const n = 2 ** z;
  if (x >= n || y >= n) return null;
  // El mosaico completo, dentro de Querétaro.
  const [lon0, lon1, lat0, lat1] = [lonDeX(x, n), lonDeX(x + 1, n), latDeY(y + 1, n), latDeY(y, n)];
  if (lon0 < QRO.lonMin || lon1 > QRO.lonMax || lat0 < QRO.latMin || lat1 > QRO.latMax) return null;
  const lado = (2 * R) / n;
  const bbox = [-R + x * lado, R - (y + 1) * lado, -R + (x + 1) * lado, R - y * lado].map((v) => v.toFixed(2)).join(",");
  return `${FUENTE}?service=WMS&version=1.1.1&request=GetMap&layers=${CAPAS_PREDIOS}&styles=&format=image/png&transparent=true`
    + `&srs=EPSG:3857&bbox=${bbox}&width=512&height=512`;
}
