"use server";

import { revalidatePath } from "next/cache";
import { exigirRol } from "@/lib/sesion";
import { crearClienteServidor } from "@/lib/supabase/server";

export type EstadoAlerta = { error: string | null; mensaje: string | null };

/**
 * Dos salidas, las dos con texto obligatorio:
 *   · cancelar: `cancelar_trabajo` borra o carga la comisión y la alerta se cierra sola;
 *   · descartar: Notion se equivocó; queda la nota en la alerta.
 */
export async function resolverAlerta(_previo: EstadoAlerta, formData: FormData): Promise<EstadoAlerta> {
  await exigirRol("admin_org");
  const alerta = String(formData.get("alerta") ?? "");
  const solicitud = String(formData.get("solicitud") ?? "");
  const decision = String(formData.get("decision") ?? "");
  const texto = String(formData.get("texto") ?? "").trim();
  if (!texto) return { error: "Escribe el motivo o la nota.", mensaje: null };

  const supabase = await crearClienteServidor();
  const { error } =
    decision === "cancelar"
      ? await supabase.rpc("cancelar_trabajo", { p_solicitud: solicitud, p_motivo: texto })
      : await supabase.rpc("descartar_alerta", { p_alerta: alerta, p_nota: texto });

  if (error) {
    console.error(`[tasa] No se pudo resolver la alerta: ${error.message}`);
    return { error: /ya estaba cancelado/.test(error.message) ? "Ese trabajo ya estaba cancelado." : "No se pudo guardar. Inténtalo otra vez.", mensaje: null };
  }

  revalidatePath("/admin/alertas");
  revalidatePath("/");
  return { error: null, mensaje: decision === "cancelar" ? "Trabajo cancelado." : "Alerta descartada." };
}
