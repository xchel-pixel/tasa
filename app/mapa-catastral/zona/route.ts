import { NextResponse, type NextRequest } from "next/server";
import { bytesDxf, dxfDeZona } from "@/lib/catastro/dxf";
import { cajaDeZona, consultarZona, textoDeFalla } from "@/lib/catastro/zona";
import { obtenerSesion } from "@/lib/sesion";
import { crearClienteServidor, encabezadoHumo } from "@/lib/supabase/server";

/**
 * DXF por zona (0098). Todo lo decide la base con la sesión de quien pide (catastro_zona_pedir): solo admin_org (y el
 * equipo si admin_org lo prende en Ajustes), 500 m por lado, una zona a la vez por organización, 5 al día por persona y
 * 20 por organización, 10 DXF del saldo (admin_org sin límite). Después, las tres consultas a la fuente en secuencia; si
 * una falla, se detiene, se avisa y se devuelven los DXF. Ningún reintento automático.
 */

export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const sesion = await obtenerSesion();
  if (!sesion?.persona) return mensaje("Inicia sesión para bajar la zona.", 401);
  const q = request.nextUrl.searchParams;
  const zona = cajaDeZona(Number(q.get("x0")), Number(q.get("y0")), Number(q.get("x1")), Number(q.get("y1")));
  if (!zona) return mensaje("La zona debe ser un rectángulo en Querétaro de hasta 500 m por lado (25 ha).", 400);
  const supabase = await crearClienteServidor();
  // Primero el permiso (sin abrir zona): 403 a quien no la tiene. Humo prueba eso y nunca va a la fuente.
  const { data: estado } = await supabase.rpc("catastro_zona_estado");
  if ((estado as { puede?: boolean } | null)?.puede !== true) return mensaje("La descarga por zona no está disponible para ti.", 403);
  if (await encabezadoHumo()) return mensaje("Humo no descarga zonas.", 400);

  const { data, error } = await supabase.rpc("catastro_zona_pedir", { p_x0: zona[0], p_y0: zona[1], p_x1: zona[2], p_y1: zona[3] });
  if (error) return mensaje("No se pudo empezar la descarga. Intenta de nuevo.", 400);
  const r = data as { id?: string; error?: string; estado?: number };
  if (!r.id) return mensaje(r.error ?? "La descarga por zona no está disponible para ti.", r.estado ?? 403);

  const desde = performance.now();
  const resultado = await consultarZona(zona);
  const duracion = Math.round(performance.now() - desde);
  if (!resultado.ok) {
    await supabase.rpc("catastro_zona_terminar", { p_id: r.id, p_ok: false, p_codigo: resultado.codigo, p_duracion: duracion });
    return mensaje(textoDeFalla(resultado.codigo), 502);
  }
  await supabase.rpc("catastro_zona_terminar", {
    p_id: r.id, p_ok: true, p_predios: resultado.predios.length, p_construcciones: resultado.construcciones.length, p_duracion: duracion,
  });
  const ahora = new Date();
  const nombre = `zona-${ahora.toLocaleString("sv-SE", { timeZone: "America/Mexico_City" }).slice(0, 16).replaceAll("-", "").replace(" ", "-").replace(":", "")}.dxf`;
  const bytes = bytesDxf(dxfDeZona({ zona, predios: resultado.predios, construcciones: resultado.construcciones, rotos: resultado.rotos, fecha: ahora }));
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "application/dxf",
      "Content-Disposition": `attachment; filename="${nombre}"`,
      "Cache-Control": "private, no-store",
      "X-Zona": `predios:${resultado.predios.length};construcciones:${resultado.construcciones.length};rotos:${resultado.rotos.join(",")}`,
    },
  });
}

function mensaje(texto: string, status: number) {
  return new NextResponse(texto, { status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "private, no-store" } });
}
