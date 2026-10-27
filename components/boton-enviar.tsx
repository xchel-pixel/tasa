"use client";

import { useFormStatus } from "react-dom";

/**
 * El botón de envío de un formulario: se apaga mientras el servidor
 * responde, para que un doble toque no mande dos veces lo mismo.
 */
export function BotonEnviar({
  children,
  variante = "primario",
  pendiente = "Un momento…",
}: {
  children: React.ReactNode;
  variante?: "primario" | "secundario" | "peligro";
  pendiente?: string;
}) {
  const { pending } = useFormStatus();
  const estilos = {
    primario: "bg-primario text-sobre-primario",
    secundario: "border border-primario bg-fondo text-primario",
    peligro: "border border-error bg-fondo text-error",
  }[variante];
  return (
    <button
      type="submit"
      disabled={pending}
      className={`min-h-12 w-full rounded-lg px-4 py-3 text-[1rem] font-semibold disabled:opacity-50 ${estilos}`}
    >
      {pending ? pendiente : children}
    </button>
  );
}
