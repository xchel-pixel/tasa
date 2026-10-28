import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { FuentesPdf } from "@/lib/pdf-cotizacion";

/**
 * Las fuentes del PDF de cada marca, desde `assets/fuentes` (ver su
 * LEEME). Sin itálica: la regular la sustituye (Manrope no tiene, y la de
 * Adventor pesaría otros 170 KB en cada PDF).
 *
 * `subconjunto`: Manrope (TrueType) se recorta a las letras usadas. Adventor
 * (OpenType CFF) no: pdf-lib la recorta mal (pierde la "fi" y las
 * negritas), así que va completa.
 * `next.config.ts` incluye la carpeta en el paquete que sube a Vercel.
 */
export async function fuentesDe(tipografia: "adventor" | "manrope"): Promise<FuentesPdf> {
  const dir = join(process.cwd(), "assets", "fuentes");
  const leer = (archivo: string) => readFile(join(dir, archivo)).then((b) => new Uint8Array(b));
  if (tipografia === "manrope") {
    const [regular, negrita] = await Promise.all([leer("manrope-400.ttf"), leer("manrope-700.ttf")]);
    return { regular, negrita, italica: regular, subconjunto: true };
  }
  const [regular, negrita] = await Promise.all([leer("texgyreadventor-regular.otf"), leer("texgyreadventor-bold.otf")]);
  return { regular, negrita, italica: regular, subconjunto: false };
}
