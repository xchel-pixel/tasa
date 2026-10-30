"use client";

import { useActionState } from "react";
import { Aviso } from "@/components/aviso";
import { BotonEnviar } from "@/components/boton-enviar";
import { agregarTestimonio, publicarTarjeta, type EstadoTarjeta } from "./acciones";

const INICIAL: EstadoTarjeta = { error: null, mensaje: null };
const ENTRADA = "mt-1 w-full rounded-lg border border-borde-campo bg-fondo px-3 py-2 text-[1rem] focus:border-acento";

export function PublicarTarjeta({ publicar, texto }: { publicar: boolean; texto: string }) {
  const [estado, enviar] = useActionState(publicarTarjeta, INICIAL);
  return (
    <form action={enviar} className="flex flex-col gap-2">
      <input type="hidden" name="publicar" value={publicar ? "si" : "no"} />
      <BotonEnviar variante={publicar ? undefined : "secundario"}>{texto}</BotonEnviar>
      <Aviso estado={estado} />
    </form>
  );
}

export function NuevoTestimonio() {
  const [estado, enviar] = useActionState(agregarTestimonio, INICIAL);
  return (
    <form action={enviar} className="flex flex-col gap-2">
      <label className="block text-[0.9375rem] font-semibold">
        Cliente (nombre o iniciales)
        <input name="cliente" required maxLength={60} className={ENTRADA} placeholder="J. P." />
      </label>
      <label className="block text-[0.9375rem] font-semibold">
        Lo que dijo
        <textarea name="texto" required maxLength={300} rows={3} className={ENTRADA} />
      </label>
      <BotonEnviar variante="secundario">Enviar a aprobación</BotonEnviar>
      <Aviso estado={estado} />
    </form>
  );
}
