import { avisarSiBloqueo } from "./aviso-fuente";
import { aUtm, contiene, geometriaValida, utmAGeografica, type Geometria } from "./geo";
import { datosDeCapa, type Datos } from "./limpiar";

/**
 * Las dos consultas a IDECATQ, solo del servidor (el navegador no puede: IDECATQ no autoriza a otros sitios).
 * Límite de 12 s por consulta y sin reintento automático, para no cargar al servidor del gobierno.
 * Nunca se escribe en los registros lo que responde IDECATQ: solo el tipo de falla.
 */

const BASE = "https://catastroedo.queretaro.gob.mx";
export const LIMITE_MS = 12_000;
/** Predios urbanos (`M01_PA`…`M18_PA`) y rústicos (`M01_PRA`…`M18_PRA`): los rústicos están en otra capa, con la misma
 *  clave de 15 dígitos y el mismo campo DGR_CVECAT. */
const capas = (tipo: "PA" | "PRA") => Array.from({ length: 18 }, (_, i) => `queretaro:M${String(i + 1).padStart(2, "0")}_${tipo}`).join(",");
export const CAPAS_URBANAS = capas("PA");
export const CAPAS_RUSTICAS = capas("PRA");
/** Las 36, para el mosaico de líneas del equipo (un solo mosaico, no cuesta un viaje más). */
export const CAPAS_DE_PREDIOS = `${CAPAS_URBANAS},${CAPAS_RUSTICAS}`;

export type PredioDeCapa = {
  clave: string | null;
  /** De la capa (`M06_PA` o `M06_PRA` → "06"), nunca del campo CVE_MUN (en condominios viene vacío). */
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

/** La dirección del GetFeatureInfo a 18 capas de predios en un punto: urbanas por omisión (también la usa humo:fuente). */
export function urlMapa(lat: number, lon: number, capas: string = CAPAS_URBANAS): string {
  const [x, y] = aUtm(lat, lon);
  const bbox = [x - 5, y - 5, x + 5, y + 5].map((v) => v.toFixed(2)).join(",");
  return `${BASE}/geoserver/queretaro/wms?service=WMS&version=1.1.1&request=GetFeatureInfo&layers=${capas}&query_layers=${capas}`
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

type Candidato = { f: { properties?: Record<string, unknown> }; municipio: string; utm: Geometria | null; contiene: boolean };

/** Un GetFeatureInfo a 18 capas: los predios cerca del punto, marcando cuál lo contiene de verdad. */
async function candidatos(lat: number, lon: number, capas: string, tipo: "PA" | "PRA"): Promise<Candidato[]> {
  const [x, y] = aUtm(lat, lon);
  const r = await fetch(urlMapa(lat, lon, capas), { cache: "no-store", signal: AbortSignal.timeout(LIMITE_MS) });
  if (!r.ok) {
    await avisarSiBloqueo("mapa", r.status);
    throw new Error(`HTTP${r.status}`);
  }
  const j = (await r.json()) as { features?: { id?: unknown; geometry?: unknown; properties?: Record<string, unknown> }[] };
  return (j.features ?? []).map((f) => {
    const capa = /^M(0[1-9]|1[0-8])_(PA|PRA)[.]/.exec(String(f.id ?? ""));
    if (!capa || capa[2] !== tipo) return null;
    const utm = geometriaValida(f.geometry);
    return { f, municipio: capa[1], utm, contiene: !!utm && contiene(utm, [x, y]) };
  }).filter((z) => z !== null);
}

/**
 * GetFeatureInfo en un punto, en dos pasos para no cargar de más a la fuente: primero las 18 capas urbanas (casi
 * todos los toques); las 18 rústicas solo si ningún urbano contiene el punto. Así no se pierde exactitud: un punto
 * dentro de un rústico pero a menos de 5 m de un urbano sigue dando el rústico. Si ninguno lo contiene, el primero
 * cercano (urbano antes que rústico), como antes.
 */
export async function consultarMapa(lat: number, lon: number): Promise<RespuestaMapa> {
  let urbanos: Candidato[];
  try {
    urbanos = await candidatos(lat, lon, CAPAS_URBANAS, "PA");
  } catch (e) {
    falla("mapa", e);
    return { ok: false };
  }
  let elegido = urbanos.find((z) => z.contiene);
  if (!elegido) {
    try {
      const rusticos = await candidatos(lat, lon, CAPAS_RUSTICAS, "PRA");
      elegido = rusticos.find((z) => z.contiene) ?? urbanos[0] ?? rusticos[0];
    } catch (e) {
      falla("mapa", e);
      if (!urbanos.length) return { ok: false };
      elegido = urbanos[0];
    }
  }
  if (!elegido) return { ok: true, predio: null };
  const clave = String(elegido.f.properties?.DGR_CVECAT ?? "").replace(/[^0-9]/g, "");
  return {
    ok: true,
    predio: {
      clave: /^(0[1-9]|1[0-8])[0-9]{13}$/.test(clave) ? clave : null,
      municipio: elegido.municipio,
      geometria: elegido.utm ? utmAGeografica(elegido.utm) : null,
      geometriaUtm: elegido.utm,
      datos: datosDeCapa(elegido.f.properties),
    },
  };
}

/**
 * El polígono de una clave, filtrado por la clave misma (CQL_FILTER), cuando el centroide del expediente cae en otro
 * predio (un predio con hueco: el centroide cae en el hueco). Caja de 6 × 6 km alrededor del centroide, con margen que
 * la cubre; urbanos y rústicos del municipio de la clave. Una sola consulta y solo en ese caso.
 */
export function urlPorClave(clave: string, [x, y]: [number, number]): string | null {
  if (!/^(0[1-9]|1[0-8])[0-9]{13}$/.test(clave) || !(x > 100000 && y > 2000000)) return null;
  const m = clave.slice(0, 2);
  const capas = `queretaro:M${m}_PA,queretaro:M${m}_PRA`;
  const filtro = encodeURIComponent(`DGR_CVECAT='${clave}';DGR_CVECAT='${clave}'`);
  const L = 3000;
  const bbox = [x - L, y - L, x + L, y + L].map((v) => v.toFixed(2)).join(",");
  return `${BASE}/geoserver/queretaro/wms?service=WMS&version=1.1.1&request=GetFeatureInfo&layers=${capas}&query_layers=${capas}`
    + `&srs=EPSG:32614&bbox=${bbox}&width=101&height=101&x=50&y=50&info_format=application/json&feature_count=5&buffer=51&CQL_FILTER=${filtro}`;
}

export async function consultarPorClave(clave: string, centro: [number, number]): Promise<RespuestaMapa> {
  const url = urlPorClave(clave, centro);
  if (!url) return { ok: true, predio: null };
  try {
    const r = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(LIMITE_MS) });
    if (!r.ok) {
      await avisarSiBloqueo("mapa", r.status);
      throw new Error(`HTTP${r.status}`);
    }
    const j = (await r.json()) as { features?: { id?: unknown; geometry?: unknown; properties?: Record<string, unknown> }[] };
    const f = (j.features ?? []).find((z) => String(z.properties?.DGR_CVECAT ?? "").replace(/[^0-9]/g, "") === clave);
    const capa = f ? /^M(0[1-9]|1[0-8])_(PA|PRA)[.]/.exec(String(f.id ?? "")) : null;
    const utm = f ? geometriaValida(f.geometry) : null;
    if (!f || !capa || !utm) return { ok: true, predio: null };
    return { ok: true, predio: { clave, municipio: capa[1], geometria: utmAGeografica(utm), geometriaUtm: utm, datos: datosDeCapa(f.properties) } };
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
    if (!r.ok) {
      await avisarSiBloqueo("expediente", r.status);
      throw new Error(`HTTP${r.status}`);
    }
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
    if (!r.ok) {
      await avisarSiBloqueo("folio", r.status);
      throw new Error(`HTTP${r.status}`);
    }
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
