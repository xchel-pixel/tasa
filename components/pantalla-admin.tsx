import Link from "next/link";
import { Encabezado } from "@/components/encabezado";

/**
 * El marco de toda pantalla del panel: encabezado, título y, si la pantalla vive dentro de otra (una ficha, un cierre),
 * el regreso a ella. Al nivel de la sección no hay regreso: lo dan el menú y las pestañas.
 */
export function PantallaAdmin({
  titulo,
  volver,
  ancha = false,
  children,
}: {
  titulo: string;
  volver?: { href: string; texto: string };
  /** Tablas anchas (Estadísticas): en computadora usa más ancho; en el celular es igual. */
  ancha?: boolean;
  children: React.ReactNode;
}) {
  return (
    <>
      <Encabezado />
      <main className="flex flex-1 flex-col px-6 py-6">
        <div className={`mx-auto w-full max-w-md ${ancha ? "md:max-w-5xl" : "md:max-w-3xl"}`}>
          {volver ? (
            <Link href={volver.href} className="toque text-[0.9375rem] font-semibold text-acento">
              ← {volver.texto}
            </Link>
          ) : null}
          <h1 className="mt-2 text-[1.5rem] font-bold tracking-tight">{titulo}</h1>
          {children}
        </div>
      </main>
    </>
  );
}

