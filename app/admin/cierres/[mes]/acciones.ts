"use server";

import { revalidatePath } from "next/cache";
import { exigirRol } from "@/lib/sesion";
import { crearClienteServidor } from "@/lib/supabase/server";

export type EstadoCierre = { error: string | null; mensaje: string | null };

const ruta = (mes: string) => `/admin/cierres/${mes.slice(0, 7)}`;

/**
 * Preparar (finanzas o admin_org) y aprobar (solo admin_org). Las
 * funciones de la base revisan el rol, que el mes haya terminado, el
 * orden de los meses y bloquean el cierre al aprobar.
 */
export async function moverCierre(_previo: EstadoCierre, formData: FormData): Promise<EstadoCierre> {
  const accion = String(formData.get("accion") ?? "");
  const mes = String(formData.get("mes") ?? "");
  await exigirRol(...(accion === "aprobar" ? (["admin_org"] as const) : (["admin_org", "finanzas"] as const)));

  if (accion === "aprobar" && formData.get("confirmo") !== "on") {
    return { error: "Marca la casilla: un cierre aprobado no se reabre.", mensaje: null };
  }

  const supabase = await crearClienteServidor();
  const { error } = await supabase.rpc(accion === "aprobar" ? "aprobar_cierre" : "preparar_cierre", { p_mes: mes });
  if (error) {
    // Los mensajes de la base ya están escritos para leerse ("Antes hay que aprobar 2026-09").
    return { error: error.message || "No se pudo. Inténtalo otra vez.", mensaje: null };
  }

  revalidatePath(ruta(mes));
  revalidatePath("/admin/cierres");
  revalidatePath("/");
  return { error: null, mensaje: accion === "aprobar" ? "Cierre aprobado y publicado." : "Cierre preparado." };
}

