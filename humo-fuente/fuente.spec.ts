import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";
import { LIMITE_MS, pedidoExpediente, urlMapa } from "../lib/catastro/idecatq";

/**
 * humo:fuente. Una sola consulta real a la fuente, de un predio fijo ya guardado en Tasa (HUMO_FUENTE_CLAVE; por
 * omisión 140100103039017): el mapa (GetFeatureInfo a las 18 capas, en el punto guardado del predio) y el
 * expediente (BuscaDatos). Reporta si responden, en cuánto tiempo y si cambió la FORMA de la respuesta contra
 * forma.json: campos nuevos (avisa) y faltantes (falla: el lector de Tasa podría dejar de llenar algo).
 *
 * Nunca imprime ni guarda valores: solo nombres de campos. Sin forma.json, la crea (línea base). Con
 * HUMO_FUENTE_ACTUALIZAR=1, la reemplaza con la forma de hoy (después de revisar el aviso de campos).
 */

const CLAVE = process.env.HUMO_FUENTE_CLAVE ?? "140100103039017";
const FORMA = join(import.meta.dirname, "forma.json");
const URL_SUPABASE = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SECRETA = process.env.SUPABASE_SECRET_KEY ?? "";

/** Las rutas de campos de un JSON ("predio.claveCatastral", "propietarios[].nombre"), sin valores, hasta 4 niveles. */
export function forma(x: unknown, prefijo = "", nivel = 0): string[] {
  if (nivel > 4 || x === null || typeof x !== "object") return [];
  if (Array.isArray(x)) {
    const hijos = new Set<string>();
    for (const e of x) for (const r of forma(e, `${prefijo}[]`, nivel + 1)) hijos.add(r);
    return [...hijos];
  }
  return Object.entries(x as Record<string, unknown>).flatMap(([k, v]) => {
    const ruta = prefijo ? `${prefijo}.${k}` : k;
    return [ruta, ...forma(v, ruta, nivel + 1)];
  });
}

async function medir(pedir: () => Promise<Response>): Promise<{ ms: number; json: unknown; error: string | null }> {
  const inicio = performance.now();
  try {
    const r = await pedir();
    const ms = Math.round(performance.now() - inicio);
    if (!r.ok) return { ms, json: null, error: `HTTP ${r.status}` };
    return { ms, json: await r.json(), error: null };
  } catch (e) {
    return { ms: Math.round(performance.now() - inicio), json: null, error: e instanceof Error ? e.name : "error" };
  }
}

test.skip(!SECRETA || !URL_SUPABASE, "Falta SUPABASE_SECRET_KEY (o la URL) en .env.local");

test(`humo:fuente — mapa y expediente de ${CLAVE}`, async () => {
  const db = createClient(URL_SUPABASE, SECRETA, { auth: { persistSession: false } });
  const { data: predio } = await db.from("catastro_predios").select("latitud, longitud").eq("clave", CLAVE).single();
  expect(predio?.latitud, `el predio ${CLAVE} debe estar guardado en Tasa con su punto`).toBeTruthy();

  const mapa = await medir(() => fetch(urlMapa(Number(predio!.latitud), Number(predio!.longitud)), { cache: "no-store", signal: AbortSignal.timeout(LIMITE_MS) }));
  const { url, init } = pedidoExpediente(CLAVE);
  const expediente = await medir(() => fetch(url, { ...init, signal: AbortSignal.timeout(LIMITE_MS) }));

  // Del mapa, solo el predio de la clave (las capas vecinas pueden variar).
  const features = ((mapa.json as { features?: { properties?: Record<string, unknown> }[] } | null)?.features ?? []);
  const delPredio = features.find((f) => String(f.properties?.DGR_CVECAT ?? "").replaceAll("-", "").replaceAll(".", "") === CLAVE) ?? features[0];
  const hoy = { mapa: delPredio ? forma(delPredio).sort() : [], expediente: forma(expediente.json).sort() };

  const informe: string[] = [
    `Mapa: ${mapa.error ? `NO responde (${mapa.error})` : "responde"} en ${mapa.ms} ms · ${features.length} predio(s) en el punto`,
    `Expediente: ${expediente.error ? `NO responde (${expediente.error})` : "responde"} en ${expediente.ms} ms`,
  ];

  let faltantes: string[] = [];
  if (!existsSync(FORMA) || process.env.HUMO_FUENTE_ACTUALIZAR === "1") {
    if (!mapa.error && !expediente.error) {
      writeFileSync(FORMA, JSON.stringify({ clave: CLAVE, actualizada: new Date().toISOString().slice(0, 10), ...hoy }, null, 1) + "\n");
      informe.push(`Forma: línea base guardada (${hoy.mapa.length} campos del mapa, ${hoy.expediente.length} del expediente)`);
    }
  } else if (!mapa.error && !expediente.error) {
    const base = JSON.parse(readFileSync(FORMA, "utf8")) as { mapa: string[]; expediente: string[] };
    for (const parte of ["mapa", "expediente"] as const) {
      const nuevos = hoy[parte].filter((c) => !base[parte].includes(c));
      const sin = base[parte].filter((c) => !hoy[parte].includes(c));
      faltantes = faltantes.concat(sin.map((c) => `${parte}: ${c}`));
      informe.push(`Forma del ${parte}: ${nuevos.length || sin.length ? `${nuevos.length} campo(s) nuevo(s)${nuevos.length ? ` (${nuevos.join(", ")})` : ""}, ${sin.length} faltante(s)${sin.length ? ` (${sin.join(", ")})` : ""}` : "igual"}`);
    }
  }

  console.log(["", ...informe].join("\n"));
  test.info().annotations.push(...informe.map((d) => ({ type: "fuente", description: d })));
  expect(mapa.error, "el mapa de la fuente responde").toBeNull();
  expect(expediente.error, "el expediente de la fuente responde").toBeNull();
  expect(faltantes, "campos que la fuente dejó de mandar").toEqual([]);
});
