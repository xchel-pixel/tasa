"use client";

import { useEffect } from "react";
import { registrarClic, registrarEvento } from "./acciones";

/**
 * Cuenta la visita al abrir (en el navegador: los robots que arman la vista previa de WhatsApp no
 * cuentan), cada clic en "Escríbeme por WhatsApp" y cada clic en un servicio propio o un inmueble
 * (`data-clic` con su id).
 */
export function Contador({ org, clave }: { org: string; clave: string }) {
  useEffect(() => {
    void registrarEvento(org, clave, "visita");
    const alClic = (e: MouseEvent) => {
      const objetivo = e.target as HTMLElement | null;
      if (objetivo?.closest('[data-evento="whatsapp"]')) void registrarEvento(org, clave, "whatsapp");
      const clic = objetivo?.closest<HTMLElement>("[data-clic]")?.dataset.clic;
      if (clic) void registrarClic(org, clave, clic);
    };
    document.addEventListener("click", alClic);
    return () => document.removeEventListener("click", alClic);
  }, [org, clave]);
  return null;
}
