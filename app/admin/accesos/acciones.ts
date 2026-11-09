"use server";

import { revalidatePath } from "next/cache";
import { exigirRol } from "@/lib/sesion";
import { crearClienteServidor } from "@/lib/supabase/server";

/** Accesos (0069/0071): solo admin_org. Cada acción lleva motivo y queda en la bitácora; la base revisa todo. */

export type EstadoAcceso = { error: string | null; mensaje: string | null };

const ACCIONES = {
  suspender: { rpc: "suspender_persona", listo: "Suspendida: sus sesiones se cerraron y la base ya no le deja ver ni hacer nada." },
  reactivar: { rpc: "reactivar_persona", listo: "Reactivada: puede volver a entrar con su código." },
  cerrar: { rpc: "cerrar_sesiones_persona", listo: "Sesiones cerradas: tendrá que entrar de nuevo con su código." },
} as const;

export async function accionAcceso(_p: EstadoAcceso, f: FormData): Promise<EstadoAcceso> {
  await exigirRol("admin_org");
  const que = String(f.get("que") ?? "") as keyof typeof ACCIONES;
  const accion = ACCIONES[que];
  if (!accion) return { error: "Acción no válida.", mensaje: null };
  const persona = String(f.get("persona") ?? "");
  const supabase = await crearClienteServidor();
  const { error } = await supabase.rpc(accion.rpc, { p_persona: persona, p_motivo: String(f.get("motivo") ?? "") });
  if (error) return { error: error.message || "No se pudo.", mensaje: null };
  revalidatePath(`/admin/accesos/${persona}`);
  revalidatePath("/admin/accesos");
  return { error: null, mensaje: accion.listo };
}
