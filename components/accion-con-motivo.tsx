"use client";

import { useActionState, useState } from "react";
import { deshacer, type AccionDeshacer, type EstadoDeshacer } from "@/app/acciones-deshacer";
import { Aviso } from "@/components/aviso";
import { BotonEnviar } from "@/components/boton-enviar";

/**
 * Un botón de deshacer en dos pasos: primero se abre la confirmación con
 * lo que va a pasar y el motivo (obligatorio); después se confirma.
 */
export function AccionConMotivo({
  que,
  id,
  texto,
  explicacion,
}: {
  que: AccionDeshacer;
  id: string;
  texto: string;
  /** Qué pasa al confirmar, en una o dos frases. */
  explicacion: string;
}) {
  const [estado, enviar] = useActionState<EstadoDeshacer, FormData>(deshacer, { error: null, mensaje: null });
  const [abierto, setAbierto] = useState(false);

  if (estado.mensaje) return <div className="mt-2"><Aviso estado={estado} /></div>;
  if (!abierto) {
    return (
      <button
        type="button"
        onClick={() => setAbierto(true)}
        className="toque mt-1 text-[0.9375rem] font-semibold text-error underline underline-offset-4"
      >
        {texto}
      </button>
    );
  }
  return (
    <form action={enviar} className="mt-3 flex flex-col gap-3 rounded-lg border border-error bg-error-fondo px-3 py-3">
      <input type="hidden" name="que" value={que} />
      <input type="hidden" name="id" value={id} />
      <p className="text-[0.9375rem] leading-6 text-texto">{explicacion}</p>
      <label htmlFor={`motivo-${que}-${id}`} className="block text-[0.9375rem] font-semibold">Motivo</label>
      <textarea
        id={`motivo-${que}-${id}`}
        name="motivo"
        required
        rows={2}
        maxLength={300}
        className="-mt-2 w-full rounded-lg border border-borde-campo bg-fondo px-3 py-2 text-[1rem] focus:border-acento"
      />
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => setAbierto(false)}
          className="min-h-12 rounded-lg border border-linea bg-fondo px-3 font-semibold text-secundario"
        >
          No, dejarlo
        </button>
        <BotonEnviar variante="peligro">Sí, {texto.charAt(0).toLowerCase() + texto.slice(1)}</BotonEnviar>
      </div>
      <Aviso estado={estado} />
    </form>
  );
}

/** Lo que se muestra en lugar del botón cuando el mes ya cerró. */
export function MesCerrado() {
  return (
    <p className="mt-1 text-[0.875rem] leading-5 text-secundario">
      Mes cerrado: corrige con un ajuste en el mes abierto.
    </p>
  );
}
