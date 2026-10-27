"use server";

import { revalidatePath } from "next/cache";
import { pesos } from "@/lib/formato";
import { exigirRol } from "@/lib/sesion";
import { crearClienteServidor } from "@/lib/supabase/server";

export type EstadoPagoComision = { error: string | null; mensaje: string | null };

/**
 * `registrar_pago_comision` hace todo en una transacción: el pago, lo que
 * cubre de cada pendiente y, si alguno queda completo, marca sus
 * comisiones como pagadas. Revisa saldos, dueño y fecha.
 */
export async function registrarPagoComision(_previo: EstadoPagoComision, formData: FormData): Promise<EstadoPagoComision> {
  await exigirRol("super_admin", "finanzas");
  const comisionista = String(formData.get("comisionista_id") ?? "");
  const documento = String(formData.get("documento") ?? "");
  let aplicaciones: { pendiente_id: string; monto: number }[];
  try {
    aplicaciones = JSON.parse(String(formData.get("aplicaciones") ?? "[]"));
  } catch {
    return { error: "No se entendió qué cubre el pago. Recarga la página.", mensaje: null };
  }
  if (aplicaciones.length === 0) return { error: "Elige al menos un mes.", mensaje: null };
  if (aplicaciones.some((a) => !Number.isFinite(a.monto) || a.monto <= 0)) {
    return { error: "Cada monto aplicado tiene que ser mayor que cero.", mensaje: null };
  }
  if (!["factura", "recibo", "ninguno"].includes(documento)) return { error: "Elige el documento.", mensaje: null };

  const supabase = await crearClienteServidor();
  const { error } = await supabase.rpc("registrar_pago_comision", {
    p_comisionista: comisionista,
    p_fecha: String(formData.get("fecha") ?? ""),
    p_origen: String(formData.get("origen") ?? ""),
    p_referencia: String(formData.get("referencia") ?? ""),
    p_comprobante: String(formData.get("comprobante_ruta") ?? "") || null,
    p_documento: documento,
    p_nota: String(formData.get("nota") ?? ""),
    p_aplicaciones: aplicaciones,
  });
  if (error) return { error: error.message || "No se pudo registrar. Inténtalo otra vez.", mensaje: null };

  revalidatePath("/admin/comisiones");
  revalidatePath(`/admin/comisionistas/${comisionista}`);
  revalidatePath("/");
  const total = aplicaciones.reduce((s, a) => s + a.monto, 0);
  return { error: null, mensaje: `Pago registrado por ${pesos(total)}. El comisionista ya lo ve en su estado de cuenta.` };
}
