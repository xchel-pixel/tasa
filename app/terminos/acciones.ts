"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { obtenerSesion } from "@/lib/sesion";
import { crearClienteServidor } from "@/lib/supabase/server";

export type EstadoTerminos = { error: string | null };

/**
 * Acepta la versión que la persona tuvo en pantalla. Si el texto cambió
 * mientras lo leía, la base la rechaza y se le muestra el nuevo.
 */
export async function aceptarTerminos(_previo: EstadoTerminos, formData: FormData): Promise<EstadoTerminos> {
  const sesion = await obtenerSesion();
  if (!sesion?.persona) redirect("/");
  if (formData.get("acepto") !== "on") return { error: "Marca la casilla para aceptar." };

  const version = Number(formData.get("version"));
  const supabase = await crearClienteServidor();
  const { error } = await supabase.rpc("aceptar_terminos", { p_version: version });
  if (error) {
    if (error.message.includes("cambiaron")) {
      revalidatePath("/terminos");
      return { error: "Los términos se actualizaron mientras los leías. Revisa el texto nuevo y vuelve a aceptar." };
    }
    console.error(`[tasa] No se pudieron aceptar los términos: ${error.message}`);
    return { error: "No se pudo guardar. Inténtalo otra vez." };
  }

  revalidatePath("/", "layout");
  redirect("/");
}
