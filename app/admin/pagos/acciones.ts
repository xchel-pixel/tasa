"use server";

import { revalidatePath } from "next/cache";
import { exigirRol, ROLES_OPERACION } from "@/lib/sesion";
import { crearClienteServidor } from "@/lib/supabase/server";

export type EstadoRevision = { error: string | null; mensaje: string | null };

/**
 * Confirmar o rechazar. La base hace cumplir las reglas (solo de
 * "reportado", no pasar del total, motivo obligatorio al rechazar) y,
 * si el pago completa el 100%, devenga la comisión en la misma
 * transacción. Aquí solo se traduce el error.
 */
export async function revisarPago(_previo: EstadoRevision, formData: FormData): Promise<EstadoRevision> {
  await exigirRol(...ROLES_OPERACION);
  const id = String(formData.get("pago") ?? "");
  const decision = String(formData.get("decision") ?? "");
  const motivo = String(formData.get("motivo") ?? "").trim();

  if (decision === "rechazar" && !motivo) {
    return { error: "Escribe el motivo: el comisionista lo va a ver.", mensaje: null };
  }

  const supabase = await crearClienteServidor();
  const { error, count } = await supabase
    .from("pagos")
    .update(
      decision === "confirmar" ? { estado: "confirmado" } : { estado: "rechazado", motivo_rechazo: motivo },
      { count: "exact" }
    )
    .eq("id", id)
    .eq("estado", "reportado");

  if (error) {
    const excede = /pasaría del total/.test(error.message);
    return {
      error: excede
        ? "Con este pago lo confirmado pasaría del total del trabajo. Revisa el monto o recházalo."
        : "No se pudo guardar. Inténtalo otra vez.",
      mensaje: null,
    };
  }
  if (count !== 1) return { error: "Este pago ya se había revisado.", mensaje: null };

  revalidatePath("/admin/pagos");
  revalidatePath("/");
  return { error: null, mensaje: decision === "confirmar" ? "Confirmado." : "Rechazado." };
}
