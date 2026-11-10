import { NextResponse, type NextRequest } from "next/server";
import { csv, filtrosDe, parametros, tablas, type Estadisticas } from "@/lib/estadisticas";
import { obtenerSesion } from "@/lib/sesion";
import { crearClienteServidor } from "@/lib/supabase/server";

/** CSV de una tabla de Estadísticas (admin_org y finanzas; la base lo revisa). Sin datos de propietarios. */
export async function GET(request: NextRequest) {
  const sesion = await obtenerSesion();
  if (!sesion?.persona) return new NextResponse("Inicia sesión.", { status: 401 });
  const q = Object.fromEntries(request.nextUrl.searchParams.entries());
  const tabla = q.tabla as keyof ReturnType<typeof tablas>;
  const f = filtrosDe(q);
  const supabase = await crearClienteServidor();
  const { data, error } = await supabase.rpc("estadisticas", parametros(f));
  if (error) return new NextResponse(error.message, { status: 403, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  const todas = tablas(data as Estadisticas);
  if (!(tabla in todas)) return new NextResponse("Tabla no válida.", { status: 400 });
  return new NextResponse(csv(todas[tabla]), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="estadisticas-${tabla}-${f.desde}-a-${f.hasta}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
