import { cookies } from "next/headers";

/**
 * El código que alguien ya pidió, recordado fuera de la pestaña.
 *
 * El problema que resuelve: en el celular, la persona pide su código y
 * se va a su app de correo. Mientras Outlook sincroniza, el teléfono
 * descarta la pestaña para liberar memoria; al volver, la página se
 * recarga desde cero y pide el correo otra vez. La persona pide otro
 * código, eso invalida el primero, y cuando le llega el primero ya no
 * sirve.
 *
 * Por qué una cookie:
 *   · la lee el servidor ANTES de dibujar la pantalla, así que aparece
 *     directo el paso correcto. Con `localStorage` se vería primero el
 *     campo del correo y un instante después saltaría al del código;
 *   · no va en la dirección: un correo en `/entrar?correo=…` quedaría
 *     en el historial y en los registros de Vercel.
 *
 * Solo la lee el servidor (`httpOnly`) y vive lo mismo que el código:
 * una hora, lo que dice Supabase en "Email OTP Expiration".
 */

const NOMBRE = "tasa_acceso";
const VIDA_DEL_CODIGO = 60 * 60;

export type AccesoPendiente = {
  correo: string;
  /**
   * Cuándo se pidió el código vigente, en ISO. Nulo si Supabase no dejó
   * mandar otro por el límite de un minuto: sabemos que hay uno en
   * camino, no a qué hora salió.
   */
  pedido: string | null;
  /** Si ese código reemplazó a otro. La pantalla lo advierte. */
  reemplazo: boolean;
};

export async function recordarAcceso(acceso: AccesoPendiente) {
  const almacen = await cookies();
  almacen.set(NOMBRE, JSON.stringify(acceso), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: VIDA_DEL_CODIGO,
  });
}

export async function leerAcceso(): Promise<AccesoPendiente | null> {
  const almacen = await cookies();
  const texto = almacen.get(NOMBRE)?.value;
  if (!texto) return null;

  // Una cookie la puede tocar cualquiera desde su navegador: si no tiene
  // la forma esperada, se ignora y se empieza por el correo.
  try {
    const leido = JSON.parse(texto) as Partial<AccesoPendiente>;
    if (typeof leido.correo !== "string" || !leido.correo) return null;
    return {
      correo: leido.correo,
      pedido: typeof leido.pedido === "string" ? leido.pedido : null,
      reemplazo: leido.reemplazo === true,
    };
  } catch {
    return null;
  }
}

export async function olvidarAcceso() {
  const almacen = await cookies();
  almacen.delete(NOMBRE);
}
