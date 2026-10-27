import { crearClienteServidor, oExplota } from "@/lib/supabase/server";

/**
 * Los meses con cierre aprobado de la organización activa ("AAAA-MM-01").
 * En un mes cerrado nada se deshace: la pantalla no ofrece el botón y
 * dice que se corrija con un ajuste en el mes abierto (la base, además,
 * lo rechaza).
 */
export async function mesesCerrados(): Promise<Set<string>> {
  const supabase = await crearClienteServidor();
  const filas = (oExplota(await supabase.rpc("meses_cerrados"), "los meses cerrados") ?? []) as string[];
  return new Set(filas.map((m) => String(m).slice(0, 10)));
}

/** "2026-10-17" → "2026-10-01". */
export const mesDeFecha = (fecha: string) => `${fecha.slice(0, 7)}-01`;
