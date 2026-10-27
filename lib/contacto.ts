import { crearClienteServidor } from "@/lib/supabase/server";

/**
 * El medio de contacto que configura admin_org en Ajustes (o el de plataforma). Nulo si
 * está vacío: en ese caso las pantallas no muestran contacto.
 *
 * Funciona sin sesión (la usa la pantalla de acceso). Si la consulta
 * falla, tampoco se muestra contacto: es un dato de cortesía, no vale
 * tumbar la pantalla por él.
 */
export async function obtenerContacto(): Promise<string | null> {
  const supabase = await crearClienteServidor();
  const { data, error } = await supabase.rpc("contacto_soporte");
  if (error) {
    console.error(`[tasa] No se pudo leer contacto_soporte: ${error.message}`);
    return null;
  }
  return typeof data === "string" && data ? data : null;
}
