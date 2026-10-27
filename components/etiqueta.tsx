/**
 * Etiqueta de estatus (trabajos) o de pago. El color dice el tipo de
 * estado, no la marca; los cuatro pares están en globals.css con su
 * contraste calculado.
 */
export type Tono = "exito" | "proceso" | "error" | "neutro";

const TONOS: Record<Tono, string> = {
  exito: "bg-exito-fondo text-exito",
  proceso: "bg-proceso-fondo text-proceso",
  error: "bg-error-fondo text-error",
  neutro: "bg-tinte text-primario",
};

export function Etiqueta({ tono, children }: { tono: Tono; children: React.ReactNode }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-3 py-1 text-[0.875rem] font-semibold leading-5 ${TONOS[tono]}`}
    >
      {children}
    </span>
  );
}
