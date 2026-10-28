"use server";

import { revalidatePath } from "next/cache";
import { exigirRol } from "@/lib/sesion";
import { crearClienteServidor } from "@/lib/supabase/server";

/** El comisionista con "CSF pendiente" ya subió su constancia: queda registrada. */
export async function registrarMiCsf(ruta: string): Promise<{ error: string | null }> {
  await exigirRol("comisionista");
  const supabase = await crearClienteServidor();
  const { error } = await supabase.rpc("subir_mi_csf", { p_ruta: ruta });
  if (error) return { error: error.message || "No se pudo guardar la constancia." };
  revalidatePath("/");
  return { error: null };
}
