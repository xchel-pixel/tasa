"use server";

import { ipResumida } from "@/lib/altas";
import { errorDeRfcOCurp, errorDeTelefono, limpiarCurp, limpiarRfc, limpiarTelefono } from "@/lib/limpiar";
import { crearClienteServidor } from "@/lib/supabase/server";

export type ResultadoPedido = { error: string | null; id?: string };

/** Menos que esto, y con todo lleno, no lo escribió una persona. */
const TIEMPO_MINIMO_MS = 4000;

/**
 * Primer paso de la solicitud pública: valida, aplica los anti-bots y
 * crea la solicitud. Con CSF nace "subiendo": el teléfono sube el PDF
 * directo a Storage y luego llama a `confirmarAlta`. Sin CSF nace
 * pendiente ("CSF pendiente").
 */
export async function pedirAlta(formData: FormData): Promise<ResultadoPedido> {
  const campo = (n: string) => String(formData.get(n) ?? "").trim();

  // Campo trampa: invisible para una persona, irresistible para un bot.
  if (campo("sitio_web")) return { error: "No se pudo enviar la solicitud." };
  if (Date.now() - Number(campo("t")) < TIEMPO_MINIMO_MS) return { error: "Revisa tus datos y vuelve a enviar." };

  const rfc = limpiarRfc(campo("rfc"));
  const curp = limpiarCurp(campo("curp"));
  const telefono = limpiarTelefono(campo("telefono"));
  if (!campo("nombre")) return { error: "Falta tu nombre completo." };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(campo("correo"))) return { error: "Revisa tu correo." };
  if (!telefono) return { error: "Falta tu teléfono." };
  const formato = errorDeTelefono(telefono) ?? errorDeRfcOCurp(rfc, curp);
  if (formato) return { error: formato };
  if (formData.get("acepto") !== "on") return { error: "Para enviar la solicitud, acepta el aviso de privacidad." };

  const supabase = await crearClienteServidor();
  const { data, error } = await supabase.rpc("pedir_alta", {
    p_org_slug: campo("org"),
    p_nombre: campo("nombre"),
    p_correo: campo("correo"),
    p_telefono: telefono,
    p_rfc: rfc || null,
    p_curp: curp || null,
    p_ref: campo("ref") || null,
    p_aviso_version: Number(campo("aviso_version")),
    p_ip_resumen: await ipResumida(),
    p_con_csf: formData.get("con_csf") === "1",
  });
  // Los mensajes de la base ya están escritos para leerse ("Revisa tu RFC…").
  if (error) return { error: error.message || "No se pudo enviar la solicitud. Inténtalo otra vez." };
  return { error: null, id: data as string };
}

export async function confirmarAlta(id: string): Promise<{ error: string | null }> {
  const supabase = await crearClienteServidor();
  const { error } = await supabase.rpc("confirmar_alta", { p_id: id });
  return { error: error ? error.message || "No se pudo terminar la solicitud." : null };
}
