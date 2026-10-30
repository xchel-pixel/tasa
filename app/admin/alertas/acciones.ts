"use server";

import { revalidatePath } from "next/cache";
import { exigirRol } from "@/lib/sesion";
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
