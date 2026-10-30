"use server";

import { revalidatePath } from "next/cache";
import { exigirRol } from "@/lib/sesion";
import { crearClienteServidor } from "@/lib/supabase/server";

export type EstadoClabe = { error: string | null; mensaje: string | null };

/** La base valida la CLABE (dígito de control) y, si es la misma de quien lo invitó, anula ese vínculo. */
export async function guardarClabeCobro(_previo: EstadoClabe, formData: FormData): Promise<EstadoClabe> {
  await exigirRol("comisionista");
  const supabase = await crearClienteServidor();
  const { error } = await supabase.rpc("poner_mi_clabe_cobro", { p_clabe: String(formData.get("clabe") ?? "") });
  if (error) return { error: error.message || "No se pudo guardar la CLABE.", mensaje: null };
  revalidatePath("/perfil");
  return { error: null, mensaje: "CLABE guardada." };
}
