"use client";

import { useSyncExternalStore } from "react";

const sinCambios = () => () => {};

/**
 * ¿Ya corre el JavaScript en esta pantalla?
 *
 * Devuelve `false` en el servidor y `true` en cuanto el navegador
 * hidrata. Los campos de archivo se quedan deshabilitados hasta
 * entonces: si la hidratación nunca ocurre —que es lo único que explica
 * elegir un archivo y que no pase absolutamente nada— el campo lo dice
 * en vez de fingir que está listo.
 *
 * Con `useSyncExternalStore` y no con un `useEffect` que llame a
 * `setState`: eso último provoca un segundo render en cascada y React
 * lo desaconseja.
 */
export function useMontado(): boolean {
  return useSyncExternalStore(
    sinCambios,
    () => true,
    () => false
  );
}
