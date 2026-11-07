import { NextResponse, type NextRequest } from "next/server";
import { crearClienteServidor } from "@/lib/supabase/server";
import { peticionDeMosaico } from "@/lib/catastro/mosaicos";

/**
 * Las líneas de predios del mapa, pasadas por Tasa (la fuente no autoriza CORS y MapLibre pide cada mosaico con
 * fetch). NO es un proxy abierto: el navegador solo manda el número de mosaico (zoom 17 a 20, x, y) dentro de
 * Querétaro, sin ningún otro parámetro; el servidor arma la petición con host, capas, formato, proyección y tamaño
 * fijos (lib/catastro/mosaicos.ts). Lo demás → 400.
 * Quién: admin_org, finanzas y equipo con el mapa encendido (403 a los demás). Hasta 600 mosaicos por hora por
 * persona (429). Todo eso lo decide catastro_permiso_mosaico() en la base, con la sesión.
 * El navegador guarda cada mosaico un día (private: nunca en la caché compartida).
 */

const NADA = { "Cache-Control": "private, no-store" };

export async function GET(request: NextRequest, { params }: { params: Promise<{ z: string; x: string; y: string }> }) {
  const p = await params;
  const url = peticionDeMosaico(p, request.nextUrl.searchParams);
  if (!url) return new NextResponse(null, { status: 400, headers: NADA });

  const supabase = await crearClienteServidor();
  const { data: permiso } = await supabase.rpc("catastro_permiso_mosaico");
  if (permiso === "limite") return new NextResponse(null, { status: 429, headers: { ...NADA, "Retry-After": "3600" } });
  if (permiso !== "ok") return new NextResponse(null, { status: 403, headers: NADA });

  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(12_000), cache: "no-store" });
    if (!r.ok || !(r.headers.get("content-type") ?? "").startsWith("image/png")) throw new Error(`HTTP${r.status}`);
    return new NextResponse(await r.arrayBuffer(), {
      headers: { "Content-Type": "image/png", "Cache-Control": "private, max-age=86400" },
    });
  } catch (e) {
    console.warn(`Capa de predios: ${e instanceof Error ? e.name : "error"}`);
    // Sin mosaico: el mapa sigue con el satélite.
    return new NextResponse(null, { status: 204, headers: NADA });
  }
}
