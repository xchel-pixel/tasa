"use server";

import { revalidatePath } from "next/cache";
import { exigirPersona } from "@/lib/sesion";
import { crearClienteServidor } from "@/lib/supabase/server";

/**
 * La base decide todo: que la cotización sea suya, que siga vigente y
 * que no se haya aceptado ya (`aceptar_cotizacion`). Aquí solo se
 * traduce el error.
 *
 * Con conector manual, la base le pone folio al volverse trámite; con
 * uno externo, queda en "Aceptada – folio en asignación" hasta que el
 * sistema externo lo dé.
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

export type EstadoEstatus = { error: string | null; mensaje: string | null };

/**
 * Conector manual: admin_org (o el admin de la marca) mueve el estatus
 * de en medio. La base revisa rol, marca, conector y que el trabajo siga
 * en trámite; el cambio queda en el historial.
 */
export async function cambiarEstatus(_previo: EstadoEstatus, formData: FormData): Promise<EstadoEstatus> {
  await exigirPersona();
  const solicitud = String(formData.get("solicitud") ?? "");
  const supabase = await crearClienteServidor();
  const { error } = await supabase.rpc("cambiar_estatus_manual", {
    p_solicitud: solicitud,
    p_estatus: String(formData.get("estatus") ?? ""),
  });
  if (error) return { error: error.message || "No se pudo cambiar el estatus.", mensaje: null };
  revalidatePath(`/trabajos/${solicitud}`);
  return { error: null, mensaje: "Estatus actualizado. El comisionista ya lo ve." };
}
