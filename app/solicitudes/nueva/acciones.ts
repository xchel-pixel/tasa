"use server";

import { redirect } from "next/navigation";
import { exigirRol } from "@/lib/sesion";
import { crearClienteServidor } from "@/lib/supabase/server";

export type EstadoSolicitud = { error: string | null };

const texto = (formData: FormData, campo: string) => String(formData.get(campo) ?? "").trim();

/**
 * El comisionista solo pide: sin montos, sin cuenta, sin marca. La
 * política `pedir_solicitud` de la base rechaza cualquier otra cosa,
 * aunque alguien arme el formulario a mano.
 */
export async function crearSolicitud(
  _previo: EstadoSolicitud,
  formData: FormData
): Promise<EstadoSolicitud> {
  const persona = await exigirRol("comisionista");

  const tipo = texto(formData, "tipo");
  const datos = {
    comisionista_id: persona.id,
    tipo,
    origen: "portal",
    servicio_id: texto(formData, "servicio_id"),
    inmueble_direccion: texto(formData, "inmueble_direccion"),
    inmueble_municipio: texto(formData, "inmueble_municipio") || null,
    inmueble_clave_catastral: texto(formData, "inmueble_clave_catastral") || null,
    inmueble_descripcion: texto(formData, "inmueble_descripcion") || null,
    cliente_nombre: texto(formData, "cliente_nombre"),
    cliente_telefono: texto(formData, "cliente_telefono") || null,
    cliente_correo: texto(formData, "cliente_correo").toLowerCase() || null,
    creado_por: persona.id,
  };

  if (tipo !== "cotizacion" && tipo !== "tramite_directo") return { error: "Elige el tipo de solicitud." };
  if (!datos.servicio_id) return { error: "Elige el servicio." };
  if (!datos.inmueble_direccion) return { error: "Escribe la dirección del inmueble." };
  if (!datos.cliente_nombre) return { error: "Escribe el nombre del cliente." };
  if (datos.cliente_correo && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(datos.cliente_correo)) {
    return { error: "El correo del cliente no parece válido." };
  }

  const supabase = await crearClienteServidor();
  const { data, error } = await supabase.from("solicitudes").insert(datos).select("id").single();

  if (error || !data) {
    console.error(`[tasa] No se pudo crear la solicitud: ${error?.message}`);
    return { error: "No se pudo enviar la solicitud. Inténtalo otra vez." };
  }

  redirect(`/trabajos/${data.id}`);
}
