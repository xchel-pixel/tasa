"use server";

import { revalidatePath } from "next/cache";
import { exigirRol } from "@/lib/sesion";
import { crearClienteServidor } from "@/lib/supabase/server";

export type EstadoCupo = { error: string | null; mensaje: string | null };

/** "Pedir más": alerta para admin_org (una por herramienta y mes). */
export async function pedirMasCupo(_p: EstadoCupo, f: FormData): Promise<EstadoCupo> {
  await exigirRol("comisionista");
  const supabase = await crearClienteServidor();
  const { error } = await supabase.rpc("pedir_mas_cupo", { p_herramienta: String(f.get("herramienta") ?? "") });
  if (error) return { error: error.message || "No se pudo enviar.", mensaje: null };
  return { error: null, mensaje: "Listo: Administración ya sabe que necesitas más este mes." };
}

/** admin_org libera cálculos extra a un comisionista para el mes en curso (desde su ficha o desde la alerta). */
export async function liberarCupo(_p: EstadoCupo, f: FormData): Promise<EstadoCupo> {
  await exigirRol("admin_org");
  const persona = String(f.get("persona") ?? "");
  const cantidad = Number(String(f.get("cantidad") ?? "").trim());
  const supabase = await crearClienteServidor();
  const { error } = await supabase.rpc("liberar_cupo", {
    p_persona: persona,
    p_herramienta: String(f.get("herramienta") ?? ""),
    p_cantidad: Number.isInteger(cantidad) ? cantidad : 0,
    p_motivo: String(f.get("motivo") ?? ""),
  });
  if (error) return { error: error.message || "No se pudo liberar.", mensaje: null };
  revalidatePath(`/admin/comisionistas/${persona}`);
  revalidatePath("/admin/alertas");
  return { error: null, mensaje: `Se liberaron ${cantidad} más para este mes.` };
}
