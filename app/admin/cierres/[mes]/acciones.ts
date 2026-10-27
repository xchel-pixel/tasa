"use server";

import { revalidatePath } from "next/cache";
import { exigirRol } from "@/lib/sesion";
import { crearClienteServidor } from "@/lib/supabase/server";

export type EstadoCierre = { error: string | null; mensaje: string | null };

const ruta = (mes: string) => `/admin/cierres/${mes.slice(0, 7)}`;

/**
 * Preparar (finanzas o super_admin) y aprobar (solo super_admin). Las
 * funciones de la base revisan el rol, que el mes haya terminado, el
 * orden de los meses y bloquean el cierre al aprobar.
 */
export async function moverCierre(_previo: EstadoCierre, formData: FormData): Promise<EstadoCierre> {
  const accion = String(formData.get("accion") ?? "");
  const mes = String(formData.get("mes") ?? "");
  await exigirRol(...(accion === "aprobar" ? (["super_admin"] as const) : (["super_admin", "finanzas"] as const)));

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

/** Marca como pagadas las comisiones de un comisionista en un mes aprobado. */
export async function marcarPagadas(_previo: EstadoCierre, formData: FormData): Promise<EstadoCierre> {
  await exigirRol("super_admin", "finanzas");
  const mes = String(formData.get("mes") ?? "");
  const comisionista = String(formData.get("comisionista") ?? "");
  const fecha = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City" }).format(new Date());

  const supabase = await crearClienteServidor();
  const { error } = await supabase
    .from("comisiones")
    .update({ estado: "pagada", pagada_en: fecha })
    .eq("mes", mes)
    .eq("comisionista_id", comisionista)
    .eq("estado", "devengada");
  if (error) return { error: "No se pudo marcar como pagado. Inténtalo otra vez.", mensaje: null };

  revalidatePath(ruta(mes));
  return { error: null, mensaje: "Marcado como pagado." };
}
