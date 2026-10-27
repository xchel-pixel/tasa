"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { aceptarCotizacion } from "./acciones";

/**
 * Aceptar no se deshace: el botón pide confirmar en un segundo toque
 * en vez de un diálogo del navegador, que en el teléfono se ve ajeno.
 */
export default function AceptarCotizacion({ cotizacionId }: { cotizacionId: string }) {
  const [estado, enviar] = useActionState(aceptarCotizacion, { error: null as string | null });

  return (
    <form action={enviar} className="mt-4 flex flex-col gap-3">
      <input type="hidden" name="cotizacion" value={cotizacionId} />
      <label className="flex items-start gap-3 text-[0.9375rem] leading-6">
        <input type="checkbox" name="confirmo" required className="mt-1 h-5 w-5 accent-primario" />
        El cliente aceptó la cotización y el trabajo debe arrancar.
      </label>
      {estado.error ? <p className="text-[0.9375rem] leading-6 text-error">{estado.error}</p> : null}
      <Boton />
    </form>
  );
}

function Boton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="min-h-12 w-full rounded-lg bg-primario px-4 py-3 text-[1.0625rem] font-semibold text-sobre-primario disabled:opacity-50"
    >
      {pending ? "Un momento…" : "Aceptar cotización"}
    </button>
  );
}
