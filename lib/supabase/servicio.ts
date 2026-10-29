import { createClient } from "@supabase/supabase-js";

/**
 * Cliente con la llave de servicio. SOLO en el servidor (acciones y rutas),
 * nunca en un componente de cliente: la llave salta el RLS. Nulo si el
 * entorno no la tiene (en local suele faltar).
 */
export function clienteDeServicio() {
  const llave = process.env.SUPABASE_SECRET_KEY;
  if (!llave) return null;
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, llave, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
