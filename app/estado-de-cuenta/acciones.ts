"use server";

import { revalidatePath } from "next/cache";
import { exigirRol } from "@/lib/sesion";
import { crearClienteServidor } from "@/lib/supabase/server";

export type EstadoFactura = { error: string | null; mensaje: string | null };

/** La base comprueba que el pendiente sea suyo y la ruta, de su carpeta. */
export async function subirFactura(_previo: EstadoFactura, formData: FormData): Promise<EstadoFactura> {
  await exigirRol("comisionista");
  const pendiente = String(formData.get("pendiente_id") ?? "");
  const ruta = String(formData.get("factura_ruta") ?? "");
  if (!ruta) return { error: "Sube el archivo primero.", mensaje: null };

  const supabase = await crearClienteServidor();
  const { error } = await supabase.rpc("subir_factura_comision", { p_pendiente: pendiente, p_ruta: ruta });
  if (error) return { error: error.message || "No se pudo guardar. Inténtalo otra vez.", mensaje: null };

  revalidatePath("/estado-de-cuenta");
  return { error: null, mensaje: "Listo: Administración ya tiene tu factura." };
}
