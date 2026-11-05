"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { EntradaMenu } from "@/lib/herramientas";

/**
 * El menú fijo: abajo en el celular (al alcance del pulgar) y arriba, dentro del encabezado, en la
 * computadora. Las entradas vienen del catálogo de herramientas, por rol; aquí solo se pintan.
 */
export function MenuFijo({ entradas, lugar }: { entradas: EntradaMenu[]; lugar: "arriba" | "abajo" }) {
  const ruta = usePathname();
  const activa = (href: string) => (href === "/" ? ruta === "/" : ruta === href || ruta.startsWith(`${href}/`));

  if (lugar === "arriba") {
    return (
      <nav aria-label="Menú" className="hidden md:block">
        <ul className="flex items-center gap-1">
          {entradas.map((e) => (
            <li key={e.href}>
              <Link href={e.href} aria-current={activa(e.href) ? "page" : undefined}
                className={`flex min-h-11 items-center rounded-lg px-3 text-[0.9375rem] font-semibold ${
                  activa(e.href) ? "bg-tinte text-primario" : "text-secundario hover:bg-alterno"}`}>
                {e.texto}
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
        {entradas.map((e) => (
          <li key={e.href} className="min-w-0 flex-1">
            <Link href={e.href} aria-current={activa(e.href) ? "page" : undefined}
              className={`flex min-h-14 items-center justify-center px-1 text-center text-[0.8125rem] font-semibold leading-tight ${
                activa(e.href) ? "text-primario" : "text-secundario"}`}>
              <span className={activa(e.href) ? "border-b-2 border-primario pb-0.5" : "pb-0.5"}>{e.texto}</span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
