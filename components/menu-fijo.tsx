"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { seccionActiva, type IconoMenu, type Seccion } from "@/lib/menu";

/**
 * El menú principal (lib/menu.ts): abajo en el celular (al alcance del pulgar, con ícono y nombre corto) y arriba,
 * dentro del encabezado, en la computadora. En la computadora, las pantallas de la sección activa van debajo como
 * pestañas. Las secciones vienen del servidor, por rol y catálogo; aquí solo se pintan.
 */

const TRAZOS: Record<IconoMenu, string> = {
  inicio: "M4 11l8-7 8 7v9h-5v-6H9v6H4z",
  hoy: "M4 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2zM8 3v4M16 3v4M4 10h16M9 14l2 2 4-4",
  trabajos: "M4 9a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2zM9 7V5h6v2M4 12h16",
  admin: "M5 20V11M11 20V5M17 20v-7M3 20h18",
  herramientas: "M14 6l4 4-9 9H5v-4zM13 7l4 4",
  agenda: "M4 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2zM8 3v4M16 3v4M4 10h16",
  cuenta: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21c1-4 4-6 8-6s7 2 8 6",
  ajustes: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM12 2v3M12 19v3M4.9 4.9 7 7M17 17l2.1 2.1M2 12h3M19 12h3M4.9 19.1 7 17M17 7l2.1-2.1",
};

export function IconoSeccion({ icono, className = "h-6 w-6" }: { icono: IconoMenu; className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d={TRAZOS[icono]} />
    </svg>
  );
}

export function MenuFijo({ secciones, lugar }: { secciones: Seccion[]; lugar: "arriba" | "abajo" }) {
  const activa = seccionActiva(secciones, usePathname());

  if (lugar === "arriba") {
    return (
      <nav aria-label="Menú" className="hidden min-w-0 md:block">
        <ul className="flex items-center gap-1 overflow-x-auto">
          {secciones.map((s) => (
            <li key={s.id}>
              <Link href={s.href} aria-current={activa === s.id ? "page" : undefined}
                className={`flex min-h-11 items-center rounded-lg px-3 text-[0.9375rem] font-semibold ${
                  activa === s.id ? "bg-tinte text-primario" : "text-secundario hover:bg-alterno"}`}>
                {s.texto}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    );
  }

  return (
    <nav aria-label="Menú" data-menu-fijo className="fixed inset-x-0 bottom-0 z-20 border-t border-linea bg-fondo md:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
      <ul className="mx-auto flex max-w-md">
        {secciones.map((s) => (
          <li key={s.id} className="min-w-0 flex-1">
            <Link href={s.href} aria-current={activa === s.id ? "page" : undefined} aria-label={s.texto}
              className={`flex min-h-14 flex-col items-center justify-center gap-0.5 px-0.5 text-center font-semibold leading-tight ${
                secciones.length > 4 ? "text-[0.6875rem]" : "text-[0.75rem]"} ${
                activa === s.id ? "text-primario" : "text-secundario"}`}>
              <IconoSeccion icono={s.icono} />
              <span className="max-w-full truncate tracking-tight">{s.corto ?? s.texto}</span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** En la computadora: las pantallas de la sección activa, como pestañas, debajo del encabezado. */
export function PestanasSeccion({ secciones }: { secciones: Seccion[] }) {
  const ruta = usePathname();
  const s = secciones.find((x) => x.id === seccionActiva(secciones, ruta));
  if (!s || s.pantallas.length < 2) return null;
  const es = (href: string) => {
    const base = href.split("?")[0];
    return ruta === base || (base !== "/" && ruta.startsWith(`${base}/`));
  };
  // Con grupos (Administración): solo las del grupo de la pantalla actual, para que quepan; en la página de la sección, ninguna.
  const actual = s.pantallas.find((p) => es(p.href));
  if (s.pantallas.some((p) => p.grupo) && !actual) return null;
  const visibles = s.pantallas.filter((p) => p.href !== s.href && (!actual?.grupo || p.grupo === actual.grupo));
  const pestanas = [{ href: s.href, titulo: s.id === "ajustes" ? "Ajustes" : actual?.grupo ? `← ${s.texto}` : "Resumen" }, ...visibles];
  return (
    <nav aria-label={`Pantallas de ${s.texto}`} className="hidden border-b border-linea bg-fondo px-6 md:block">
      <ul className="mx-auto flex w-full max-w-3xl gap-5 overflow-x-auto">
        {pestanas.map((p) => (
          <li key={p.href}>
            <Link href={p.href} aria-current={es(p.href) ? "page" : undefined}
              className={`flex min-h-11 items-center whitespace-nowrap border-b-2 text-[0.875rem] font-semibold ${
                es(p.href) ? "border-primario text-primario" : "border-transparent text-secundario hover:text-texto"}`}>
              {p.titulo}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
