"use server";

import { revalidatePath } from "next/cache";
import { exigirRol } from "@/lib/sesion";
import { crearClienteServidor } from "@/lib/supabase/server";

export type EstadoFicha = { error: string | null; mensaje: string | null };

const RFC = /^[A-ZÑ&]{3,4}[0-9]{6}[A-Z0-9]{3}$/;

/**
 * Cada acción llama a su función de la base, que revisa el rol: lo de
 * aquí es para devolver un mensaje entendible, no la única barda.
 */
async function llamar(personaId: string, fn: string, args: Record<string, unknown>, ok: string): Promise<EstadoFicha> {
  const supabase = await crearClienteServidor();
  const { error } = await supabase.rpc(fn, args);
  if (error) return { error: error.message || "No se pudo. Inténtalo otra vez.", mensaje: null };
  revalidatePath(`/admin/comisionistas/${personaId}`);
  revalidatePath("/admin/comisionistas");
  return { error: null, mensaje: ok };
}

export async function editarDatos(_previo: EstadoFicha, formData: FormData): Promise<EstadoFicha> {
  await exigirRol("admin_org", "finanzas");
  const id = String(formData.get("persona_id") ?? "");
  const rfc = String(formData.get("rfc") ?? "").trim().toUpperCase();
  if (rfc && !RFC.test(rfc)) return { error: "El RFC no tiene el formato correcto (12 o 13 caracteres).", mensaje: null };
  return llamar(id, "actualizar_comisionista", {
    p_persona: id,
    p_nombre: String(formData.get("nombre") ?? ""),
    p_telefono: String(formData.get("telefono") ?? ""),
    p_rfc: rfc,
    p_emite_factura: formData.get("emite_factura") === "on",
  }, "Datos guardados.");
}

export async function cambiarActivo(_previo: EstadoFicha, formData: FormData): Promise<EstadoFicha> {
  await exigirRol("admin_org", "finanzas");
  const id = String(formData.get("persona_id") ?? "");
  const activo = formData.get("activo") === "true";
  return llamar(id, "cambiar_activo_comisionista", { p_persona: id, p_activo: activo },
    activo ? "Activado: ya puede entrar al portal." : "Desactivado: ya no puede entrar. Lo que se le debe se le sigue pagando.");
}

export async function forzarElite(_previo: EstadoFicha, formData: FormData): Promise<EstadoFicha> {
  await exigirRol("admin_org");
  const id = String(formData.get("persona_id") ?? "");
  const quitar = formData.get("quitar") === "true";
  const pct = Number(String(formData.get("porcentaje") ?? "").replace(",", "."));
  if (!quitar && (!Number.isFinite(pct) || pct <= 0 || pct > 30)) {
    return { error: "El porcentaje va de más de 0 hasta 30 (el tope por trabajo).", mensaje: null };
  }
  return llamar(id, "forzar_elite", { p_persona: id, p_porcentaje: quitar ? null : pct },
    quitar ? "Quitado: vuelve a su nivel calculado." : `Élite al ${pct}%: aplica a lo que se devengue desde hoy.`);
}

export async function agregarMovimiento(_previo: EstadoFicha, formData: FormData): Promise<EstadoFicha> {
  await exigirRol("admin_org");
  const id = String(formData.get("persona_id") ?? "");
  const monto = Number(String(formData.get("monto") ?? "").replace(/[$,\s]/g, ""));
  if (!Number.isFinite(monto) || monto === 0) return { error: "Escribe el monto.", mensaje: null };
  return llamar(id, "agregar_movimiento", {
    p_comisionista: id,
    p_tipo: String(formData.get("tipo") ?? ""),
    p_monto: monto,
    p_cuenta: String(formData.get("cuenta") ?? "") || null,
    p_servicio: String(formData.get("servicio") ?? "") || null,
    p_nota: String(formData.get("nota") ?? ""),
  }, "Movimiento agregado al mes abierto.");
}
