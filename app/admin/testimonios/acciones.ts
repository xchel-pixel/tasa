"use server";

import { revalidatePath } from "next/cache";
import { exigirRol } from "@/lib/sesion";
import { crearClienteServidor } from "@/lib/supabase/server";

export type EstadoTestimonio = { error: string | null; mensaje: string | null };

/** Aprobar (se publica en su tarjeta) o rechazar con motivo. Queda en bitácora. */
export async function decidirTestimonio(_previo: EstadoTestimonio, formData: FormData): Promise<EstadoTestimonio> {
  await exigirRol("admin_org");
  const aprobar = formData.get("decision") === "aprobar";
  const supabase = await crearClienteServidor();
  const { error } = await supabase.rpc("decidir_testimonio", {
    p_testimonio: String(formData.get("testimonio") ?? ""),
    p_aprobar: aprobar,
    p_motivo: String(formData.get("motivo") ?? ""),
  });
  if (error) return { error: error.message || "No se pudo.", mensaje: null };
  revalidatePath("/admin/testimonios");
  revalidatePath("/");
  return { error: null, mensaje: aprobar ? "Aprobado: ya se ve en su tarjeta." : "Rechazado." };
}
