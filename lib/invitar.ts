import { urlDelSitio } from "@/lib/altas";
import type { Persona } from "@/lib/sesion";
import { crearClienteServidor } from "@/lib/supabase/server";

/** Quienes invitan sin ser comisionistas: solo seguimiento (admin_org nunca lleva bono). */
export const ROLES_QUE_INVITAN = ["admin_org", "equipo", "finanzas", "admin_marca"] as const;

/** La liga de alta con el código de esta persona del equipo; nula si no tiene código. */
export async function ligaDeEquipo(persona: Persona): Promise<string | null> {
  if (!(ROLES_QUE_INVITAN as readonly string[]).includes(persona.rol)) return null;
  const supabase = await crearClienteServidor();
  const { data } = await supabase
    .from("membresias")
    .select("codigo_referido")
    .eq("persona_id", persona.id)
    .eq("organizacion_id", persona.organizacion.id)
    .maybeSingle()
    .returns<{ codigo_referido: string | null } | null>();
  if (!data?.codigo_referido) return null;
  return `${await urlDelSitio()}/alta/${persona.organizacion.slug}?ref=${data.codigo_referido}`;
}
