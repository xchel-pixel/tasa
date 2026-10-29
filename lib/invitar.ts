import { urlDelSitio } from "@/lib/altas";
import { fechaCorta } from "@/lib/formato";
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

/** El bono (texto) que esta persona del equipo ganaría por invitar; nulo si hoy no cobra. */
export function textoDelBono(pct: number | null, hasta: string | null): string {
  const cuanto = pct === null ? "de 2% a 5% (según tus referidos activos)" : `${Number(pct).toLocaleString("es-MX", { maximumFractionDigits: 2 })}%`;
  return `Ganas ${cuanto} por 12 meses de lo que se le pague a quien invites.${hasta ? ` Vigente hasta el ${fechaCorta(hasta)}.` : ""}`;
}

export async function bonoDeEquipo(persona: Persona): Promise<string | null> {
  if (!(ROLES_QUE_INVITAN as readonly string[]).includes(persona.rol)) return null;
  const supabase = await crearClienteServidor();
  const { data } = await supabase.rpc("mi_bono_referido").maybeSingle<{ cobra: boolean; pct: number | null; hasta: string | null }>();
  return data?.cobra ? textoDelBono(data.pct, data.hasta) : null;
}
