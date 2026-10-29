import { urlDelSitio } from "@/lib/altas";
import { fechaCorta } from "@/lib/formato";
import type { Persona } from "@/lib/sesion";
import { crearClienteServidor } from "@/lib/supabase/server";

/** Quienes invitan sin ser comisionistas: solo seguimiento (admin_org nunca lleva bono). */
export const ROLES_QUE_INVITAN = ["admin_org", "equipo", "finanzas", "admin_marca"] as const;

/** La liga /s/<org>/<código> con la que un cliente pide a nombre de esta persona. */
export async function ligaDeClientes(persona: Persona, codigo: string): Promise<string> {
  return `${await urlDelSitio()}/s/${persona.organizacion.slug}/${codigo}`;
}

/** El código de referido de esta persona del equipo; nulo si no tiene. */
export async function codigoDeEquipo(persona: Persona): Promise<string | null> {
  if (!(ROLES_QUE_INVITAN as readonly string[]).includes(persona.rol)) return null;
  const supabase = await crearClienteServidor();
  const { data } = await supabase
    .from("membresias")
    .select("codigo_referido")
    .eq("persona_id", persona.id)
    .eq("organizacion_id", persona.organizacion.id)
    .maybeSingle()
    .returns<{ codigo_referido: string | null } | null>();
  return data?.codigo_referido ?? null;
}

/** La liga de alta con el código de esta persona del equipo; nula si no tiene código. */
export async function ligaDeEquipo(persona: Persona): Promise<string | null> {
  const codigo = await codigoDeEquipo(persona);
  return codigo ? `${await urlDelSitio()}/alta/${persona.organizacion.slug}?ref=${codigo}` : null;
}

/**
 * El bono (texto) de esta persona del equipo. Mientras no exista el cálculo del bono, no promete nada:
 * solo su % y que se activa próximamente.
 */
export function textoDelBono(pct: number, hasta: string | null): string {
  const cuanto = `${Number(pct).toLocaleString("es-MX", { maximumFractionDigits: 2 })}%`;
  return `Bono de referido: ${cuanto} (se activa próximamente)${hasta ? `, vigente hasta el ${fechaCorta(hasta)}` : ""}.`;
}

export async function bonoDeEquipo(persona: Persona): Promise<string | null> {
  if (!(ROLES_QUE_INVITAN as readonly string[]).includes(persona.rol)) return null;
  const supabase = await crearClienteServidor();
  const { data } = await supabase.rpc("mi_bono_referido").maybeSingle<{ cobra: boolean; pct: number | null; hasta: string | null }>();
  return data?.cobra && data.pct !== null ? textoDelBono(data.pct, data.hasta) : null;
}
