import { NextResponse, type NextRequest } from "next/server";
import { fuentesDe } from "@/lib/fuentes-pdf";
import { pdfPredio } from "@/lib/catastro/pdf";
import { conPunto, normalizarClave, type Ficha } from "@/lib/catastro/servicio";
import { obtenerSesion } from "@/lib/sesion";
import { crearClienteServidor } from "@/lib/supabase/server";

/**
 * El PDF sin marca de un predio guardado. Los campos salen de catastro_pdf() en la base con la sesión de quien
 * lo pide (los de PDF de su rol; propietario y operación solo para el equipo), nunca del navegador. No consulta
 * la fuente externa. Cuenta en el cupo de PDF la primera vez en el mes por predio.
 */
export async function GET(request: NextRequest) {
  const sesion = await obtenerSesion();
  if (!sesion?.persona) return NextResponse.redirect(new URL("/entrar", request.url));
  const clave = normalizarClave(request.nextUrl.searchParams.get("clave") ?? "");
  if (!clave) return mensaje("La clave catastral no es válida.", 400);
  const supabase = await crearClienteServidor();
  const { data, error } = await supabase.rpc("catastro_pdf", { p_clave: clave });
  if (error) return mensaje(error.message, 403);
  const bytes = await pdfPredio(conPunto(data as Ficha), await fuentesDe("manrope"));
  return new NextResponse(Buffer.from(bytes), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="Ficha_predio_${clave}.pdf"`, "Cache-Control": "private, no-store" },
  });
}

function mensaje(texto: string, status: number) {
  return new NextResponse(`${texto}\n\nRegresa al Mapa catastral para seguir.`, { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
