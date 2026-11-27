import Link from "next/link";
import { IconoSeccion } from "@/components/menu-fijo";
import type { Pantalla } from "@/lib/menu";

/**
 * La página de una sección del menú (Mis trabajos, Administración, Mi cuenta, Herramientas): título, una ilustración y
 * tarjetas a las pantallas de siempre, agrupadas. Las ilustraciones son SVG propios de línea (public/ilustraciones).
 */

export function Ilustracion({ nombre, className = "h-[63px] w-[84px]" }: { nombre: string; className?: string }) {
  // Decorativas: el texto de al lado ya dice qué es.
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={`/ilustraciones/${nombre}.svg`} alt="" width={160} height={120} loading="lazy" className={`shrink-0 ${className}`} />;
}

export function EncabezadoSeccion({ titulo, bajada, ilustracion, texto }: { titulo: string; bajada: string; ilustracion: string; texto?: string }) {
  return (
    <>
      <h1 className="mt-2 text-[1.5rem] font-bold tracking-tight">{titulo}</h1>
      <p className="mt-1 text-[0.9375rem] leading-6 text-secundario">{bajada}</p>
      <div className="mt-4 flex items-center gap-4 rounded-2xl bg-tinte px-4 py-3">
        <Ilustracion nombre={ilustracion} className="h-[75px] w-[100px]" />
        {texto ? <p className="text-[0.9375rem] font-semibold leading-6 text-primario">{texto}</p> : null}
      </div>
    </>
  );
}

/** Tarjetas de pantallas, agrupadas por `grupo` (en el orden en que aparecen). */
export function TarjetasDeSeccion({ pantallas }: { pantallas: Pantalla[] }) {
  const grupos = [...new Set(pantallas.map((p) => p.grupo ?? ""))];
  return (
    <>
      {grupos.map((g) => (
        <section key={g || "todas"} aria-label={g || undefined} className="mt-6">
          {g ? <h2 className="text-[1rem] font-bold">{g}</h2> : null}
          <ul className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3">
            {pantallas.filter((p) => (p.grupo ?? "") === g).map((p) => (
              <li key={p.href}>
                <Link href={p.href} className="flex h-full items-start gap-3 rounded-xl border border-linea bg-fondo px-4 py-3 hover:border-acento">
                  {p.icono ? (
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-tinte text-primario">
                      <IconoSeccion icono={p.icono} className="h-[22px] w-[22px]" />
                    </span>
                  ) : null}
                  <span>
                    <span className="block font-bold leading-tight">{p.titulo}</span>
                    <span className="mt-1 block text-[0.875rem] leading-5 text-secundario">{p.detalle}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}
