"use server";

import { revalidatePath } from "next/cache";
import { exigirRol } from "@/lib/sesion";
import { crearClienteServidor } from "@/lib/supabase/server";

/** "Mis paquetes" (0077): la base revisa todo (rol, términos vigentes, una compra por pagar, subida en 30 días…). */

export type EstadoPaquete = { error: string | null; mensaje: string | null };

const falla = (error: string): EstadoPaquete => ({ error, mensaje: null });

export async function pedirPaquete(_p: EstadoPaquete, f: FormData): Promise<EstadoPaquete> {
  await exigirRol("comisionista");
  if (f.get("acepto") !== "on") return falla("Para comprar, acepta los términos del paquete.");
  const tipo = String(f.get("tipo") ?? "");
  const conComision = f.get("forma") === "comision";
  const supabase = await crearClienteServidor();
  const { error } = conComision
    ? await supabase.rpc("comprar_paquete_con_comision", { p_paquete: String(f.get("paquete") ?? ""), p_terminos: Number(f.get("terminos")) })
    : await supabase.rpc("pedir_paquete", { p_paquete: String(f.get("paquete") ?? ""), p_tipo: tipo, p_terminos: Number(f.get("terminos")) });
  if (error) return falla(error.message || "No se pudo.");
  revalidatePath("/paquetes");
  return {
    error: null,
    mensaje: conComision
      ? "Listo: compraste el paquete con tu comisión y tu crédito ya está cargado."
      : "Listo: transfiere el monto a la cuenta de abajo. Tu crédito se carga cuando Administración confirme el pago.",
  };
}

export async function cancelarCompra(_p: EstadoPaquete, f: FormData): Promise<EstadoPaquete> {
  await exigirRol("comisionista");
  const supabase = await crearClienteServidor();
  const { error } = await supabase.rpc("cancelar_compra_paquete", { p_compra: String(f.get("compra") ?? ""), p_motivo: "La canceló el comisionista" });
  if (error) return falla(error.message || "No se pudo.");
  revalidatePath("/paquetes");
  return { error: null, mensaje: "Compra cancelada." };
}
