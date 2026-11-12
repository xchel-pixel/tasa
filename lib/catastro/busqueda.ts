import { aLonLat } from "./geo";

/**
 * Una sola caja de búsqueda en el Mapa catastral: el tipo se reconoce por la forma y el largo de lo escrito.
 *   · clave catastral: 15 dígitos que empiezan con el municipio (01 a 18);
 *   · coordenadas: decimales ("20.5888, -100.3899"), grados-minutos-segundos o UTM zona 14N ("355000, 2277000");
 *   · liga de Google Maps: larga (@lat,lng · q= · !3d!4d) o corta (maps.app.goo.gl, se abre en el servidor);
 *   · folio real: solo dígitos, de 1 a 10 (no es clave);
 *   · domicilio: lo demás, con letras.
 * Sin expresiones con diagonales invertidas (ver pruebas/expresiones.test.ts): las clases van como [0-9] y [.].
 */

export type Busqueda =
  | { tipo: "vacio" }
  | { tipo: "clave"; clave: string }
  | { tipo: "clave_invalida" }
  | { tipo: "coordenadas"; lat: number; lon: number; forma: "decimal" | "gms" | "utm" }
  | { tipo: "liga_google"; lat: number; lon: number }
  | { tipo: "liga_corta"; url: string }
  | { tipo: "liga_sin_punto" }
  | { tipo: "folio"; folio: string }
  | { tipo: "domicilio"; texto: string };

/** Para el registro de uso (eventos_uso.codigo): qué se buscó, nunca el texto. */
export type TipoDeBusqueda = "clave" | "coordenadas" | "liga_google" | "domicilio" | "folio";

/** Querétaro, con holgura (igual que el servidor). */
export function enQueretaro(lat: number, lon: number): boolean {
  return lat > 20 && lat < 21.8 && lon > -100.7 && lon < -99;
}

/** Hosts de Google que pueden traer una ubicación (y los únicos a los que el servidor sigue una liga corta). */
const HOSTS_GOOGLE = ["maps.app.goo.gl", "goo.gl", "g.co", "google.com", "www.google.com", "maps.google.com", "google.com.mx",
  "www.google.com.mx", "maps.google.com.mx", "consent.google.com"];

export function esHostDeGoogle(host: string): boolean {
  return HOSTS_GOOGLE.includes(host.toLowerCase());
}

const NUMERO = "-?[0-9]+(?:[.][0-9]+)?";

/** Las dos cifras decimales de un texto ("20.5888, -100.3899" o "20.5888 -100.3899"). */
function dosNumeros(texto: string): [number, number] | null {
  const m = texto.trim().match(new RegExp(`^(${NUMERO})[ ]*[, ;][ ]*(${NUMERO})$`));
  return m ? [Number(m[1]), Number(m[2])] : null;
}

/** Latitud y longitud de un par en cualquier orden; en México la longitud es oeste (negativa). */
function comoLatLon(a: number, b: number): { lat: number; lon: number } | null {
  for (const [lat, lon0] of [[a, b], [b, a]]) {
    const lon = lon0 > 0 && lon0 > 85 && lon0 < 120 ? -lon0 : lon0;
    if (Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && Math.abs(lat) < 35 && lon < -85) return { lat, lon };
  }
  return null;
}

/** UTM zona 14N de Querétaro: x entre 250 000 y 500 000, y entre 2 200 000 y 2 450 000 (en cualquier orden). */
function comoUtm(a: number, b: number): { lat: number; lon: number } | null {
  for (const [x, y] of [[a, b], [b, a]]) {
    if (x >= 250_000 && x <= 500_000 && y >= 2_200_000 && y <= 2_450_000) {
      const [lon, lat] = aLonLat(x, y);
      return { lat: Math.round(lat * 1e6) / 1e6, lon: Math.round(lon * 1e6) / 1e6 };
    }
  }
  return null;
}

/** 20°35'19.7"N 100°23'23.6"W (también con º, ′ ″, espacios o sin segundos). */
function comoGms(texto: string): { lat: number; lon: number } | null {
  const limpio = texto.toUpperCase().replaceAll("º", "°").replaceAll("′", "'").replaceAll("’", "'").replaceAll("″", "\"").replaceAll("''", "\"");
  const parte = "([0-9]{1,3})[ ]*°[ ]*([0-9]{1,2})?[ ]*'?[ ]*([0-9]{1,2}(?:[.][0-9]+)?)?[ ]*\"?[ ]*([NSEWO])";
  const m = limpio.match(new RegExp(`^${parte}[ ,;]*${parte}$`));
  if (!m) return null;
  const valor = (g: string, mi?: string, s?: string, h?: string) => {
    const v = Number(g) + Number(mi ?? 0) / 60 + Number(s ?? 0) / 3600;
    return h === "S" || h === "W" || h === "O" ? -v : v;
  };
  const uno = { v: valor(m[1], m[2], m[3], m[4]), h: m[4] };
  const dos = { v: valor(m[5], m[6], m[7], m[8]), h: m[8] };
  const esLat = (h: string) => h === "N" || h === "S";
  if (esLat(uno.h) && !esLat(dos.h)) return { lat: uno.v, lon: dos.v };
  if (!esLat(uno.h) && esLat(dos.h)) return { lat: dos.v, lon: uno.v };
  return null;
}

/** La ubicación que trae una liga larga de Google Maps: primero !3d!4d (el lugar), luego q=/query=/ll=, luego @ (la vista). */
export function puntoDeLigaGoogle(url: string): { lat: number; lon: number } | null {
  let texto = url;
  try {
    texto = decodeURIComponent(url);
  } catch {
    // Liga a medias: se lee como viene.
  }
  const lugar = texto.match(new RegExp(`!3d(${NUMERO})!4d(${NUMERO})`));
  if (lugar) return comoLatLon(Number(lugar[1]), Number(lugar[2]));
  const parametro = texto.match(new RegExp(`[?&](?:q|query|ll|center|destination)=(${NUMERO})[ ]*,[ +]*(${NUMERO})`));
  if (parametro) return comoLatLon(Number(parametro[1]), Number(parametro[2]));
  const vista = texto.match(new RegExp(`@(${NUMERO}),(${NUMERO})`));
  if (vista) return comoLatLon(Number(vista[1]), Number(vista[2]));
  // consent.google.com?continue=<la liga de verdad>
  const sigue = texto.match(/[?&]continue=([^&]+)/);
  return sigue && sigue[1] !== url ? puntoDeLigaGoogle(sigue[1]) : null;
}

export function detectarBusqueda(entrada: string): Busqueda {
  const texto = (entrada ?? "").trim();
  if (!texto) return { tipo: "vacio" };

  // Ligas.
  if (/^(https?:[/][/])?[a-z0-9.-]+[.][a-z]{2,}[/]/i.test(texto) || texto.toLowerCase().startsWith("http")) {
    let url: URL | null = null;
    try {
      url = new URL(texto.startsWith("http") ? texto : `https://${texto}`);
    } catch {
      url = null;
    }
    if (url && esHostDeGoogle(url.hostname)) {
      const p = puntoDeLigaGoogle(url.toString());
      if (p) return { tipo: "liga_google", ...p };
      if (["maps.app.goo.gl", "goo.gl", "g.co"].includes(url.hostname.toLowerCase())) return { tipo: "liga_corta", url: url.toString() };
      return { tipo: "liga_sin_punto" };
    }
  }

  // Coordenadas (antes que los dígitos: "355000 2277000" también es solo números).
  const par = dosNumeros(texto);
  if (par) {
    const utm = comoUtm(par[0], par[1]);
    if (utm) return { tipo: "coordenadas", ...utm, forma: "utm" };
    const ll = comoLatLon(par[0], par[1]);
    if (ll) return { tipo: "coordenadas", ...ll, forma: "decimal" };
  }
  const gms = comoGms(texto);
  if (gms) return { tipo: "coordenadas", ...gms, forma: "gms" };

  // Solo dígitos (con separadores): clave de 15 o folio real.
  const digitos = texto.replace(/[^0-9]/g, "");
  if (/^[0-9 .-]+$/.test(texto)) {
    if (digitos.length === 15) return /^(0[1-9]|1[0-8])/.test(digitos) ? { tipo: "clave", clave: digitos } : { tipo: "clave_invalida" };
    if (digitos.length >= 1 && digitos.length <= 10 && /^[0-9]+$/.test(texto)) return { tipo: "folio", folio: String(Number(digitos)) };
    return { tipo: "clave_invalida" };
  }
  // "Folio 489527" o "folio real: 489527".
  const folio = texto.match(/^folio( real)?[ :#.]*([0-9]{1,10})$/i);
  if (folio) return { tipo: "folio", folio: String(Number(folio[2])) };

  // Domicilio: con al menos tres letras.
  return /[a-záéíóúñü].*[a-záéíóúñü].*[a-záéíóúñü]/i.test(texto) ? { tipo: "domicilio", texto } : { tipo: "clave_invalida" };
}

/** Lo que se le dice a la persona mientras escribe (sin nombrar ninguna fuente). */
export function textoDelTipo(b: Busqueda): string | null {
  switch (b.tipo) {
    case "clave": return "Clave catastral";
    case "coordenadas": return b.forma === "utm" ? "Coordenadas UTM (zona 14N)" : "Coordenadas";
    case "liga_google":
    case "liga_corta": return "Liga de Google Maps";
    case "folio": return "Folio real";
    case "domicilio": return "Domicilio";
    default: return null;
  }
}

/** Subdirecciones del Registro Público y su número en la fuente. Querétaro por omisión. */
export const SUBDIRECCIONES = [
  { clave: "14", nombre: "Querétaro" },
  { clave: "16", nombre: "San Juan del Río" },
  { clave: "1", nombre: "Amealco" },
  { clave: "4", nombre: "Cadereyta" },
  { clave: "9", nombre: "Jalpan" },
] as const;

export function nombreSubdireccion(clave: string): string {
  return SUBDIRECCIONES.find((s) => s.clave === clave)?.nombre ?? "Querétaro";
}
