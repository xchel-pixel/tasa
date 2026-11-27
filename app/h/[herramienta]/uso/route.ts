import { NextResponse } from "next/server";
import { POR_LIGA } from "@/lib/herramientas-asesor/servir";
import { crearClienteServidor, verComoId } from "@/lib/supabase/server";

/** La herramienta avisa que se bajó un PDF (0100): solo eso, nada del contenido. La base revisa que la persona la tenga. */
export async function POST(_request: Request, { params }: { params: Promise<{ herramienta: string }> }) {
  const clave = POR_LIGA[(await params).herramienta];
  if (clave && !(await verComoId())) {
    const supabase = await crearClienteServidor();
    await supabase.rpc("registrar_uso_herramienta", { p_clave: clave, p_evento: "pdf" });
  }
  return new NextResponse(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}
