"use server";

import { revalidatePath } from "next/cache";
import { avisarAsignacion } from "@/lib/asignar";
import { carpetaDe, exigirPersona, exigirRol, ROLES_OPERACION } from "@/lib/sesion";
import { crearClienteServidor } from "@/lib/supabase/server";

/**
 * La base decide todo: que la cotización sea suya, que siga vigente y
 * que no se haya aceptado ya (`aceptar_cotizacion`). Aquí solo se
 * traduce el error.
 *
 * Con conector manual, la base le pone folio al volverse trámite; con
 * uno externo, queda en "Aceptada – folio en asignación" hasta que el
 * sistema externo lo dé.
 */
export async function aceptarCotizacion(
  _previo: { error: string | null },
  formData: FormData
): Promise<{ error: string | null }> {
  await exigirPersona();
  const cotizacion = String(formData.get("cotizacion") ?? "");
  if (formData.get("confirmo") !== "on") {
    return { error: "Marca la casilla para confirmar." };
  }

  const supabase = await crearClienteServidor();
  const { data: solicitud } = await supabase
    .from("cotizaciones")
    .select("solicitud_id")
    .eq("id", cotizacion)
    .maybeSingle();

  const { error } = await supabase.rpc("aceptar_cotizacion", { p_cotizacion: cotizacion });
  if (error) {
    const vencio = /venció|vigente/i.test(error.message);
    return {
      error: vencio
        ? "Esta cotización ya no está vigente. Pide una nueva a Administración."
        : "No se pudo aceptar. Inténtalo otra vez.",
    };
  }

  revalidatePath("/");
  if (solicitud?.solicitud_id) revalidatePath(`/trabajos/${solicitud.solicitud_id}`);
  return { error: null };
}

export type EstadoEstatus = { error: string | null; mensaje: string | null };

/**
 * Conector manual: admin_org (o el admin de la marca) mueve el estatus
 * de en medio. La base revisa rol, marca, conector y que el trabajo siga
 * en trámite; el cambio queda en el historial.
 */
export async function cambiarEstatus(_previo: EstadoEstatus, formData: FormData): Promise<EstadoEstatus> {
  await exigirPersona();
  const solicitud = String(formData.get("solicitud") ?? "");
  const supabase = await crearClienteServidor();
  const { error } = await supabase.rpc("cambiar_estatus_manual", {
    p_solicitud: solicitud,
    p_estatus: String(formData.get("estatus") ?? ""),
  });
  if (error) return { error: error.message || "No se pudo cambiar el estatus.", mensaje: null };
  revalidatePath(`/trabajos/${solicitud}`);
  return { error: null, mensaje: "Estatus actualizado. El comisionista ya lo ve." };
}

/** El honorario final de un estimado. La base valida rol, tipo, monto y motivo, y liquida si ya está cubierto. */
export async function fijarHonorarioFinal(
  _previo: { error: string | null },
  formData: FormData
): Promise<{ error: string | null }> {
  await exigirPersona();
  const solicitud = String(formData.get("solicitud") ?? "");
  const monto = Number(String(formData.get("final") ?? "").replace(/[$,\s]/g, ""));
  const supabase = await crearClienteServidor();
  const { error } = await supabase.rpc("fijar_honorario_final", {
    p_solicitud: solicitud,
    p_monto: Number.isFinite(monto) ? Math.round(monto * 100) / 100 : null,
    p_motivo: String(formData.get("motivo") ?? ""),
  });
  if (error) return { error: error.message };
  revalidatePath(`/trabajos/${solicitud}`);
  return { error: null };
}

/** "Ya lo entregué": el pago que recibió el comisionista ya está en la cuenta (con el comprobante del depósito). */
export async function entregarPago(_previo: EstadoEstatus, formData: FormData): Promise<EstadoEstatus> {
  const persona = await exigirPersona();
  const pago = String(formData.get("pago") ?? "");
  const solicitud = String(formData.get("solicitud") ?? "");
  const ruta = String(formData.get("entrega_ruta") ?? "") || null;
  if (ruta && !ruta.startsWith(`${carpetaDe(persona)}/`)) return { error: "El archivo no es válido. Súbelo otra vez.", mensaje: null };
  const supabase = await crearClienteServidor();
  const { error } = await supabase.rpc("marcar_pago_entregado", { p_pago: pago, p_ruta: ruta });
  if (error) return { error: error.message || "No se pudo guardar.", mensaje: null };
  revalidatePath(`/trabajos/${solicitud}`);
  revalidatePath("/admin/pagos");
  revalidatePath("/");
  return { error: null, mensaje: "Listo: Administración lo confirma cuando lo vea en la cuenta." };
}

/** Asignar o cambiar el comisionista de un trámite (admin_org; finanzas si Ajustes lo permite), con aviso por correo. */
export async function asignarComisionista(_previo: EstadoEstatus, formData: FormData): Promise<EstadoEstatus> {
  const persona = await exigirRol(...ROLES_OPERACION);
  const solicitud = String(formData.get("solicitud") ?? "");
  const comisionista = String(formData.get("comisionista") ?? "");
  const motivo = String(formData.get("motivo") ?? "").trim();
  if (!comisionista) return { error: "Elige el comisionista.", mensaje: null };
  const supabase = await crearClienteServidor();
  const { error } = await supabase.rpc("asignar_comisionista", { p_solicitud: solicitud, p_comisionista: comisionista, p_motivo: motivo });
  if (error) return { error: error.message || "No se pudo asignar.", mensaje: null };

  await avisarAsignacion(solicitud, persona.organizacion.slug);
  revalidatePath(`/trabajos/${solicitud}`);
  revalidatePath(`/admin/solicitudes/${solicitud}`);
  return { error: null, mensaje: "Asignado. Se le avisó por correo." };
}

/** "Genera comisión sí/no" por trámite, con motivo. */
export async function generaComision(_previo: EstadoEstatus, formData: FormData): Promise<EstadoEstatus> {
  await exigirRol(...ROLES_OPERACION);
  const solicitud = String(formData.get("solicitud") ?? "");
  const genera = formData.get("genera") === "si";
  const supabase = await crearClienteServidor();
  const { error } = await supabase.rpc("marcar_genera_comision", {
    p_solicitud: solicitud,
    p_genera: genera,
    p_motivo: String(formData.get("motivo") ?? "").trim(),
  });
  if (error) return { error: error.message || "No se pudo guardar.", mensaje: null };
  revalidatePath(`/trabajos/${solicitud}`);
  return { error: null, mensaje: genera ? "Vuelve a generar comisión." : "Ya no genera comisión." };
}
