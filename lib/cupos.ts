import { crearClienteServidor } from "@/lib/supabase/server";

/**
 * Cupos mensuales de herramientas (0057). `limite` nulo = sin límite. Las herramientas que consumen cupo se
 * listan aquí; una herramienta nueva (consulta catastral, OV express) solo se agrega a esta lista y llama a
 * `consumir_cupo` en la base al hacer algo nuevo.
 */
export const HERRAMIENTAS_CON_CUPO = ["calculadora_traslado", "calculadora_traslado_completa", "mapa_catastral", "mapa_catastral_pdf"] as const;
export type HerramientaConCupo = (typeof HERRAMIENTAS_CON_CUPO)[number];

export type Cupo = { limite: number | null; extras: number; usados: number; disponibles: number | null };

export async function miCupo(herramienta: HerramientaConCupo): Promise<Cupo> {
  const supabase = await crearClienteServidor();
  const { data } = await supabase.rpc("mi_cupo", { p_herramienta: herramienta }).maybeSingle<Cupo>();
  return data ?? { limite: null, extras: 0, usados: 0, disponibles: null };
}

export async function cupoDe(persona: string, herramienta: HerramientaConCupo): Promise<Cupo> {
  const supabase = await crearClienteServidor();
  const { data } = await supabase.rpc("cupo_de_comisionista", { p_persona: persona, p_herramienta: herramienta }).maybeSingle<Cupo>();
  return data ?? { limite: null, extras: 0, usados: 0, disponibles: null };
}

/** "Te quedan 12 de 15 este mes" (con los extras sumados) o "Sin límite". */
export function textoCupo(c: Cupo): string {
  if (c.limite === null) return "Sin límite";
  const total = c.limite + c.extras;
  return `Te quedan ${c.disponibles} de ${total} este mes${c.extras ? ` (incluye ${c.extras} extra${c.extras === 1 ? "" : "s"})` : ""}`;
}
