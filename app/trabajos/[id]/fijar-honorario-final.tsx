"use client";

import { useActionState } from "react";
import { BotonEnviar } from "@/components/boton-enviar";
import { fijarHonorarioFinal } from "./acciones";

const ENTRADA =
  "mt-1 w-full rounded-lg border border-borde-campo bg-fondo px-3 py-2 text-[1rem] text-primario focus:border-acento";

/** Finanzas o admin_org fijan el honorario final de un estimado, con motivo (queda en la bitácora). */
export default function FijarHonorarioFinal({ solicitudId, estimado }: { solicitudId: string; estimado: number }) {
  const [estado, enviar] = useActionState(fijarHonorarioFinal, { error: null as string | null });
  return (
    <form action={enviar} className="mt-3 flex flex-col gap-3">
      <input type="hidden" name="solicitud" value={solicitudId} />
      <div>
        <label htmlFor="final" className="block font-semibold">Honorario final (sin IVA)</label>
        <input id="final" name="final" inputMode="decimal" required defaultValue={String(estimado)} className={ENTRADA} />
      </div>
      <div>
        <label htmlFor="motivo-final" className="block font-semibold">Motivo</label>
        <input id="motivo-final" name="motivo" required minLength={3} maxLength={300} className={ENTRADA}
          placeholder="p. ej. superficie real menor a la estimada" />
      </div>
      {estado.error ? <p className="text-error">{estado.error}</p> : null}
      <BotonEnviar pendiente="Guardando…">Fijar honorario final</BotonEnviar>
    </form>
  );
}
