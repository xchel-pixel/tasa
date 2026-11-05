"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Sección que se abre y se cierra, con su contador en el encabezado. Recuerda en este
 * navegador, por usuario, cómo la dejó cada quien. Si el navegador no deja guardar (modo
 * privado, almacenamiento bloqueado), se queda como viene por omisión.
 */
export function Contraible({
  id,
  usuario,
  titulo,
  cuenta,
  abierta = false,
  children,
}: {
  /** Único por sección, p. ej. "inicio:mis-tramites" o "tramites:entregados". */
  id: string;
  usuario: string;
  titulo: string;
  cuenta: number;
  abierta?: boolean;
  children: React.ReactNode;
}) {
  const [abiertaAhora, setAbiertaAhora] = useState(abierta);
  const leida = useRef(false);
  const clave = `tasa:secciones:${usuario}`;

  useEffect(() => {
    try {
      const guardado = JSON.parse(localStorage.getItem(clave) ?? "{}") as Record<string, boolean>;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- lo guardado solo existe en el navegador
      if (typeof guardado[id] === "boolean") setAbiertaAhora(guardado[id]);
    } catch {
      // Sin almacenamiento: se queda lo de omisión.
    }
    leida.current = true;
  }, [clave, id]);

  function alternar(evento: React.SyntheticEvent<HTMLDetailsElement>) {
    const ahora = evento.currentTarget.open;
    setAbiertaAhora(ahora);
    if (!leida.current) return;
    try {
      const guardado = JSON.parse(localStorage.getItem(clave) ?? "{}") as Record<string, boolean>;
      guardado[id] = ahora;
      localStorage.setItem(clave, JSON.stringify(guardado));
    } catch {
      // Sin almacenamiento: no se recuerda, pero la sección funciona.
    }
  }

  return (
    <details open={abiertaAhora} onToggle={alternar} className="group mt-4 rounded-xl border border-linea">
      {/* Sin `toque`: es inline-flex y encogía la barra al ancho del título. Safari no aplica flex a <summary>,
          por eso la barra va en un div adentro, a todo lo ancho y clicable. */}
      <summary className="block min-h-12 w-full cursor-pointer list-none px-4 py-3 [&::-webkit-details-marker]:hidden">
        <div className="flex min-h-6 w-full items-center justify-between gap-3">
          <span className="min-w-0 font-bold">{titulo}</span>
          <span className="ml-auto flex shrink-0 items-center gap-3">
            <span className="min-w-9 rounded-full bg-alterno px-3 py-1 text-center text-[0.9375rem] font-bold">{cuenta}</span>
            <span aria-hidden="true" className="inline-block text-secundario transition-transform duration-200 group-open:rotate-180">▾</span>
          </span>
        </div>
      </summary>
      <div className="px-4 pb-4">{children}</div>
    </details>
  );
}
