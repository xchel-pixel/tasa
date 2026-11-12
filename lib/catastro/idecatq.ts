import { aUtm, contiene, geometriaValida, utmAGeografica, type Geometria } from "./geo";
import { datosDeCapa, type Datos } from "./limpiar";

/**
 * Las dos consultas a IDECATQ, solo del servidor (el navegador no puede: IDECATQ no autoriza a otros sitios).
 * Límite de 12 s por consulta y sin reintento automático, para no cargar al servidor del gobierno.
 * Nunca se escribe en los registros lo que responde IDECATQ: solo el tipo de falla.
 */

const BASE = "https://catastroedo.queretaro.gob.mx";
export const LIMITE_MS = 12_000;
const CAPAS = Array.from({ length: 18 }, (_, i) => `queretaro:M${String(i + 1).padStart(2, "0")}_PA`).join(",");

export type PredioDeCapa = {
  clave: string | null;
  /** De la capa (`M06_PA` → "06"), nunca del campo CVE_MUN (en condominios viene vacío). */
  municipio: string;
  geometria: Geometria | null;
  /** La misma, en UTM 14N tal como la entrega la fuente (sin redondear): para DXF y croquis. */
  geometriaUtm: Geometria | null;
  datos: Datos;
};

export type RespuestaMapa = { ok: true; predio: PredioDeCapa | null } | { ok: false };
export type RespuestaExpediente = { ok: true; json: unknown } | { ok: false };

function falla(servicio: string, e: unknown) {
  // Solo el nombre del error, nunca el contenido de la respuesta.
  console.warn(`IDECATQ ${servicio}: ${e instanceof Error ? e.name : "error"}`);
}

/** La dirección del GetFeatureInfo a las 18 capas en un punto (también la usa humo:fuente). */
export function urlMapa(lat: number, lon: number): string {
  const [x, y] = aUtm(lat, lon);
  const bbox = [x - 5, y - 5, x + 5, y + 5].map((v) => v.toFixed(2)).join(",");
  return `${BASE}/geoserver/queretaro/wms?service=WMS&version=1.1.1&request=GetFeatureInfo&layers=${CAPAS}&query_layers=${CAPAS}`
    + `&srs=EPSG:32614&bbox=${bbox}&width=101&height=101&x=50&y=50&info_format=application/json&feature_count=5`;
}

/** El pedido de BuscaDatos de una clave (también lo usa humo:fuente). */
export function pedidoExpediente(clave: string): { url: string; init: RequestInit } {
  return {
    url: `${BASE}/Qsig/BuscaDatos`,
    init: {
      method: "POST",
      cache: "no-store",
      headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" },
      body: new URLSearchParams({ cve: clave, op: "1" }),
    },
  };
}

/** GetFeatureInfo a las 18 capas de predios en un punto. Un solo viaje. */
export async function consultarMapa(lat: number, lon: number): Promise<RespuestaMapa> {
  const [x, y] = aUtm(lat, lon);
  const url = urlMapa(lat, lon);
  try {
    const r = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(LIMITE_MS) });
    if (!r.ok) throw new Error(`HTTP${r.status}`);
    const j = (await r.json()) as { features?: { id?: unknown; geometry?: unknown; properties?: Record<string, unknown> }[] };
    const features = (j.features ?? []).map((f) => {
      const capa = /^M(0[1-9]|1[0-8])_PA\./.exec(String(f.id ?? ""));
      const utm = geometriaValida(f.geometry);
      return capa ? { f, municipio: capa[1], utm } : null;
    }).filter((z) => z !== null);
    // El que de verdad contiene el punto; si ninguno, el primero.
    const elegido = features.find((z) => z.utm && contiene(z.utm, [x, y])) ?? features[0];
    if (!elegido) return { ok: true, predio: null };
    const clave = String(elegido.f.properties?.DGR_CVECAT ?? "").replace(/\D/g, "");
    return {
      ok: true,
      predio: {
        clave: /^(0[1-9]|1[0-8])\d{13}$/.test(clave) ? clave : null,
        municipio: elegido.municipio,
        geometria: elegido.utm ? utmAGeografica(elegido.utm) : null,
        geometriaUtm: elegido.utm,
        datos: datosDeCapa(elegido.f.properties),
      },
    };
  } catch (e) {
    falla("mapa", e);
    return { ok: false };
  }
}

/** BuscaDatos: el expediente completo de una clave. Falla si no trae el predio. */
export async function consultarExpediente(clave: string): Promise<RespuestaExpediente> {
  try {
    const { url, init } = pedidoExpediente(clave);
    const r = await fetch(url, { ...init, signal: AbortSignal.timeout(LIMITE_MS) });
    if (!r.ok) throw new Error(`HTTP${r.status}`);
    const json: unknown = await r.json();
    const predio = (json as { predio?: { claveCatastral?: unknown } } | null)?.predio;
    if (!predio || String(predio.claveCatastral ?? "").replace(/\D/g, "") !== clave) throw new Error("SinPredio");
    return { ok: true, json };
  } catch (e) {
    falla("expediente", e);
    return { ok: false };
  }
}

/**
 * Folio real → clave catastral (BuscaRPPC, la búsqueda por folio del visor público). La subdirección del Registro
 * Público ("ads": 14 Querétaro, 16 San Juan del Río, 1 Amealco, 4 Cadereyta, 9 Jalpan) es lo que cuenta; el municipio
 * no cambia el resultado. La respuesta trae propietario, colindancias y más: de ahí SOLO se toma la clave, lo demás se
 * descarta aquí mismo, sin guardarlo ni escribirlo en registros.
 */
export type RespuestaFolio = { ok: true; clave: string | null } | { ok: false };

export function folioDeRespuesta(json: unknown): RespuestaFolio {
  if (!json || typeof json !== "object") return { ok: false };
  const r = json as { ok?: unknown; clave_catastral?: unknown };
  const clave = String(r.clave_catastral ?? "").replace(/[^0-9]/g, "");
  return { ok: true, clave: r.ok === true && /^(0[1-9]|1[0-8])[0-9]{13}$/.test(clave) ? clave : null };
}

export async function buscarFolioReal(folio: string, subdireccion: string): Promise<RespuestaFolio> {
  try {
    const r = await fetch(`${BASE}/Qsig/BuscaRPPC`, {
      method: "POST",
      cache: "no-store",
      headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8", "X-Requested-With": "XMLHttpRequest" },
      body: new URLSearchParams({ folio, mun: subdireccion.padStart(2, "0"), ads: subdireccion }),
      signal: AbortSignal.timeout(LIMITE_MS),
    });
    if (!r.ok) throw new Error(`HTTP${r.status}`);
    const texto = await r.text();
    let json: unknown = null;
    try {
      json = JSON.parse(texto);
    } catch {
      throw new Error("NoJson");
    }
    return folioDeRespuesta(json);
  } catch (e) {
    falla("folio", e);
    return { ok: false };
  }
}
