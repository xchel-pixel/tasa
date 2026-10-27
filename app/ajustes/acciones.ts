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
  const dia = Number(formData.get("dia_limite_pago_comision"));
  if (contacto.length > 120) {
    return { mensaje: null, error: "Máximo 120 caracteres." };
  }
  if (!Number.isInteger(dia) || dia < 1 || dia > 28) {
    return { mensaje: null, error: "El día límite va del 1 al 28." };
  }

  const supabase = await crearClienteServidor();
  const { error, count } = await supabase
    .from("ajustes")
    .update(
      { contacto_soporte: contacto || null, dia_limite_pago_comision: dia, actualizado_en: new Date().toISOString() },
      { count: "exact" }
    )
    .eq("id", true);

  // Un update que el RLS no deja pasar no truena: toca cero filas.
  if (error || count !== 1) {
    return { mensaje: null, error: "No se pudo guardar. Inténtalo otra vez." };
  }

  revalidatePath("/ajustes");
  revalidatePath("/");
  return {
    mensaje: contacto ? "Guardado." : "Guardado. No se mostrará contacto.",
    error: null,
  };
}

/** Catálogo de orígenes del dinero para pagar comisiones. No se borran: se apagan. */
export async function guardarOrigen(_previo: EstadoAjustes, formData: FormData): Promise<EstadoAjustes> {
  await exigirRol("super_admin");
  const id = String(formData.get("id") ?? "");
  const nombre = String(formData.get("nombre") ?? "").trim();
  if (!nombre || nombre.length > 40) return { mensaje: null, error: "El nombre va de 1 a 40 caracteres." };

  const supabase = await crearClienteServidor();
  const { error } = id
    ? await supabase.from("origenes_pago").update({ nombre, activo: formData.get("activo") === "on" }).eq("id", id)
    : await supabase.from("origenes_pago").insert({ nombre, orden: 99 });
  if (error) {
    return { mensaje: null, error: error.code === "23505" ? "Ya existe un origen con ese nombre." : "No se pudo guardar." };
  }
  revalidatePath("/ajustes");
  return { mensaje: id ? "Guardado." : "Agregado.", error: null };
}
