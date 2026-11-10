"use server";

import { revalidatePath } from "next/cache";
import { exigirRol } from "@/lib/sesion";
import { crearClienteServidor } from "@/lib/supabase/server";

/** Paquetes (0077): finanzas o admin_org confirman el pago (la base revisa monto, fecha y cuenta) o cancelan la compra. */

export type EstadoConfirmar = { error: string | null; mensaje: string | null };

export async function confirmarCompra(_p: EstadoConfirmar, f: FormData): Promise<EstadoConfirmar> {
  await exigirRol("admin_org", "finanzas");
  const monto = Number(String(f.get("monto") ?? "").split(",").join(""));
  if (!Number.isFinite(monto) || monto <= 0) return { error: "Escribe el monto recibido.", mensaje: null };
  const supabase = await crearClienteServidor();
  const { error } = await supabase.rpc("confirmar_compra_paquete", {
    p_compra: String(f.get("compra") ?? ""), p_monto: monto, p_fecha: String(f.get("fecha") ?? ""), p_cuenta: String(f.get("cuenta") ?? ""),
    p_referencia: String(f.get("referencia") ?? ""), p_cfdi: String(f.get("cfdi") ?? ""),
  });
  if (error) return { error: error.message || "No se pudo confirmar.", mensaje: null };
  revalidatePath("/admin/paquetes");
  return { error: null, mensaje: "Pago confirmado: el crédito ya está cargado." };
}

export async function cancelarCompraAdmin(_p: EstadoConfirmar, f: FormData): Promise<EstadoConfirmar> {
  await exigirRol("admin_org", "finanzas");
  const supabase = await crearClienteServidor();
  const { error } = await supabase.rpc("cancelar_compra_paquete", { p_compra: String(f.get("compra") ?? ""), p_motivo: String(f.get("motivo") ?? "") });
  if (error) return { error: error.message || "No se pudo cancelar.", mensaje: null };
  revalidatePath("/admin/paquetes");
  return { error: null, mensaje: "Compra cancelada." };
}

/** Desde el detalle del trámite: aplicar crédito (la base calcula el máximo y el saldo). */
export async function aplicarCredito(_p: EstadoConfirmar, f: FormData): Promise<EstadoConfirmar> {
  await exigirRol("admin_org", "finanzas");
  const solicitud = String(f.get("solicitud") ?? "");
  const texto = String(f.get("monto") ?? "").split(",").join("").trim();
  const monto = texto ? Number(texto) : null;
  if (monto !== null && (!Number.isFinite(monto) || monto <= 0)) return { error: "El monto tiene que ser mayor que cero.", mensaje: null };
  const supabase = await crearClienteServidor();
  const { data, error } = await supabase.rpc("aplicar_credito", { p_solicitud: solicitud, p_monto: monto });
  if (error) return { error: error.message || "No se pudo aplicar.", mensaje: null };
  revalidatePath(`/trabajos/${solicitud}`);
  return { error: null, mensaje: `Se aplicaron $${Number(data).toLocaleString("es-MX", { minimumFractionDigits: 2 })} de crédito.` };
}
