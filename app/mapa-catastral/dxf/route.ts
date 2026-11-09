import { NextResponse, type NextRequest } from "next/server";
import { bytesDxf, dxfDePredio } from "@/lib/catastro/dxf";
import { geometriaValida } from "@/lib/catastro/geo";
import { normalizarClave } from "@/lib/catastro/servicio";
import { obtenerSesion } from "@/lib/sesion";
import { crearClienteServidor } from "@/lib/supabase/server";

/**
 * El DXF de un predio guardado (0065). La autorización, el saldo y el descuento los decide catastro_dxf() en la
 * base, con la sesión de quien lo pide: 403 si no está autorizado, 429 sin saldo (o tope del día), 404 si el
 * predio no está guardado. No consulta la fuente externa. Solo polígono, clave y fecha: nada de la ficha.
 */
export async function GET(request: NextRequest) {
  const sesion = await obtenerSesion();
  if (!sesion?.persona) return mensaje("Inicia sesión para bajar el DXF.", 401);
  const clave = normalizarClave(request.nextUrl.searchParams.get("clave") ?? "");
  if (!clave) return mensaje("La clave catastral no es válida.", 400);
  const supabase = await crearClienteServidor();
  const { data, error } = await supabase.rpc("catastro_dxf", { p_clave: clave });
  if (error) return mensaje(error.message, 400);
  // Al negar, la base registra la denegación y devuelve el motivo y el estado (0070): 403, 429 o 404.
  const negado = data as { error?: string; estado?: number } | null;
  if (negado?.error) return mensaje(negado.error, negado.estado ?? 403);
  const d = data as { clave: string; geometria: unknown; geometria_utm: unknown; consultado_en: string };
  const geometria = geometriaValida(d.geometria);
  if (!geometria) return mensaje("Ese predio no tiene polígono guardado.", 404);
  const bytes = bytesDxf(dxfDePredio({ clave: d.clave, geometria, geometriaUtm: geometriaValida(d.geometria_utm), consultadoEn: d.consultado_en }));
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "application/dxf",
      "Content-Disposition": `attachment; filename="${d.clave}.dxf"`,
      "Cache-Control": "private, no-store",
    },
  });
}

function mensaje(texto: string, status: number) {
  return new NextResponse(`${texto}\n\nRegresa al Mapa catastral para seguir.`, { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
