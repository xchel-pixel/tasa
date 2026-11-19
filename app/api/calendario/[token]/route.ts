import { NextResponse, type NextRequest } from "next/server";
import { construirIcs, type EventoIcs } from "@/lib/agenda-ics";
import { clienteDeServicio } from "@/lib/supabase/servicio";

/**
 * La liga privada de calendario (0091). Sin sesión: la entra a leer Google, Apple u Outlook. El token es la única
 * llave (la base guarda solo su huella). Con un token inválido o revocado regresa un calendario vacío: no dice si la
 * liga existió. Solo lo de Tasa con folio y municipio.
 */
export const dynamic = "force-dynamic";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const token = (await params).token.replace(/[.]ics$/i, "");
  let eventos: EventoIcs[] = [];
  if (/^[0-9a-f]{64}$/.test(token)) {
    const db = clienteDeServicio();
    if (db) {
      const { data, error } = await db.rpc("agenda_ics", { p_token: token });
      if (error) console.warn(`Liga de calendario: ${error.message}`);
      eventos = (data ?? []) as EventoIcs[];
    }
  }
  return new NextResponse(construirIcs(eventos), {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": "inline; filename=\"tasa.ics\"",
      "Cache-Control": "private, max-age=900",
      "X-Robots-Tag": "noindex",
    },
  });
}
