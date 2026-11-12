import { esHostDeGoogle, puntoDeLigaGoogle } from "./busqueda";

/**
 * Liga corta de Google Maps (maps.app.goo.gl) → su ubicación. Solo del servidor: sigue las redirecciones a mano,
 * SOLO dentro de dominios de Google y por https, con 6 s en total y 5 saltos como máximo. Si la página final no trae
 * la ubicación en la dirección, se busca en su HTML (hasta 300 KB). No se guarda nada.
 */
const LIMITE_MS = 6_000;
const SALTOS = 5;

/** Lo que trae el HTML de una página de Maps: !3d…!4d…, center=lat%2Clng o @lat,lng. */
export function puntoDeHtml(html: string): { lat: number; lon: number } | null {
  const centro = html.match(/center=(-?[0-9]+[.][0-9]+)(?:%2C|,)(-?[0-9]+[.][0-9]+)/);
  for (const candidato of [html.match(/!3d-?[0-9]+[.][0-9]+!4d-?[0-9]+[.][0-9]+/)?.[0],
    centro ? `@${centro[1]},${centro[2]}` : null, html.match(/@-?[0-9]+[.][0-9]+,-?[0-9]+[.][0-9]+/)?.[0]]) {
    const p = candidato ? puntoDeLigaGoogle(`https://www.google.com/maps/${candidato}`) : null;
    if (p) return p;
  }
  return null;
}

export async function expandirLigaCorta(url: string, llamar: typeof fetch = fetch): Promise<{ lat: number; lon: number } | null> {
  const fin = Date.now() + LIMITE_MS;
  let actual = url;
  for (let salto = 0; salto <= SALTOS; salto++) {
    let u: URL;
    try {
      u = new URL(actual);
    } catch {
      return null;
    }
    if (u.protocol !== "https:" || !esHostDeGoogle(u.hostname)) return null;
    if (salto > 0) {
      const p = puntoDeLigaGoogle(actual);
      if (p) return p;
    }
    const resto = fin - Date.now();
    if (resto <= 0) return null;
    let r: Response;
    try {
      r = await llamar(actual, { redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(resto),
        headers: { "User-Agent": "Mozilla/5.0 (compatible; Tasa)", "Accept-Language": "es-MX" } });
    } catch {
      return null;
    }
    const destino = r.headers.get("location");
    if (destino && r.status >= 300 && r.status < 400) {
      actual = new URL(destino, actual).toString();
      continue;
    }
    if (!r.ok) return null;
    const html = (await r.text()).slice(0, 300_000);
    return puntoDeHtml(html);
  }
  return null;
}
