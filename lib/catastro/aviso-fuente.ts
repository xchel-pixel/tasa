/**
 * Si la fuente catastral responde 403 o 429 a cualquier consulta del mapa, admin_org recibe al momento una alerta en Hoy
 * ("nos están limitando"), una sola abierta (0098, catastro_aviso_fuente). Se registra con la sesión de quien consultó.
 * Nunca detiene ni demora la consulta: si el aviso no se puede registrar, se ignora.
 */

export type ServicioFuente = "mapa" | "expediente" | "folio" | "mosaicos" | "parcela" | "construcciones" | "zona";

/** ¿Es un bloqueo o límite de la fuente? */
export const esBloqueo = (estado: number) => estado === 403 || estado === 429;

export async function avisarSiBloqueo(servicio: ServicioFuente, estado: number): Promise<void> {
  if (!esBloqueo(estado)) return;
  try {
    // Import tardío: este módulo también lo usan pruebas y scripts fuera del servidor.
    const { crearClienteServidor } = await import("@/lib/supabase/server");
    const supabase = await crearClienteServidor();
    await supabase.rpc("catastro_aviso_fuente", { p_servicio: servicio, p_estado: estado });
  } catch {
    // Sin sesión o sin base: el aviso no es indispensable.
  }
}
