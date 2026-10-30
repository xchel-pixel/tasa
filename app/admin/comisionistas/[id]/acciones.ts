"use server";

import { revalidatePath } from "next/cache";
import { errorDeRfc, errorDeTelefono, limpiarRfc, limpiarTelefono } from "@/lib/limpiar";
import { exigirRol } from "@/lib/sesion";
import { crearClienteServidor } from "@/lib/supabase/server";

export type EstadoFicha = { error: string | null; mensaje: string | null };

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
  const rfc = limpiarRfc(String(formData.get("rfc") ?? ""));
  const telefono = limpiarTelefono(String(formData.get("telefono") ?? ""));
  // Un RFC revisado a mano se puede dejar como está; si se cambia, el nuevo tiene que cuadrar.
  const { data: actual } = await (await crearClienteServidor())
    .from("comisionistas")
    .select("rfc, curp, rfc_revisado_a_mano")
    .eq("persona_id", id)
    .maybeSingle()
    .returns<{ rfc: string | null; curp: string | null; rfc_revisado_a_mano: boolean } | null>();
  const revisadoAMano = Boolean(actual?.rfc_revisado_a_mano && actual.rfc === rfc);
  const error = errorDeRfc(rfc, { obligatorio: !actual?.curp, revisadoAMano }) ?? errorDeTelefono(telefono);
  if (error) return { error, mensaje: null };
  return llamar(id, "actualizar_comisionista", {
    p_persona: id,
    p_nombre: String(formData.get("nombre") ?? ""),
    p_telefono: telefono,
    p_rfc: rfc,
    p_emite_factura: formData.get("emite_factura") === "on",
  }, "Datos guardados.");
}

/** "Referido por" a mano (llegó sin liga o se equivocaron). La base revisa ciclos y deja el motivo en bitácora. */
export async function corregirReferidor(_previo: EstadoFicha, formData: FormData): Promise<EstadoFicha> {
  await exigirRol("admin_org");
  const id = String(formData.get("persona_id") ?? "");
  const referidor = String(formData.get("referido_por") ?? "") || null;
  return llamar(id, "asignar_referidor", {
    p_persona: id,
    p_referidor: referidor,
    p_motivo: String(formData.get("motivo") ?? ""),
  }, referidor ? "Guardado: queda referido desde hoy." : "Quitado: ya no tiene referidor.");
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
  const vence = String(formData.get("vence") ?? "") || null;
  return llamar(id, "forzar_elite", { p_persona: id, p_porcentaje: quitar ? null : pct, p_vence: quitar ? null : vence },
    quitar
      ? "Quitado: vuelve a su nivel calculado."
      : `Élite al ${pct}%${vence ? ` hasta el mes de ${vence}` : ""}: aplica a lo que se devengue desde hoy.`);
}

/** Bienvenida desde este mes, o quitarla. Los meses los respeta la base solo si es admin_org. */
export async function ponerBienvenida(_previo: EstadoFicha, formData: FormData): Promise<EstadoFicha> {
  await exigirRol("admin_org", "finanzas");
  const id = String(formData.get("persona_id") ?? "");
  if (formData.get("quitar") === "true") {
    return llamar(id, "poner_trato_inicial", { p_persona: id, p_trato: null, p_meses: null, p_desde: null },
      "Tasa de bienvenida quitada: su nivel sale del promedio desde el siguiente cierre.");
  }
  if (formData.get("bienvenida") !== "on") return { error: "Marca la casilla de tasa de bienvenida.", mensaje: null };
  const meses = formData.get("meses_bienvenida") ? Number(formData.get("meses_bienvenida")) : null;
  return llamar(id, "poner_trato_inicial", { p_persona: id, p_trato: "bienvenida", p_meses: meses, p_desde: null },
    "Tasa de bienvenida puesta desde este mes.");
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

/** Ampliar, acortar o quitar la vigencia del bono de un referido. La base exige admin_org y motivo. */
export async function cambiarVinculo(_previo: EstadoFicha, formData: FormData): Promise<EstadoFicha> {
  await exigirRol("admin_org");
  const supabase = await crearClienteServidor();
  const accion = String(formData.get("accion") ?? "");
  const { error } = await supabase.rpc("cambiar_vinculo", {
    p_vinculo: String(formData.get("vinculo") ?? ""),
    p_accion: accion,
    p_fin: accion === "quitar" ? null : String(formData.get("fin") ?? "") || null,
    p_motivo: String(formData.get("motivo") ?? ""),
  });
  if (error) return { error: error.message || "No se pudo cambiar.", mensaje: null };
  revalidatePath(`/admin/comisionistas/${String(formData.get("persona") ?? "")}`);
  return { error: null, mensaje: accion === "quitar" ? "Bono quitado." : "Vigencia cambiada." };
}
