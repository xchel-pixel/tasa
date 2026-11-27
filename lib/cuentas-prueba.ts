import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Las cuentas de prueba (membresias.es_demo, 0085) de la organización: no se ofrecen para asignar trabajos ni como
 * "referido por", y no cuentan en listas ni conteos. La base además impide que reciban o envíen trabajos (0085, 0095).
 */
export async function cuentasDePrueba(supabase: SupabaseClient): Promise<Set<string>> {
  const { data } = await supabase.from("membresias").select("persona_id").eq("es_demo", true).returns<{ persona_id: string }[]>();
  return new Set((data ?? []).map((m) => m.persona_id));
}
