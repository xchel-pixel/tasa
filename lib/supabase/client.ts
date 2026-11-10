import { createBrowserClient } from "@supabase/ssr";

/**
 * Cliente de Supabase para el navegador.
 * Solo la llave `anon`, nunca la de servicio.
 */
export function crearClienteNavegador() {
  if (typeof document !== "undefined" && document.cookie.split("; ").some((c) => c.startsWith("tasa_solo_lectura="))) {
    throw new Error("Modo solo lectura: estás viendo como otro comisionista.");
  }
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
