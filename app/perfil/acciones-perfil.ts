"use server";

import { revalidatePath } from "next/cache";
import { exigirRol } from "@/lib/sesion";
import { crearClienteServidor } from "@/lib/supabase/server";

export type EstadoPerfil = { error: string | null; mensaje: string | null };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** De la lista se aplica de inmediato; "Otro" queda por aprobar (la base valida y avisa a admin_org). */
export async function guardarMiPerfil(_previo: EstadoPerfil, formData: FormData): Promise<EstadoPerfil> {
  await exigirRol("comisionista");
  const perfil = String(formData.get("perfil") ?? "");
  const otro = perfil === "otro" ? String(formData.get("otro") ?? "").trim() : null;
  const supabase = await crearClienteServidor();
  const { data, error } = await supabase.rpc("guardar_mi_perfil", { p_perfil: UUID.test(perfil) ? perfil : null, p_otro: otro });
  if (error) return { error: error.message || "No se pudo guardar tu perfil.", mensaje: null };
  revalidatePath("/perfil");
  revalidatePath("/tarjeta");
  return {
    error: null,
    mensaje: data === "pendiente" ? "Listo: Administración lo revisa antes de que salga en tu tarjeta." : data === "igual" ? "Ya era tu perfil." : "Perfil guardado.",
  };
}
