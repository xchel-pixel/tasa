"use server";

import { revalidatePath } from "next/cache";
import { errorDeRfc, errorDeTelefono, limpiarRfc, limpiarTelefono } from "@/lib/limpiar";
import { exigirRol } from "@/lib/sesion";
import { crearClienteServidor } from "@/lib/supabase/server";

/**
 * Finanzas (o admin_org) captura una solicitud en nombre de alguien. Si
 * el dígito del RFC no cuadra se captura igual: la base la marca "RFC
 * por revisar" y solo admin_org decide.
 */
export async function capturarAlta(formData: FormData): Promise<{ error: string | null; id?: string; carpeta?: string }> {
  const persona = await exigirRol("admin_org", "finanzas");
  const campo = (n: string) => String(formData.get(n) ?? "").trim();
  const rfc = limpiarRfc(campo("rfc"));
  const telefono = limpiarTelefono(campo("telefono"));
  if (!campo("nombre")) return { error: "Falta el nombre." };
  if (!telefono) return { error: "Falta el teléfono." };
  const formato = errorDeTelefono(telefono) ?? errorDeRfc(rfc, { obligatorio: true, revisadoAMano: true });
  if (formato) return { error: formato };

  const supabase = await crearClienteServidor();
  const { data, error } = await supabase.rpc("capturar_alta", {
    p_nombre: campo("nombre"),
    p_correo: campo("correo"),
    p_telefono: telefono,
    p_rfc: rfc,
    p_ref: campo("ref") || null,
  });
  if (error) return { error: error.message || "No se pudo capturar. Inténtalo otra vez." };
  return { error: null, id: data as string, carpeta: persona.organizacion.id };
}

export async function confirmarCaptura(id: string): Promise<{ error: string | null }> {
  await exigirRol("admin_org", "finanzas");
  const supabase = await crearClienteServidor();
  const { error } = await supabase.rpc("confirmar_alta", { p_id: id });
  if (error) return { error: error.message || "No se pudo terminar la captura." };
  revalidatePath("/admin/altas");
  revalidatePath("/");
  return { error: null };
}
