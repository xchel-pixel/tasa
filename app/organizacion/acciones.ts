"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { crearClienteServidor } from "@/lib/supabase/server";

/** La base revisa que de verdad pertenezca (o que sea la plataforma). */
export async function elegirOrganizacion(formData: FormData) {
  const supabase = await crearClienteServidor();
  const { error } = await supabase.rpc("elegir_organizacion", { p_org: String(formData.get("organizacion") ?? "") });
  if (error) {
    console.error(`[tasa] No se pudo cambiar de organización: ${error.message}`);
    redirect("/organizacion");
  }
  revalidatePath("/", "layout");
  redirect("/");
}
