"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { guardarAjustes, type EstadoAjustes } from "./acciones";

const INICIAL: EstadoAjustes = { mensaje: null, error: null };

export default function FormularioAjustes({ contacto }: { contacto: string }) {
  const [estado, enviar] = useActionState(guardarAjustes, INICIAL);

  return (
    <form action={enviar} className="mt-6 flex flex-col gap-4">
      <div>
        <label htmlFor="contacto_soporte" className="block font-semibold">
          Contacto de soporte
        </label>
        <p className="mt-1 text-[0.9375rem] leading-6 text-secundario">
          Correo o teléfono que ven los comisionistas y quien no está dado de alta cuando
          necesitan ayuda. Vacío: no se muestra ningún contacto.
        </p>
        <input
          id="contacto_soporte"
          name="contacto_soporte"
          maxLength={120}
          defaultValue={contacto}
          className="mt-3 w-full rounded-lg border border-borde-campo bg-fondo px-4 py-3 text-[1.0625rem] focus:border-acento"
        />
      </div>

      {estado.error ? (
        <p className="text-[0.9375rem] leading-6 text-error">{estado.error}</p>
      ) : null}
      {estado.mensaje ? (
        <p className="rounded-lg bg-exito-fondo px-4 py-3 text-[0.9375rem] leading-6 text-exito">
          {estado.mensaje}
        </p>
      ) : null}

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
      {pending ? "Guardando…" : "Guardar"}
    </button>
  );
}
