import Link from "next/link";
import { cerrarSesion } from "@/app/acciones";
import { Marca } from "@/components/marca";
import { obtenerSesion } from "@/lib/sesion";

/**
 * La barra de arriba de toda pantalla con sesión: la marca lleva al
 * inicio, debajo va la organización (con "Cambiar" si hay más de una) y
 * "Salir" cierra la sesión. No hay menú: cada pantalla abre a su
 * detalle y regresa.
 *
 * Si la plataforma entra a una organización que no es suya, una franja
 * fija lo dice: lo que haga ahí queda a nombre de la plataforma.
 */
export async function Encabezado() {
  const sesion = await obtenerSesion();
  const persona = sesion?.persona;

  return (
    <>
      {persona?.visitante ? (
        <div className="sticky top-0 z-10 bg-proceso px-6 py-2 text-center text-[0.9375rem] font-semibold text-fondo">
          Estás viendo {persona.organizacion.nombre} como administrador de plataforma
        </div>
      ) : null}
      <header className="border-b border-linea bg-fondo px-6 py-3">
        <div className="mx-auto flex w-full max-w-md items-center justify-between gap-3">
          <div className="min-w-0">
            <Link href="/" className="toque">
              <Marca alto={44} />
            </Link>
            {persona ? (
              <p className="truncate text-[0.875rem] text-secundario">
                {persona.organizacion.nombre}
                {persona.organizaciones > 1 ? (
                  <>
                    {" · "}
                    <Link href="/organizacion" className="font-semibold text-acento underline underline-offset-4">
                      Cambiar
                    </Link>
                  </>
                ) : null}
              </p>
            ) : null}
          </div>
          <form action={cerrarSesion}>
            <button
              type="submit"
              className="toque text-[0.9375rem] font-semibold text-acento underline underline-offset-4"
            >
              Salir
            </button>
          </form>
        </div>
      </header>
    </>
  );
}
