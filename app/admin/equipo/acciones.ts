"use server";

import { revalidatePath } from "next/cache";
import { exigirRol } from "@/lib/sesion";
import { crearClienteServidor } from "@/lib/supabase/server";

export type EstadoEquipo = { error: string | null; mensaje: string | null };

/** `alta_membresia` reutiliza a la persona si el correo ya existe en otra organización. */
export async function altaMiembro(_previo: EstadoEquipo, formData: FormData): Promise<EstadoEquipo> {
  await exigirRol("admin_org");
  const supabase = await crearClienteServidor();
  const { error } = await supabase.rpc("alta_membresia", {
    p_nombre: String(formData.get("nombre") ?? "").trim(),
    p_correo: String(formData.get("correo") ?? "").trim(),
    p_rol: String(formData.get("rol") ?? ""),
    p_marcas: formData.getAll("marcas").map(String),
  });
  if (error) return { error: error.message || "No se pudo agregar. Inténtalo otra vez.", mensaje: null };
  revalidatePath("/admin/equipo");
  return { error: null, mensaje: "Agregado. Ya puede entrar con su correo." };
}

export async function cambiarActiva(_previo: EstadoEquipo, formData: FormData): Promise<EstadoEquipo> {
  await exigirRol("admin_org");
  const activa = formData.get("activa") === "true";
  const supabase = await crearClienteServidor();
  const { error } = await supabase.rpc("cambiar_activa_membresia", {
    p_membresia: String(formData.get("membresia") ?? ""),
    p_activa: activa,
  });
  if (error) return { error: error.message || "No se pudo. Inténtalo otra vez.", mensaje: null };
  revalidatePath("/admin/equipo");
  return { error: null, mensaje: activa ? "Activado." : "Desactivado: ya no entra a esta organización." };
}
