import Link from "next/link";
import { cerrarSesion } from "@/app/acciones";
import { Marca } from "@/components/marca";

/**
 * La barra de arriba de toda pantalla con sesión: la marca lleva al
 * inicio y "Salir" cierra la sesión. No hay menú: cada pantalla abre
 * a su detalle y regresa.
 */
export function Encabezado() {
  return (
    <header className="border-b border-linea bg-fondo px-6 py-3">
      <div className="mx-auto flex w-full max-w-md items-center justify-between">
        <Link href="/" className="toque">
          <Marca className="text-[1.375rem]" />
        </Link>
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
  );
}
