"use client";

import { useEffect, useState } from "react";

/**
 * Lo que revienta en el navegador, dicho en la pantalla.
 *
 * En el teléfono no hay consola. Sin esto, un error de JavaScript se ve
 * exactamente igual que "no pasó nada": se elige un archivo y hay
 * silencio. Eso ya costó dos rondas de adivinar la causa en vez de
 * leerla.
 *
 * Es la regla de que una falla tiene que verse, aplicada del lado
 * del cliente.
 *
 * Se queda en producción a propósito: los comisionistas usando esto
 * desde su celular no pueden abrir una consola, pero sí pueden leerle
 * el mensaje a Xchel o a Gaby.
 */
export default function ErroresVisibles() {
  const [errores, setErrores] = useState<string[]>([]);

  useEffect(() => {
    function anotar(texto: string) {
      setErrores((previos) =>
        previos.includes(texto) ? previos : [...previos, texto]
      );
    }

    function alFallar(evento: ErrorEvent) {
      anotar(
        `${evento.message}${evento.filename ? ` · ${evento.filename.split("/").pop()}:${evento.lineno}` : ""}`
      );
    }

    function alRechazar(evento: PromiseRejectionEvent) {
      const razon = evento.reason;
      anotar(
        razon instanceof Error
          ? `${razon.name}: ${razon.message}`
          : String(razon)
      );
    }

    window.addEventListener("error", alFallar);
    window.addEventListener("unhandledrejection", alRechazar);

    return () => {
      window.removeEventListener("error", alFallar);
      window.removeEventListener("unhandledrejection", alRechazar);
    };
  }, []);

  if (errores.length === 0) return null;

  return (
    <div
      role="alert"
      className="fixed inset-x-0 top-0 z-50 border-b border-red-900 bg-tarjeta px-4 py-3"
    >
      <p className="text-[0.75rem] font-semibold uppercase tracking-wider text-red-400">
        Algo falló en esta pantalla
      </p>
      <ul className="mt-1 flex flex-col gap-1">
        {errores.map((error) => (
          <li key={error} className="font-mono text-[0.8125rem] leading-5">
            {error}
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={() => setErrores([])}
        className="toque mt-1 text-[0.9375rem] text-apagado underline underline-offset-4"
      >
        Ocultar
      </button>
    </div>
  );
}
