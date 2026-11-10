import { createServerClient } from "@supabase/ssr";
import { cookies, headers } from "next/headers";

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
 * La llave secreta solo existe en `/api/cron`.
 */
export async function crearClienteServidor() {
  const almacen = await cookies();
  const humo = await encabezadoHumo();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      ...(humo ? { global: { headers: humo } } : {}),
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

/**
 * Humo marcado (0072): si la petición trae x-tasa-humo, se reenvía tal cual a la base. Quien decide si es humo es la
 * base (compara la huella con la guardada); aquí no se valida nada, así que reenviarla no le da nada a nadie más.
 * Fuera de una petición (cron), no hay encabezado.
 */
export async function encabezadoHumo(): Promise<Record<string, string> | null> {
  try {
    const valor = (await headers()).get("x-tasa-humo");
    return valor ? { "x-tasa-humo": valor.slice(0, 200) } : null;
  } catch {
    return null;
  }
}
