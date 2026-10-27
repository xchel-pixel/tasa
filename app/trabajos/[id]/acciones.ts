"use server";

import { revalidatePath } from "next/cache";
import { exigirPersona } from "@/lib/sesion";
import { crearClienteServidor } from "@/lib/supabase/server";

/**
 * La base decide todo: que la cotización sea suya, que siga vigente y
 * que no se haya aceptado ya (`aceptar_cotizacion`). Aquí solo se
 * traduce el error.
 *
 * La página de Notion se crea en la fase de la integración; mientras,
 * el trámite queda en "Aceptada – folio en asignación".
 */
export async function aceptarCotizacion(
  _previo: { error: string | null },
  formData: FormData
): Promise<{ error: string | null }> {
  await exigirPersona();
  const cotizacion = String(formData.get("cotizacion") ?? "");
  if (formData.get("confirmo") !== "on") {
    return { error: "Marca la casilla para confirmar." };
  }

  const supabase = await crearClienteServidor();
  const { data: solicitud } = await supabase
    .from("cotizaciones")
    .select("solicitud_id")
    .eq("id", cotizacion)
    .maybeSingle();

  const { error } = await supabase.rpc("aceptar_cotizacion", { p_cotizacion: cotizacion });
  if (error) {
    const vencio = /venció|vigente/i.test(error.message);
    return {
      error: vencio
        ? "Esta cotización ya no está vigente. Pide una nueva a Administración."
        : "No se pudo aceptar. Inténtalo otra vez.",
    };
  }

  revalidatePath("/");
  if (solicitud?.solicitud_id) revalidatePath(`/trabajos/${solicitud.solicitud_id}`);
  return { error: null };
}
