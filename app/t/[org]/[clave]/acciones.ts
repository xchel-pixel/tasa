"use server";

import { crearClienteServidor } from "@/lib/supabase/server";

/** Una visita o un clic en WhatsApp (solo números; las del propio comisionista no cuentan). Nunca truena. */
export async function registrarEvento(org: string, clave: string, tipo: "visita" | "whatsapp"): Promise<void> {
  try {
    const supabase = await crearClienteServidor();
    await supabase.rpc("registrar_evento_tarjeta", { p_org: org, p_clave: clave, p_tipo: tipo });
  } catch {
    // Un contador que falla no estorba a quien visita.
  }
}

/** Un clic en un servicio propio o un inmueble de la tarjeta. Nunca truena. */
export async function registrarClic(org: string, clave: string, ref: string): Promise<void> {
  if (!/^[0-9a-f-]{36}$/i.test(ref)) return;
  try {
    const supabase = await crearClienteServidor();
    await supabase.rpc("registrar_clic_tarjeta", { p_org: org, p_clave: clave, p_ref: ref });
  } catch {
    // Un contador que falla no estorba a quien visita.
  }
}
