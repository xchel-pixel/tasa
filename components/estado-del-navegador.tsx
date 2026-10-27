"use client";

import { useMontado } from "./montado";

/**
 * El aviso de que esta página no terminó de cargar.
 *
 * Lo pinta el servidor y desaparece en cuanto el navegador hidrata. Si
 * la hidratación nunca ocurre —el JavaScript no llegó, o reventó al
 * cargar— el aviso se queda, y eso es lo único que se puede ver desde
 * un celular sin consola.
 *
 * No parpadea en cada carga: el CSS lo mantiene invisible tres
 * segundos. Si todo va bien, React lo quita antes de que aparezca.
 *
 * Nació de un fallo real: la página se veía completa y no respondía a
 * nada, y sin este aviso la única salida era adivinar la causa.
 */
export default function EstadoDelNavegador() {
  const montado = useMontado();
  if (montado) return null;

  return (
    <div
      role="status"
      className="aviso-sin-js fixed inset-x-0 bottom-0 z-50 border-t border-red-900 bg-tarjeta px-4 py-3"
    >
      <p className="text-[0.75rem] font-semibold uppercase tracking-wider text-red-400">
        Esta página no terminó de cargar
      </p>
      <p className="mt-1 text-[0.9375rem] leading-6">
        Los botones y los campos no van a responder. Recárgala; si sigue
        igual, avisa a Xchel o a Gaby que la aplicación no cargó en tu
        teléfono.
      </p>
    </div>
  );
}
