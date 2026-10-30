"use client";

import { useActionState } from "react";
import { Aviso } from "@/components/aviso";
import { BotonEnviar } from "@/components/boton-enviar";
import { cerrarAlerta, liberarTelefono, type EstadoAlerta } from "./acciones";

const INICIAL: EstadoAlerta = { error: null, mensaje: null };

/** Teléfono que llegó al límite de la liga: liberarlo para que vuelva a enviar. */
export function LiberarTelefono({ alertaId }: { alertaId: string }) {
  const [estado, enviar] = useActionState(liberarTelefono, INICIAL);
  if (estado.mensaje) return <div className="mt-3"><Aviso estado={estado} /></div>;
  return (
    <form action={enviar} className="mt-3 flex flex-col gap-2">
      <input type="hidden" name="alerta" value={alertaId} />
      <BotonEnviar variante="secundario">Liberar este teléfono</BotonEnviar>
      <Aviso estado={estado} />
    </form>
  );
}

/** Cerrar una alerta que ya no pide nada (la conexión se libera sola en 24 horas). */
export function CerrarAlerta({ alertaId }: { alertaId: string }) {
  const [estado, enviar] = useActionState(cerrarAlerta, INICIAL);
  if (estado.mensaje) return <div className="mt-3"><Aviso estado={estado} /></div>;
  return (
    <form action={enviar} className="mt-3 flex flex-col gap-2">
      <input type="hidden" name="alerta" value={alertaId} />
      <input type="hidden" name="nota" value="Revisada: el límite por conexión se libera solo" />
      <BotonEnviar variante="secundario">Marcar como revisada</BotonEnviar>
      <Aviso estado={estado} />
    </form>
  );
}
