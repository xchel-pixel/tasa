import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * Una consulta rota no puede verse igual que "no hay nada".
 *
 * Lección de Pulso: una bandeja de pagos decía "todo al día" mientras
 * había pagos esperando, porque la consulta tronaba y el `data ?? []`
 * lo convertía en una lista vacía perfectamente creíble. Toda lectura
 * pasa por aquí.
 */
export function oExplota<T>(
  resultado: { data: T | null; error: { message: string; code?: string } | null },
  que: string
): T | null {
  if (resultado.error) {
    console.error(
      `[tasa] Falló la consulta de ${que}: ${resultado.error.code ?? "sin código"} — ${resultado.error.message}`
    );
    throw new Error(`No se pudieron leer ${que}.`);
  }
  return resultado.data;
}

/**
 * Cliente de Supabase para el servidor: Server Components, Server Actions
 * y Route Handlers. Lee y escribe la cookie de sesión.
 *
 * Usa la llave `anon`, igual que el navegador. El RLS decide qué se ve.
 * La llave de servicio solo existe en `/api/cron` (fase de Notion).
 */
export async function crearClienteServidor() {
  const almacen = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return almacen.getAll();
        },
        setAll(cookiesNuevas) {
          try {
            for (const { name, value, options } of cookiesNuevas) {
              almacen.set(name, value, options);
            }
          } catch {
            // Un Server Component no puede escribir cookies.
            // No importa: el proxy ya refrescó la sesión.
          }
        },
      },
    }
  );
}
