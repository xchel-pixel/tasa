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

/**
 * Bono de referido por persona del equipo: interruptor, % fijo (obligatorio al activar; el equipo no usa la escala) y
 * "vigente hasta". Solo cuenta si la organización también lo tiene encendido. La bitácora la deja la base.
 */
export async function cambiarBonoReferido(_previo: EstadoEquipo, formData: FormData): Promise<EstadoEquipo> {
  await exigirRol("admin_org");
  const activo = formData.get("activo") === "on";
  const textoPct = String(formData.get("pct") ?? "").trim().replace(",", ".");
  const pct = textoPct === "" ? null : Number(textoPct);
  if (activo && pct === null) return { error: "Escribe el % de bono (de 0 a 5) para activarlo.", mensaje: null };
  if (pct !== null && (!/^\d+(\.\d{1,2})?$/.test(textoPct) || pct > 5)) {
    return { error: "El % de bono va de 0 a 5, con hasta dos decimales.", mensaje: null };
  }
  const hasta = String(formData.get("hasta") ?? "").trim() || null;
  const supabase = await crearClienteServidor();
  const { error } = await supabase.rpc("poner_bono_referido_miembro", {
    p_membresia: String(formData.get("membresia") ?? ""),
    p_activo: activo,
    p_pct: pct,
    p_hasta: hasta,
  });
  if (error) return { error: error.message || "No se pudo. Inténtalo otra vez.", mensaje: null };
  revalidatePath("/admin/equipo");
  revalidatePath("/");
  if (!activo) return { error: null, mensaje: "Sin bono de referido." };
  return {
    error: null,
    mensaje: `Bono de referido: ${pct}%${hasta ? `, vigente hasta ${hasta}` : ""}.`,
  };
}

/** El nombre con el que lo ven los demás (comisionistas, liga pública, panel). Vacío: su nombre real. */
export async function ponerNombreParaMostrar(_previo: EstadoEquipo, formData: FormData): Promise<EstadoEquipo> {
  await exigirRol("admin_org");
  const nombre = String(formData.get("nombre_para_mostrar") ?? "").trim();
  if (nombre.length > 60) return { error: "Máximo 60 caracteres.", mensaje: null };
  const supabase = await crearClienteServidor();
  const { error } = await supabase.rpc("poner_nombre_para_mostrar", { p_persona: String(formData.get("persona") ?? ""), p_nombre: nombre });
  if (error) return { error: error.message || "No se pudo. Inténtalo otra vez.", mensaje: null };
  revalidatePath("/admin/equipo");
  revalidatePath("/");
  return { error: null, mensaje: nombre ? `Se mostrará como "${nombre}".` : "Se mostrará con su nombre real." };
}
