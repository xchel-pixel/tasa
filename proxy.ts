import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Corre antes que cualquier página. Next 16 llama "proxy" a lo que
 * hasta la versión 15 se llamaba "middleware".
 */

/** La ruta por donde se entra. */
const RUTA_ACCESO = "/entrar";

/**
 * Lo que se ve sin sesión. Por ahora, solo la pantalla de acceso.
 *
 * Cuando existan, se abrirán aquí a propósito `/api/cron` (se protege
 * con su propio secreto, no con sesión) y `/t/<slug>` (la tarjeta de
 * fase 2). `anon` no puede leer ninguna tabla: abrir una ruta no abre
 * los datos.
 */
const RUTAS_ABIERTAS = [RUTA_ACCESO];

export async function proxy(request: NextRequest) {
  let respuesta = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesNuevas) {
          for (const { name, value } of cookiesNuevas) {
            request.cookies.set(name, value);
          }
          respuesta = NextResponse.next({ request });
          for (const { name, value, options } of cookiesNuevas) {
            respuesta.cookies.set(name, value, options);
          }
        },
      },
    }
  );

  // Refresca el token si venció. Tiene que ser getUser() y no
  // getSession(): getUser() valida contra Supabase, getSession() se
  // fía de la cookie.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const ruta = request.nextUrl.pathname;
  const enAcceso = ruta.startsWith(RUTA_ACCESO);
  const abierta = RUTAS_ABIERTAS.some((libre) => ruta.startsWith(libre));

  if (!user && !abierta) {
    return redirigir(request, RUTA_ACCESO, respuesta);
  }

  // Con sesión, la pantalla de acceso no tiene sentido: rebota al inicio.
  if (user && enAcceso) {
    return redirigir(request, "/", respuesta);
  }

  return respuesta;
}

/** Redirige conservando las cookies de sesión que se acaban de refrescar. */
function redirigir(
  request: NextRequest,
  ruta: string,
  respuesta: NextResponse
) {
  const destino = request.nextUrl.clone();
  destino.pathname = ruta;
  destino.search = "";

  const redireccion = NextResponse.redirect(destino);
  for (const cookie of respuesta.cookies.getAll()) {
    redireccion.cookies.set(cookie);
  }
  return redireccion;
}

export const config = {
  matcher: [
    /*
     * Todo menos archivos estáticos e imágenes.
     *
     * `manifest.webmanifest` y `apple-icon` van exentos a propósito: el
     * navegador los pide SIN sesión al guardar la aplicación en la
     * pantalla de inicio. Si el proxy los mandara a /entrar, el teléfono
     * recibiría una redirección en vez de un icono y pondría el suyo
     * genérico.
     */
    "/((?!_next/static|_next/image|manifest.webmanifest|apple-icon|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
