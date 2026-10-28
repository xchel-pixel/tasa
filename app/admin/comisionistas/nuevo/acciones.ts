"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { errorDeRfc, errorDeTelefono, limpiarRfc, limpiarTelefono } from "@/lib/limpiar";
import { exigirRol } from "@/lib/sesion";
import { crearClienteServidor } from "@/lib/supabase/server";

export type EstadoAlta = { error: string | null; mensaje: string | null };

/** Persona y comisionista nacen juntas en `alta_comisionista` (una sola transacción). */
export async function altaComisionista(_previo: EstadoAlta, formData: FormData): Promise<EstadoAlta> {
  await exigirRol("admin_org", "finanzas");
  const campo = (n: string) => String(formData.get(n) ?? "").trim();
  const rfc = limpiarRfc(campo("rfc"));
  const telefono = limpiarTelefono(campo("telefono"));
  const slug = campo("slug").toLowerCase();

  if (!campo("nombre")) return { error: "Falta el nombre.", mensaje: null };
  const errorDato = errorDeRfc(rfc) ?? errorDeTelefono(telefono);
  if (errorDato) return { error: errorDato, mensaje: null };
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
  });
  // Los mensajes de la base ya están escritos para leerse ("Ese correo ya está dado de alta").
  if (error) return { error: error.message || "No se pudo dar de alta. Inténtalo otra vez.", mensaje: null };

  revalidatePath("/admin/comisionistas");
  redirect(`/admin/comisionistas/${data as string}`);
}
