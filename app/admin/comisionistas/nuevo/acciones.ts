"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { errorDeRfc, errorDeTelefono, limpiarRfc, limpiarTelefono } from "@/lib/limpiar";
import { exigirRol } from "@/lib/sesion";
import { crearClienteServidor } from "@/lib/supabase/server";

export type EstadoAlta = { error: string | null; mensaje: string | null };

/**
 * Persona y comisionista nacen juntas en `alta_comisionista` (una sola
 * transacción). Solo admin_org: finanzas captura una solicitud de alta.
 * RFC obligatorio; CSF o "CSF pendiente" (la sube él desde su inicio).
 */
export async function altaComisionista(_previo: EstadoAlta, formData: FormData): Promise<EstadoAlta> {
  await exigirRol("admin_org");
  const campo = (n: string) => String(formData.get(n) ?? "").trim();
  const rfc = limpiarRfc(campo("rfc"));
  const telefono = limpiarTelefono(campo("telefono"));
  const slug = campo("slug").toLowerCase();
  const csf = campo("csf_ruta") || null;
  const revisado = formData.get("rfc_revisado") === "on";

  if (!campo("nombre")) return { error: "Falta el nombre.", mensaje: null };
  const errorDato = errorDeRfc(rfc, { obligatorio: true, revisadoAMano: revisado }) ?? errorDeTelefono(telefono);
  if (errorDato) return { error: errorDato, mensaje: null };
  if (!csf && formData.get("csf_pendiente") !== "on") {
    return { error: "Sube su constancia (CSF) o marca \"CSF pendiente\".", mensaje: null };
  }
  if (revisado && !csf) return { error: "Con \"RFC revisado a mano\" hace falta la constancia.", mensaje: null };
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) return { error: "La liga solo lleva minúsculas, números y guiones.", mensaje: null };

  const supabase = await crearClienteServidor();
  const { data, error } = await supabase.rpc("alta_comisionista", {
    p_nombre: campo("nombre"),
    p_correo: campo("correo"),
    p_telefono: telefono,
    p_rfc: rfc,
    p_slug: slug,
    p_referido_por: campo("referido_por") || null,
    p_emite_factura: formData.get("emite_factura") === "on",
    p_bienvenida: formData.get("bienvenida") === "on",
    // La base solo respeta los meses si quien da el alta es admin_org.
    p_meses_bienvenida: formData.get("meses_bienvenida") ? Number(formData.get("meses_bienvenida")) : null,
    p_csf_ruta: csf,
    p_rfc_revisado: revisado,
  });
  // Los mensajes de la base ya están escritos para leerse ("Ese correo ya está dado de alta").
  if (error) return { error: error.message || "No se pudo dar de alta. Inténtalo otra vez.", mensaje: null };

  revalidatePath("/admin/comisionistas");
  redirect(`/admin/comisionistas/${data as string}`);
}
