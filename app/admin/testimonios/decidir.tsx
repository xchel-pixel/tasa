"use client";

import { useActionState } from "react";
import { Aviso } from "@/components/aviso";
import { decidirTestimonio, type EstadoTestimonio } from "./acciones";

export function DecidirTestimonio({ testimonioId }: { testimonioId: string }) {
  const [estado, enviar] = useActionState<EstadoTestimonio, FormData>(decidirTestimonio, { error: null, mensaje: null });
  if (estado.mensaje) return <div className="mt-2"><Aviso estado={estado} /></div>;
  return (
    <form action={enviar} className="mt-2 flex flex-col gap-2">
      <input type="hidden" name="testimonio" value={testimonioId} />
      <input name="motivo" maxLength={300} placeholder="Motivo (obligatorio para rechazar)"
        className="rounded-lg border border-borde-campo bg-fondo px-3 py-2 text-[0.9375rem]" />
      <div className="grid grid-cols-2 gap-2">
        <button type="submit" name="decision" value="aprobar" className="min-h-11 rounded-lg bg-primario px-3 font-semibold text-sobre-primario">
          Aprobar
        </button>
        <button type="submit" name="decision" value="rechazar" className="min-h-11 rounded-lg border border-error px-3 font-semibold text-error">
          Rechazar
        </button>
      </div>
      <Aviso estado={estado} />
    </form>
  );
}
