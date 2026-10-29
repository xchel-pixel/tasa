import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { sincronizarConector, type ResultadoSync } from "@/lib/conectores/sincronizar";
import type { ConfigConector } from "@/lib/conectores/tipos";

/**
 * El único lugar donde existe la llave secreta de Supabase. Lo llama
 * pg_cron cada 15 minutos (y el botón "Sincronizar ahora" de Ajustes,
 * desde el servidor), siempre con `Authorization: Bearer <CRON_SECRET>`.
 *
 * Cuerpo opcional: `{ "conector": "<id>", "probar": true }` para correr
 * uno solo o solo probar la conexión.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function autorizado(request: NextRequest): boolean {
  const secreto = process.env.CRON_SECRET;
  const recibido = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!secreto || !recibido) return false;
  const a = Buffer.from(secreto);
  const b = Buffer.from(recibido);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: NextRequest) {
  if (!autorizado(request)) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const llave = process.env.SUPABASE_SECRET_KEY;
  if (!llave) {
    console.error("[tasa] Falta SUPABASE_SECRET_KEY: el cron no puede correr.");
    return NextResponse.json({ error: "Falta la llave secreta" }, { status: 500 });
  }
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, llave, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const cuerpo = (await request.json().catch(() => ({}))) as { conector?: string; probar?: boolean; barrido_csf?: boolean };

  // Lo que no depende de conectores: vencer cotizaciones y limpiar solicitudes de alta.
  if (!cuerpo.conector) {
    const { error } = await supabase.rpc("vencer_cotizaciones");
    if (error) console.error(`[tasa] No se pudieron vencer cotizaciones: ${error.message}`);
    await limpiarAltas(supabase, Boolean(cuerpo.barrido_csf));
  }

  // Probar un conector se puede antes de activarlo; sincronizar, solo los activos.
  const { data, error } =
    cuerpo.probar && cuerpo.conector
      ? await supabase.rpc("conector_para_probar", { p_conector: cuerpo.conector })
      : await supabase.rpc("conectores_para_sincronizar");
  if (error) {
    console.error(`[tasa] No se pudieron leer los conectores: ${error.message}`);
    return NextResponse.json({ error: "No se pudieron leer los conectores" }, { status: 500 });
  }
  const conectores = ((data ?? []) as ConfigConector[]).filter((c) => !cuerpo.conector || c.id === cuerpo.conector);

  // Uno tras otro: Notion permite ~3 llamadas por segundo por integración.
  const resultados: ResultadoSync[] = [];
  for (const c of conectores) {
    resultados.push(await sincronizarConector(supabase, c, { soloProbar: Boolean(cuerpo.probar) }));
  }
  for (const r of resultados) {
    console.log(`[tasa] conector ${r.conector}: ${r.creados} creados, ${r.leidos} leídos, ${r.actualizados} actualizados${r.error ? ` · error: ${r.error}` : ""}`);
  }
  return NextResponse.json({ resultados });
}

/**
 * Limpieza de CSF (ver 0030): rechazadas a los 90 días, reemplazadas a los
 * 30, solicitudes abandonadas al día con su archivo y archivos sin dueño
 * de más de un día. Primero se borra el archivo y después se cierra en la
 * base (con su entrada en la bitácora): si Storage falla, no se cierra y
 * se reintenta en la siguiente corrida.
 */
async function limpiarAltas(supabase: SupabaseClient, barrido = false) {
  // El barrido único (`{ "barrido_csf": true }`) borra sin dueño de más de una hora, no de un día.
  const { data, error } = await supabase.rpc("csf_por_limpiar", barrido ? { p_espera: "1 hour" } : {});
  if (error) {
    console.error(`[tasa] No se pudo leer la limpieza de CSF: ${error.message}`);
    return;
  }
  const cuenta: Record<string, number> = {};
  for (const f of (data ?? []) as { tipo: string; ref: string | null; ruta: string }[]) {
    // Borrar un archivo que ya no existe no es error (la abandonada pudo no haber subido nada).
    const { error: errorStorage } = await supabase.storage.from("altas").remove([f.ruta]);
    if (errorStorage) {
      console.error(`[tasa] No se pudo borrar la CSF ${f.ruta}: ${errorStorage.message}`);
      continue;
    }
    const { error: errorCierre } = await supabase.rpc("cerrar_limpieza_csf", { p_tipo: f.tipo, p_ref: f.ref, p_ruta: f.ruta });
    if (errorCierre) console.error(`[tasa] No se pudo cerrar la limpieza de ${f.ruta}: ${errorCierre.message}`);
    else cuenta[f.tipo] = (cuenta[f.tipo] ?? 0) + 1;
  }
  if (Object.keys(cuenta).length) console.log(`[tasa] Limpieza de CSF: ${JSON.stringify(cuenta)}`);
}
