"use client";

import { useActionState } from "react";
import { Aviso } from "@/components/aviso";
import { BotonEnviar } from "@/components/boton-enviar";
import { guardarClabeCobro, type EstadoClabe } from "./acciones";

/** La CLABE donde recibe sus pagos de comisión. Opcional; la valida la base con su dígito de control. */
export function ClabeCobro({ actual }: { actual: string | null }) {
  const [estado, enviar] = useActionState<EstadoClabe, FormData>(guardarClabeCobro, { error: null, mensaje: null });
  return (
    <form action={enviar} className="mt-6 flex flex-col gap-2 rounded-xl border border-linea px-4 py-4">
      <label htmlFor="clabe" className="font-semibold">CLABE para tus pagos de comisión</label>
      <p className="text-[0.9375rem] leading-6 text-secundario">18 dígitos. Solo la ven tú y Administración.</p>
      <input id="clabe" name="clabe" inputMode="numeric" autoComplete="off" maxLength={22} defaultValue={actual ?? ""}
        className="mt-1 w-full rounded-lg border border-borde-campo bg-fondo px-3 py-2 text-[1rem] tracking-wider focus:border-acento" />
      <BotonEnviar variante="secundario">Guardar CLABE</BotonEnviar>
      <Aviso estado={estado} />
    </form>
  );
}
