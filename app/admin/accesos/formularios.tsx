"use client";

import { useActionState, useState } from "react";
import { Aviso } from "@/components/aviso";
import { BotonEnviar } from "@/components/boton-enviar";
import { accionAcceso, type EstadoAcceso } from "./acciones";

const INICIAL: EstadoAcceso = { error: null, mensaje: null };

/** Suspender, reactivar o cerrar sesiones: en dos pasos, con lo que va a pasar y el motivo (obligatorio). */
export function AccionAcceso({ que, personaId, texto, explicacion, peligro = false }: {
  que: "suspender" | "reactivar" | "cerrar"; personaId: string; texto: string; explicacion: string; peligro?: boolean;
}) {
  const [estado, enviar] = useActionState(accionAcceso, INICIAL);
  const [abierto, setAbierto] = useState(false);
  if (estado.mensaje) return <Aviso estado={estado} />;
  if (!abierto) {
    return (
      <button type="button" onClick={() => setAbierto(true)}
        className={`flex min-h-11 w-full items-center justify-center rounded-lg border px-3 font-semibold ${peligro ? "border-error text-error" : "border-linea bg-fondo"}`}>
        {texto}
      </button>
    );
  }
  return (
    <form action={enviar} className={`flex flex-col gap-3 rounded-lg border px-3 py-3 ${peligro ? "border-error bg-error-fondo" : "border-linea"}`}>
      <input type="hidden" name="que" value={que} />
      <input type="hidden" name="persona" value={personaId} />
      <p className="text-[0.9375rem] leading-6 text-texto">{explicacion}</p>
      <label className="block text-[0.9375rem] font-semibold">Motivo
        <textarea name="motivo" required minLength={3} maxLength={300} rows={2}
          className="mt-1 w-full rounded-lg border border-borde-campo bg-fondo px-3 py-2 text-[1rem] focus:border-acento" />
      </label>
      <div className="grid grid-cols-2 gap-2">
        <button type="button" onClick={() => setAbierto(false)} className="min-h-12 rounded-lg border border-linea bg-fondo px-3 font-semibold text-secundario">
          No, dejarlo
        </button>
        <BotonEnviar variante={peligro ? "peligro" : "primario"}>{texto}</BotonEnviar>
      </div>
      <Aviso estado={estado} />
    </form>
  );
}
