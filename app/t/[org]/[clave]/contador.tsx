"use client";

import { useEffect } from "react";
import { registrarEvento } from "./acciones";

/**
 * Cuenta la visita al abrir (en el navegador: los robots que arman la vista previa de WhatsApp no
 * cuentan) y cada clic en "Escríbeme por WhatsApp".
 */
export function Contador({ org, clave }: { org: string; clave: string }) {
  useEffect(() => {
    void registrarEvento(org, clave, "visita");
    const alClic = (e: MouseEvent) => {
      if ((e.target as HTMLElement | null)?.closest('[data-evento="whatsapp"]')) void registrarEvento(org, clave, "whatsapp");
    };
    document.addEventListener("click", alClic);
    return () => document.removeEventListener("click", alClic);
  }, [org, clave]);
  return null;
}
