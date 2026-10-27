"use client";

import { useActionState, useState } from "react";
import { BotonEnviar } from "@/components/boton-enviar";
import { Aviso } from "@/components/pantalla-admin";
import { revisarPago, type EstadoRevision } from "./acciones";

const INICIAL: EstadoRevision = { error: null, mensaje: null };

/** Confirmar es un toque; rechazar pide el motivo antes. */
export default function RevisarPago({ pagoId, excede }: { pagoId: string; excede: boolean }) {
  const [estado, enviar] = useActionState(revisarPago, INICIAL);
  const [rechazando, setRechazando] = useState(false);

  if (estado.mensaje) return <div className="mt-3"><Aviso estado={estado} /></div>;

  return (
    <form action={enviar} className="mt-3 flex flex-col gap-3">
      <input type="hidden" name="pago" value={pagoId} />
      {excede ? (
        <p className="rounded-lg bg-proceso-fondo px-3 py-2 text-[0.9375rem] text-proceso">
          Este monto es mayor que lo que falta del trabajo.
        </p>
      ) : null}

      {rechazando ? (
        <>
          <label htmlFor={`motivo-${pagoId}`} className="font-semibold">Motivo del rechazo</label>
          <textarea
            id={`motivo-${pagoId}`}
            name="motivo"
            rows={2}
            required
            placeholder="Lo verá el comisionista"
            className="w-full rounded-lg border border-borde-campo bg-fondo px-4 py-3 focus:border-acento"
          />
          <input type="hidden" name="decision" value="rechazar" />
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setRechazando(false)}
              className="min-h-12 rounded-lg border border-linea px-4 font-semibold text-secundario"
            >
              Volver
            </button>
            <BotonEnviar variante="peligro">Rechazar</BotonEnviar>
          </div>
        </>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setRechazando(true)}
            className="min-h-12 rounded-lg border border-error px-4 font-semibold text-error"
          >
            Rechazar
          </button>
          <input type="hidden" name="decision" value="confirmar" />
          <BotonEnviar>Confirmar</BotonEnviar>
        </div>
      )}
      <Aviso estado={estado} />
    </form>
  );
}
