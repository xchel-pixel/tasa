"use client";

import { useActionState } from "react";
import { Aviso } from "@/components/aviso";
import { BotonEnviar } from "@/components/boton-enviar";
import { cerrarAlertaCredito, type EstadoAlerta } from "./acciones";

/** Cerrar el pendiente de un crédito no aplicado (0078), con nota opcional. */
export function CerrarAlertaCredito({ alertaId }: { alertaId: string }) {
  const [estado, enviar] = useActionState(cerrarAlertaCredito, { error: null, mensaje: null } as EstadoAlerta);
  if (estado.mensaje) return <Aviso estado={estado} />;
  return (
    <form action={enviar} className="mt-2 flex flex-col gap-2">
      <input type="hidden" name="alerta" value={alertaId} />
      <input name="nota" maxLength={200} placeholder="Nota (opcional)"
        className="w-full rounded-lg border border-borde-campo bg-fondo px-3 py-2 text-[1rem] focus:border-acento" />
      <BotonEnviar variante="secundario">Revisado: cerrar</BotonEnviar>
      <Aviso estado={estado} />
    </form>
  );
}
