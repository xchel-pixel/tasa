"use server";

import { revalidatePath } from "next/cache";
import { exigirRol } from "@/lib/sesion";
import { conectorDeLaOrg } from "@/lib/conectores/desde-app";
import { crearClienteServidor } from "@/lib/supabase/server";

export type EstadoAlerta = { error: string | null; mensaje: string | null };

/**
 * Dos salidas, las dos con texto obligatorio:
 *   · cancelar: `cancelar_trabajo` borra o carga la comisión y la alerta se cierra sola;
 *   · descartar: Notion se equivocó; queda la nota en la alerta.
 */
export async function resolverAlerta(_previo: EstadoAlerta, formData: FormData): Promise<EstadoAlerta> {
  await exigirRol("admin_org");
  const alerta = String(formData.get("alerta") ?? "");
  const solicitud = String(formData.get("solicitud") ?? "");
  const decision = String(formData.get("decision") ?? "");
  const texto = String(formData.get("texto") ?? "").trim();
  if (!texto) return { error: "Escribe el motivo o la nota.", mensaje: null };

  const supabase = await crearClienteServidor();
  const { error } =
    decision === "cancelar"
      ? await supabase.rpc("cancelar_trabajo", { p_solicitud: solicitud, p_motivo: texto })
      : await supabase.rpc("descartar_alerta", { p_alerta: alerta, p_nota: texto });

  if (error) {
    console.error(`[tasa] No se pudo resolver la alerta: ${error.message}`);
    return { error: /ya estaba cancelado/.test(error.message) ? "Ese trabajo ya estaba cancelado." : "No se pudo guardar. Inténtalo otra vez.", mensaje: null };
  }

  revalidatePath("/admin/alertas");
  revalidatePath("/");
  return { error: null, mensaje: decision === "cancelar" ? "Trabajo cancelado." : "Alerta descartada." };
}

/** Liberar un teléfono que llegó al límite de la liga de clientes: vuelve a contar desde ahora. */
export async function liberarTelefono(_previo: EstadoAlerta, formData: FormData): Promise<EstadoAlerta> {
  await exigirRol("admin_org", "finanzas");
  const supabase = await crearClienteServidor();
  const { error } = await supabase.rpc("liberar_telefono_liga", { p_alerta: String(formData.get("alerta") ?? "") });
  if (error) return { error: error.message || "No se pudo liberar.", mensaje: null };
  revalidatePath("/admin/alertas");
  return { error: null, mensaje: "Teléfono liberado: ya puede volver a enviar solicitudes." };
}

/** Cerrar una alerta que no pide más acción (p. ej. límite por conexión, que se libera solo), con nota. */
/** El pendiente de "Pagar con mi crédito" no aplicado (0078): finanzas o admin_org, con nota opcional. */
export async function cerrarAlertaCredito(_previo: EstadoAlerta, formData: FormData): Promise<EstadoAlerta> {
  await exigirRol("admin_org", "finanzas");
  const supabase = await crearClienteServidor();
  const { error } = await supabase.rpc("cerrar_alerta_credito", { p_alerta: String(formData.get("alerta") ?? ""), p_nota: String(formData.get("nota") ?? "") });
  if (error) return { error: error.message || "No se pudo cerrar.", mensaje: null };
  revalidatePath("/admin/alertas");
  return { error: null, mensaje: "Pendiente cerrado." };
}

export async function cerrarAlerta(_previo: EstadoAlerta, formData: FormData): Promise<EstadoAlerta> {
  await exigirRol("admin_org");
  const supabase = await crearClienteServidor();
  const { error } = await supabase.rpc("descartar_alerta", {
    p_alerta: String(formData.get("alerta") ?? ""),
    p_nota: String(formData.get("nota") ?? "") || "Revisada",
  });
  if (error) return { error: error.message || "No se pudo cerrar.", mensaje: null };
  revalidatePath("/admin/alertas");
  return { error: null, mensaje: "Alerta cerrada." };
}

/**
 * "Páginas de Notion por confirmar" (0087), solo admin_org:
 *   · ligar: la parecida que sí es esa persona;
 *   · nueva: no es la misma persona. Tasa crea la página con el nombre que tiene en Tasa (leído aquí, no del formulario),
 *     la liga y descarta las parecidas para no volver a proponerlas.
 */
export async function confirmarPaginaNotion(_previo: EstadoAlerta, formData: FormData): Promise<EstadoAlerta> {
  const yo = await exigirRol("admin_org");
  const supabase = await crearClienteServidor();
  const persona = String(formData.get("persona") ?? "");
  if (formData.get("accion") === "ligar") {
    const nombre = String(formData.get("nombre") ?? "");
    const { error } = await supabase.rpc("ligar_pagina_notion", { p_persona: persona, p_pagina: String(formData.get("pagina") ?? ""), p_nombre: nombre });
    if (error) return { error: error.message || "No se pudo ligar.", mensaje: null };
    revalidatePath("/admin/alertas");
    return { error: null, mensaje: `Ligado a "${nombre}" en Notion.` };
  }
  const { data: propuesta } = await supabase.rpc("propuestas_notion").eq("persona_id", persona)
    .maybeSingle<{ persona_id: string; nombre: string; candidatos: unknown }>();
  if (!propuesta) return { error: "Esa propuesta ya no está abierta.", mensaje: null };
  const r = await conectorDeLaOrg(yo.organizacion.id);
  if ("error" in r) return { error: r.error, mensaje: null };
  let pagina: { id: string; nombre: string };
  try {
    pagina = await r.conector.crearComisionista(propuesta.nombre);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Notion no creó la página.", mensaje: null };
  }
  const { error } = await supabase.rpc("ligar_pagina_nueva_descartando", { p_persona: persona, p_pagina: pagina.id, p_nombre: pagina.nombre });
  if (error) return { error: `Se creó "${pagina.nombre}" en Notion pero no se pudo ligar (${error.message}). Lígala en su ficha.`, mensaje: null };
  revalidatePath("/admin/alertas");
  return { error: null, mensaje: `Página nueva creada en Notion y ligada: "${pagina.nombre}". Las parecidas ya no se volverán a proponer.` };
}
