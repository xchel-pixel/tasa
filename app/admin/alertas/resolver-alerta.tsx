"use client";

import { useActionState, useState } from "react";
import { BotonEnviar } from "@/components/boton-enviar";
import { Aviso } from "@/components/pantalla-admin";
import { resolverAlerta, type EstadoAlerta } from "./acciones";

export default function ResolverAlerta({ alertaId, solicitudId }: { alertaId: string; solicitudId: string }) {
  const [estado, enviar] = useActionState<EstadoAlerta, FormData>(resolverAlerta, { error: null, mensaje: null });
  const [decision, setDecision] = useState<"cancelar" | "descartar" | null>(null);

  if (estado.mensaje) return <div className="mt-3"><Aviso estado={estado} /></div>;

  if (!decision) {
    return (
      <div className="mt-3 grid grid-cols-2 gap-2">
        <button type="button" onClick={() => setDecision("descartar")}
          className="min-h-12 rounded-lg border border-linea px-3 font-semibold text-secundario">
          Descartar
        </button>
        <button type="button" onClick={() => setDecision("cancelar")}
          className="min-h-12 rounded-lg border border-error px-3 font-semibold text-error">
          Cancelar trabajo
        </button>
      </div>
    );
  }

  return (
    <form action={enviar} className="mt-3 flex flex-col gap-3">
      <input type="hidden" name="alerta" value={alertaId} />
      <input type="hidden" name="solicitud" value={solicitudId} />
      <input type="hidden" name="decision" value={decision} />
      <label htmlFor={`texto-${alertaId}`} className="font-semibold">
        {decision === "cancelar" ? "Motivo de la cancelación" : "Por qué se descarta"}
      </label>
      <textarea id={`texto-${alertaId}`} name="texto" rows={2} required
        className="w-full rounded-lg border border-borde-campo bg-fondo px-4 py-3 focus:border-acento" />
      <div className="grid grid-cols-2 gap-2">
        <button type="button" onClick={() => setDecision(null)}
          className="min-h-12 rounded-lg border border-linea px-3 font-semibold text-secundario">
          Volver
        </button>
        <BotonEnviar variante={decision === "cancelar" ? "peligro" : "primario"}>
          {decision === "cancelar" ? "Cancelar trabajo" : "Descartar"}
        </BotonEnviar>
      </div>
      <Aviso estado={estado} />
    </form>
  );
}
