import Link from "next/link";
import { cerrarSesion } from "@/app/acciones";
import { Marca } from "@/components/marca";
import { MenuFijo } from "@/components/menu-fijo";
import { menuDe } from "@/lib/herramientas";
import { obtenerSesion } from "@/lib/sesion";

/**
 * La barra de arriba de toda pantalla con sesión: la marca lleva al
 * inicio, debajo va la organización (con "Cambiar" si hay más de una) y
 * "Salir" cierra la sesión. El menú fijo (0053) va aquí arriba en la
 * computadora y abajo en el celular; sus entradas salen del catálogo de
 * herramientas, por rol.
 *
 * Si la plataforma entra a una organización que no es suya, una franja
 * fija lo dice: lo que haga ahí queda a nombre de la plataforma.
 */
export async function Encabezado() {
  const sesion = await obtenerSesion();
  const persona = sesion?.persona;
  const entradas = persona ? await menuDe(persona) : [];

  return (
    <>
      {persona?.visitante ? (
        <div className="sticky top-0 z-10 bg-proceso px-6 py-2 text-center text-[0.9375rem] font-semibold text-fondo">
          Estás viendo {persona.organizacion.nombre} como administrador de plataforma
        </div>
      ) : null}
      <header className="border-b border-linea bg-fondo px-6 py-3">
        <div className="mx-auto flex w-full max-w-md items-center justify-between gap-3 md:max-w-3xl">
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
          {entradas.length > 1 ? <MenuFijo entradas={entradas} lugar="arriba" /> : null}
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
      {entradas.length > 1 ? <MenuFijo entradas={entradas} lugar="abajo" /> : null}
    </>
  );
}
