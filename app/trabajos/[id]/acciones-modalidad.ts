"use server";

import { revalidatePath } from "next/cache";
import { exigirRol } from "@/lib/sesion";
import { crearClienteServidor } from "@/lib/supabase/server";

/** Comisión descontada o cobrada directamente (0079). La base revisa todo y lo deja en la bitácora. */
export type EstadoModalidad = { error: string | null; mensaje: string | null };

export async function aplicarModalidad(_p: EstadoModalidad, f: FormData): Promise<EstadoModalidad> {
  await exigirRol("admin_org", "finanzas");
  const solicitud = String(f.get("solicitud") ?? "");
  const modalidad = String(f.get("modalidad") ?? "");
  const supabase = await crearClienteServidor();
  const { error } = await supabase.rpc("aplicar_modalidad_comision", { p_solicitud: solicitud, p_modalidad: modalidad, p_motivo: String(f.get("motivo") ?? "") });
  if (error) return { error: error.message || "No se pudo.", mensaje: null };
  revalidatePath(`/trabajos/${solicitud}`);
  return { error: null, mensaje: modalidad === "descontada" ? "Listo: comisión descontada al cliente." : "Listo: comisión cobrada directamente por el comisionista." };
}

export async function revertirModalidad(_p: EstadoModalidad, f: FormData): Promise<EstadoModalidad> {
  await exigirRol("admin_org", "finanzas");
  const solicitud = String(f.get("solicitud") ?? "");
  const supabase = await crearClienteServidor();
  const { error } = await supabase.rpc("revertir_modalidad_comision", { p_solicitud: solicitud, p_motivo: String(f.get("motivo") ?? "") });
  if (error) return { error: error.message || "No se pudo.", mensaje: null };
  revalidatePath(`/trabajos/${solicitud}`);
  return { error: null, mensaje: "Revertido." };
}
