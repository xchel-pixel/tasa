import { NextResponse, type NextRequest } from "next/server";
import { fuentesDe } from "@/lib/fuentes-pdf";
import { obtenerSesion } from "@/lib/sesion";
import { pdfTraslado } from "@/lib/traslado/pdf";
import { leerCalculo } from "@/lib/traslado/servidor";

/** El PDF sin marca de un cálculo guardado. Solo lo ve quien lo calculó (RLS de calculos_traslado). */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const sesion = await obtenerSesion();
  if (!sesion?.persona) return NextResponse.redirect(new URL("/entrar", request.url));
  const { id } = await params;
  const c = await leerCalculo(id);
  if (!c) return new NextResponse("No encontrado", { status: 404 });
  const bytes = await pdfTraslado(c.resultado, {
    referencia: c.referencia,
    operacion: c.entrada.operacion,
    detalle: request.nextUrl.searchParams.get("detalle") === "1",
    fuentes: await fuentesDe("manrope"),
    usaInpc: Boolean(c.entrada.extemporaneo || c.entrada.vendedor?.isr),
  });
  const nombre = `Gastos_traslado_${c.lado}_${c.municipio}_${c.resultado.fecha}`.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9]+/g, "_");
  return new NextResponse(Buffer.from(bytes), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${nombre}.pdf"`, "Cache-Control": "private, no-store" },
  });
}
