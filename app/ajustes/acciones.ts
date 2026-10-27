"use server";

import { revalidatePath } from "next/cache";
import { exigirRol } from "@/lib/sesion";
import { crearClienteServidor } from "@/lib/supabase/server";

export type EstadoAjustes = { mensaje: string | null; error: string | null };

export async function guardarAjustes(
  _previo: EstadoAjustes,
  formData: FormData
): Promise<EstadoAjustes> {
  await exigirRol("super_admin");

  const contacto = String(formData.get("contacto_soporte") ?? "").trim();
  if (contacto.length > 120) {
    return { mensaje: null, error: "Máximo 120 caracteres." };
  }

  const supabase = await crearClienteServidor();
  const { error, count } = await supabase
    .from("ajustes")
    .update({ contacto_soporte: contacto || null, actualizado_en: new Date().toISOString() }, { count: "exact" })
    .eq("id", true);

  // Un update que el RLS no deja pasar no truena: toca cero filas.
  if (error || count !== 1) {
    return { mensaje: null, error: "No se pudo guardar. Inténtalo otra vez." };
  }

  revalidatePath("/ajustes");
  return {
    mensaje: contacto ? "Guardado." : "Guardado. No se mostrará contacto.",
    error: null,
  };
}
