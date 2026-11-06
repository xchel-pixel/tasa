"use client";

import { useActionState } from "react";
import { liberarCupo, pedirMasCupo, type EstadoCupo } from "@/app/acciones-cupos";
import { Aviso } from "@/components/aviso";
import { BotonEnviar } from "@/components/boton-enviar";

const INICIAL: EstadoCupo = { error: null, mensaje: null };
const ENTRADA = "w-full rounded-lg border border-borde-campo bg-fondo px-3 py-2 text-[1rem] focus:border-acento";

export function PedirMas({ herramienta }: { herramienta: string }) {
  const [estado, enviar] = useActionState(pedirMasCupo, INICIAL);
  return (
    <form action={enviar} className="mt-2 flex flex-col gap-2">
      <input type="hidden" name="herramienta" value={herramienta} />
      <BotonEnviar variante="secundario">Pedir más</BotonEnviar>
      <Aviso estado={estado} />
    </form>
  );
}

/** Liberar cálculos extra (solo el mes en curso), con motivo. Con `herramienta`, ya viene elegida (desde la alerta). */
export function LiberarCupo({ personaId, herramienta, opciones }: { personaId: string; herramienta?: string; opciones: { clave: string; nombre: string }[] }) {
  const [estado, enviar] = useActionState(liberarCupo, INICIAL);
  return (
    <form action={enviar} className="mt-2 flex flex-col gap-2">
      <input type="hidden" name="persona" value={personaId} />
      {herramienta ? <input type="hidden" name="herramienta" value={herramienta} /> : (
        <label className="block text-[0.9375rem] font-semibold">Herramienta
          <select name="herramienta" className={`mt-1 ${ENTRADA}`}>
            {opciones.map((o) => <option key={o.clave} value={o.clave}>{o.nombre}</option>)}
          </select>
        </label>
      )}
      <div className="grid grid-cols-[6rem_1fr] gap-2">
        <label className="block text-[0.9375rem] font-semibold">Cantidad
          <input name="cantidad" inputMode="numeric" required pattern="\d{1,3}" className={`mt-1 ${ENTRADA}`} />
        </label>
        <label className="block text-[0.9375rem] font-semibold">Motivo
          <input name="motivo" required minLength={3} maxLength={300} className={`mt-1 ${ENTRADA}`} placeholder="Ej. cierre de varias operaciones" />
        </label>
      </div>
      <BotonEnviar variante="secundario">Liberar este mes</BotonEnviar>
      <Aviso estado={estado} />
    </form>
  );
}
