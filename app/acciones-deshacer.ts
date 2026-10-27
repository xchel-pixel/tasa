"use server";

import { revalidatePath } from "next/cache";
import { exigirPersona } from "@/lib/sesion";
import { crearClienteServidor } from "@/lib/supabase/server";

export type EstadoDeshacer = { error: string | null; mensaje: string | null };

/**
 * Todos los "deshacer" pasan por aquí: cada uno es una función de la
 * base que revisa rol, organización, estado y mes cerrado, exige el
 * motivo y lo deja en la bitácora y en el historial del trabajo. Aquí
 * solo se elige cuál, de una lista cerrada.
 */
const ACCIONES = {
  revertir_pago: { fn: "revertir_pago", param: "p_pago", ok: "Listo: el pago volvió a \"Por confirmar\"." },
  retirar_pago: { fn: "retirar_pago", param: "p_pago", ok: "Pago retirado." },
  anular_cotizacion: { fn: "anular_cotizacion", param: "p_cotizacion", ok: "Cotización anulada: la solicitud vuelve a por cotizar." },
  cancelar_solicitud: { fn: "cancelar_mi_solicitud", param: "p_solicitud", ok: "Solicitud cancelada." },
  anular_pago_comision: { fn: "anular_pago_comision", param: "p_pago", ok: "Pago de comisión anulado: el pendiente recuperó su saldo." },
  anular_movimiento: { fn: "anular_movimiento", param: "p_comision", ok: "Movimiento anulado: entró su contrario en el mismo mes." },
} as const;

export type AccionDeshacer = keyof typeof ACCIONES;

export async function deshacer(_previo: EstadoDeshacer, formData: FormData): Promise<EstadoDeshacer> {
  await exigirPersona();
  const que = String(formData.get("que") ?? "") as AccionDeshacer;
  const accion = ACCIONES[que];
  if (!accion) return { error: "Acción no válida.", mensaje: null };
  const motivo = String(formData.get("motivo") ?? "").trim();
  if (!motivo) return { error: "Escribe el motivo.", mensaje: null };

  const supabase = await crearClienteServidor();
  const { error } = await supabase.rpc(accion.fn, { [accion.param]: String(formData.get("id") ?? ""), p_motivo: motivo });
  if (error) return { error: error.message || "No se pudo. Inténtalo otra vez.", mensaje: null };

  revalidatePath("/", "layout");
  return { error: null, mensaje: accion.ok };
}
