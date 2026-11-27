import { revalidateTag } from "next/cache";
import { NextResponse, type NextRequest } from "next/server";
import { crearClienteServidor, encabezadoHumo } from "@/lib/supabase/server";
import { capaPorId } from "./capas";
import { CACHE_MOSAICO_S, mosaicoDeCapa } from "./mosaicos";

/**
 * Un mosaico de una capa del mapa, pasado por Tasa (la fuente no autoriza CORS y MapLibre pide cada mosaico con fetch).
 * NO es un proxy abierto: el navegador solo manda la capa (lista fija) y el número de mosaico; el servidor arma la
 * petición con host, capas, estilo, formato, proyección y tamaño fijos (mosaicos.ts). Lo demás → 400.
 *
 * Orden: primero el PERMISO, en cada petición (admin_org, finanzas y equipo con el mapa; 403 a los demás; 600 mosaicos
 * por hora por persona y capa, y 2,000 por persona al día sumando capas → 429). Lo decide catastro_permiso_mosaico() en
 * la base, con la sesión. El 429 lleva en el cuerpo "hora" o "dia" para que la pantalla avise cuál. Después la caché.
 *
 * Caché (nov-2026): la respuesta de la fuente se guarda una semana en la caché de datos de Vercel. Su llave es la URL a
 * la fuente (capa, zoom y posición; nada de la persona), así que la comparten todos los que YA pasaron el permiso. Una
 * respuesta que no sea PNG se borra de la caché en ese momento. Al navegador: private (nunca la caché compartida de la
 * CDN, que no revisa la sesión), un día.
 */

const NADA = { "Cache-Control": "private, no-store" };
/** El cuerpo del 429: cuál límite se alcanzó (lo lee la pantalla para avisar). */
export const LIMITE_HORA = "hora";
export const LIMITE_DIA = "dia";
const PNG = { "Content-Type": "image/png", "Cache-Control": "private, max-age=86400" };
// Un PNG transparente de 1×1: lo que recibe humo en lugar del mosaico de la fuente.
const PNG_VACIO = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

export async function servirMosaico(idCapa: string, p: { z: string; x: string; y: string }, request: NextRequest): Promise<NextResponse> {
  const capa = capaPorId(idCapa);
  const mosaico = capa ? mosaicoDeCapa(capa, p, request.nextUrl.searchParams) : null;
  if (!capa || !mosaico) return new NextResponse(null, { status: 400, headers: NADA });

  const supabase = await crearClienteServidor();
  const { data: permiso } = await supabase.rpc("catastro_permiso_mosaico", { p_capa: capa.id });
  if (permiso === "limite") return new NextResponse(LIMITE_HORA, { status: 429, headers: { ...NADA, "Content-Type": "text/plain", "Retry-After": "3600" } });
  if (permiso === "tope_dia") return new NextResponse(LIMITE_DIA, { status: 429, headers: { ...NADA, "Content-Type": "text/plain" } });
  if (permiso !== "ok") return new NextResponse(null, { status: 403, headers: NADA });

  // Humo (0072) prueba la ruta de Tasa (permisos, encabezados, que no sea proxy abierto), no la fuente: mosaico vacío,
  // con los mismos encabezados. Lo confirma la base con la huella del encabezado; con uno inventado no aplica.
  if (await encabezadoHumo()) {
    const { data: esHumo } = await supabase.rpc("es_humo");
    if (esHumo === true) return new NextResponse(new Uint8Array(PNG_VACIO), { headers: PNG });
  }

  try {
    const r = await fetch(mosaico.url, { signal: AbortSignal.timeout(12_000), next: { revalidate: CACHE_MOSAICO_S, tags: [mosaico.etiqueta] } });
    if (!r.ok || !(r.headers.get("content-type") ?? "").startsWith("image/png")) {
      revalidateTag(mosaico.etiqueta, { expire: 0 });
      throw new Error(`HTTP${r.status}`);
    }
    return new NextResponse(await r.arrayBuffer(), { headers: PNG });
  } catch (e) {
    console.warn(`Capa ${capa.id}: ${e instanceof Error ? e.name : "error"}`);
    // Sin mosaico: el mapa sigue con el satélite.
    return new NextResponse(null, { status: 204, headers: NADA });
  }
}
