"use server";

import { revalidatePath } from "next/cache";
import { bienvenidaDe, mandarCorreoDeAlta, rechazoDe } from "@/lib/altas";
import { slugLibre } from "@/lib/importar-comisionistas";
import { exigirRol } from "@/lib/sesion";
import { crearClienteServidor } from "@/lib/supabase/server";

export type EstadoDecision = { error: string | null; mensaje: string | null };

function refrescar(id: string) {
  revalidatePath(`/admin/altas/${id}`);
  revalidatePath("/admin/altas");
  revalidatePath("/admin/comisionistas");
  revalidatePath("/");
}

/**
 * Aprobar crea persona, membresía y comisionista (con su trato inicial)
 * en una sola transacción de la base; después sale el correo. Si el
 * correo falla, la aprobación se queda: la pantalla lo dice y ofrece el
 * mensaje para WhatsApp.
 */
export async function aprobarAlta(_previo: EstadoDecision, formData: FormData): Promise<EstadoDecision> {
  const persona = await exigirRol("admin_org");
  const id = String(formData.get("id") ?? "");
  const supabase = await crearClienteServidor();

  const [{ data: solicitud }, { data: existentes }] = await Promise.all([
    supabase.from("solicitudes_alta").select("nombre").eq("id", id).maybeSingle().returns<{ nombre: string } | null>(),
    supabase.from("comisionistas").select("slug").returns<{ slug: string }[]>(),
  ]);
  if (!solicitud) return { error: "No existe esa solicitud.", mensaje: null };

  const { data: personaId, error } = await supabase.rpc("aprobar_alta", {
    p_id: id,
    p_slug: slugLibre(solicitud.nombre, new Set((existentes ?? []).map((c) => c.slug))),
    p_emite_factura: formData.get("emite_factura") === "on",
    p_bienvenida: formData.get("bienvenida") === "on",
    p_meses_bienvenida: formData.get("meses_bienvenida") ? Number(formData.get("meses_bienvenida")) : null,
    p_rfc_revisado: formData.get("rfc_revisado") === "on",
  });
  if (error) return { error: error.message || "No se pudo aprobar. Inténtalo otra vez.", mensaje: null };

  const correo = await bienvenidaDe(supabase, personaId as string);
  const falla = await mandarCorreoDeAlta(supabase, { solicitudId: id, para: correo.para, correo, slug: persona.organizacion.slug });
  refrescar(id);
  return falla
    ? { error: `Aprobada, pero el correo no salió: ${falla} Mándale el mensaje por WhatsApp.`, mensaje: null }
    : { error: null, mensaje: `Aprobada. Le mandamos la bienvenida a ${correo.para}.` };
}

export async function rechazarAlta(_previo: EstadoDecision, formData: FormData): Promise<EstadoDecision> {
  const persona = await exigirRol("admin_org");
  const id = String(formData.get("id") ?? "");
  const motivo = String(formData.get("motivo") ?? "").trim();
  if (motivo.length > 500) return { error: "El motivo va hasta 500 caracteres.", mensaje: null };
  const supabase = await crearClienteServidor();

  const { error } = await supabase.rpc("rechazar_alta", { p_id: id, p_motivo: motivo || null });
  if (error) return { error: error.message || "No se pudo rechazar. Inténtalo otra vez.", mensaje: null };

  const { data: s } = await supabase
    .from("solicitudes_alta")
    .select("nombre, correo, motivo")
    .eq("id", id)
    .maybeSingle()
    .returns<{ nombre: string; correo: string; motivo: string | null } | null>();
  const falla = s
    ? await mandarCorreoDeAlta(supabase, { solicitudId: id, para: s.correo, correo: await rechazoDe(supabase, s), slug: persona.organizacion.slug })
    : "No se encontró la solicitud.";
  refrescar(id);
  return falla
    ? { error: `Rechazada, pero el correo no salió: ${falla}`, mensaje: null }
    : { error: null, mensaje: "Rechazada. Le avisamos por correo." };
}

/** Otro intento del correo que no salió (bienvenida o rechazo, según la solicitud). */
export async function reintentarCorreo(_previo: EstadoDecision, formData: FormData): Promise<EstadoDecision> {
  const persona = await exigirRol("admin_org");
  const id = String(formData.get("id") ?? "");
  const supabase = await crearClienteServidor();
  const { data: s } = await supabase
    .from("solicitudes_alta")
    .select("nombre, correo, motivo, estado, persona_id")
    .eq("id", id)
    .maybeSingle()
    .returns<{ nombre: string; correo: string; motivo: string | null; estado: string; persona_id: string | null } | null>();
  if (!s || (s.estado === "aprobada" && !s.persona_id) || !["aprobada", "rechazada"].includes(s.estado)) {
    return { error: "Esa solicitud no tiene correo que mandar.", mensaje: null };
  }
  const correo = s.estado === "aprobada" ? await bienvenidaDe(supabase, s.persona_id!) : await rechazoDe(supabase, s);
  const falla = await mandarCorreoDeAlta(supabase, { solicitudId: id, para: s.correo, correo, slug: persona.organizacion.slug });
  refrescar(id);
  return falla ? { error: `Tampoco salió: ${falla}`, mensaje: null } : { error: null, mensaje: `Enviado a ${s.correo}.` };
}
