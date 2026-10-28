"use client";

import { useActionState } from "react";
import { Aviso } from "@/components/aviso";
import { BotonEnviar } from "@/components/boton-enviar";
import { aceptarTerminos, type EstadoTerminos } from "./acciones";

const INICIAL: EstadoTerminos = { error: null };

export function FormularioTerminos({ version, ligaAviso }: { version: number; ligaAviso: string }) {
  const [estado, enviar] = useActionState(aceptarTerminos, INICIAL);
  return (
    <form action={enviar} className="mt-6 flex flex-col gap-4">
      <input type="hidden" name="version" value={version} />
      <label className="toque flex items-start gap-3 leading-6">
        <input type="checkbox" name="acepto" required className="mt-1 size-5 shrink-0" />
        <span>
          Leí y acepto los términos y el{" "}
          <a href={ligaAviso} target="_blank" rel="noopener" className="font-semibold text-acento underline underline-offset-4">
            aviso de privacidad
          </a>
          .
        </span>
      </label>
      <Aviso estado={estado} />
      <BotonEnviar pendiente="Guardando…">Aceptar y continuar</BotonEnviar>
    </form>
  );
}
