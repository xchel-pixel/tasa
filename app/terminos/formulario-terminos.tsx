"use client";

import { useActionState } from "react";
import { Aviso } from "@/components/aviso";
import { BotonEnviar } from "@/components/boton-enviar";
import { aceptarTerminos, type EstadoTerminos } from "./acciones";

const INICIAL: EstadoTerminos = { error: null };

export function FormularioTerminos({ version }: { version: number }) {
  const [estado, enviar] = useActionState(aceptarTerminos, INICIAL);
  return (
    <form action={enviar} className="mt-6 flex flex-col gap-4">
      <input type="hidden" name="version" value={version} />
      <label className="toque flex items-start gap-3 leading-6">
        <input type="checkbox" name="acepto" required className="mt-1 size-5 shrink-0" />
        <span>Leí y acepto los términos.</span>
      </label>
      <Aviso estado={estado} />
      <BotonEnviar pendiente="Guardando…">Aceptar y continuar</BotonEnviar>
    </form>
  );
}
