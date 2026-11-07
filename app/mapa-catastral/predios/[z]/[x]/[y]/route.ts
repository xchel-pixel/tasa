import { NextResponse, type NextRequest } from "next/server";
import { ROLES_CON_LINEAS } from "@/lib/catastro/estilo";
import { tengoHerramienta } from "@/lib/herramientas";
import { obtenerSesion } from "@/lib/sesion";

/**
 * La capa de predios del mapa, pasada por Tasa. El navegador no puede leerla directo: la fuente no autoriza a
 * otros sitios (CORS) y MapLibre pide cada mosaico con fetch. Solo admin_org, finanzas y equipo (403 a los demás), solo mosaicos de
 * nivel de calle (zoom 17 a 20) y sin parámetros libres: el servidor arma la petición. El navegador guarda cada
 * mosaico un día. Así, además, la liga de la fuente no aparece en el navegador.
 */

const FUENTE = "https://catastroedo.queretaro.gob.mx/geoserver/queretaro/wms";
const CAPAS = Array.from({ length: 18 }, (_, i) => `queretaro:M${String(i + 1).padStart(2, "0")}_PA`).join(",");
const R = 20037508.342789244; // medio mundo en EPSG:3857

export async function GET(_: NextRequest, { params }: { params: Promise<{ z: string; x: string; y: string }> }) {
  // Solo admin_org, finanzas y equipo, con el mapa en su catálogo. Comisionista y admin_marca: 403 (no basta ocultarla).
  const sesion = await obtenerSesion();
  const rol = sesion?.persona?.rol;
  if (!rol || !(ROLES_CON_LINEAS as readonly string[]).includes(rol) || !(await tengoHerramienta("mapa_catastral"))) {
    return new NextResponse(null, { status: 403, headers: { "Cache-Control": "private, no-store" } });
  }
  const { z: zt, x: xt, y: yt } = await params;
  const [z, x, y] = [zt, xt, yt.replace(/\.png$/, "")].map((v) => (/^\d{1,7}$/.test(v) ? Number(v) : NaN));
  const n = 2 ** z;
  if (!(z >= 17 && z <= 20) || !(x >= 0 && x < n) || !(y >= 0 && y < n)) return new NextResponse(null, { status: 404 });
  const lado = (2 * R) / n;
  const bbox = [-R + x * lado, R - (y + 1) * lado, -R + (x + 1) * lado, R - y * lado].map((v) => v.toFixed(2)).join(",");
  try {
    const r = await fetch(`${FUENTE}?service=WMS&version=1.1.1&request=GetMap&layers=${CAPAS}&styles=&format=image/png&transparent=true`
      + `&srs=EPSG:3857&bbox=${bbox}&width=512&height=512`, { signal: AbortSignal.timeout(12_000), cache: "no-store" });
    if (!r.ok || !(r.headers.get("content-type") ?? "").startsWith("image/png")) throw new Error(`HTTP${r.status}`);
    return new NextResponse(await r.arrayBuffer(), {
      headers: { "Content-Type": "image/png", "Cache-Control": "private, max-age=86400" },
    });
  } catch (e) {
    console.warn(`Capa de predios: ${e instanceof Error ? e.name : "error"}`);
    // Sin mosaico: el mapa sigue con el satélite.
    return new NextResponse(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  }
}
