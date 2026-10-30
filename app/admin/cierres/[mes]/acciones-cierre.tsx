"use client";

import { useActionState } from "react";
import { BotonEnviar } from "@/components/boton-enviar";
import { Aviso } from "@/components/aviso";
import { marcarBonoEquipoPagado, moverCierre, type EstadoCierre } from "./acciones";

const INICIAL: EstadoCierre = { error: null, mensaje: null };

export function AccionCierre({ mes, accion, texto }: { mes: string; accion: "preparar" | "aprobar"; texto: string }) {
  const [estado, enviar] = useActionState(moverCierre, INICIAL);
  return (
    <form action={enviar} className="flex flex-col gap-3">
      <input type="hidden" name="mes" value={mes} />
      <input type="hidden" name="accion" value={accion} />
      {accion === "aprobar" ? (
        <label className="flex items-start gap-3 text-[0.9375rem] leading-6">
          <input type="checkbox" name="confirmo" required className="mt-1 h-5 w-5 accent-primario" />
          Revisé el cierre. Al aprobarlo queda bloqueado, se publica el estado de cuenta y se calculan los niveles del
          mes siguiente.
        </label>
      ) : null}
      <BotonEnviar variante={accion === "aprobar" ? "primario" : "secundario"}>{texto}</BotonEnviar>
      <Aviso estado={estado} />
    </form>
  );
}


export function MarcarBonoPagado({ bonoId }: { bonoId: string }) {
  const [estado, enviar] = useActionState(marcarBonoEquipoPagado, INICIAL);
  const hoy = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City" }).format(new Date());
  return (
    <form action={enviar} className="mt-2 flex flex-col gap-2">
      <input type="hidden" name="bono" value={bonoId} />
      <div className="grid grid-cols-2 gap-2">
        <input name="fecha" type="date" required defaultValue={hoy} max={hoy} aria-label="Fecha de pago"
          className="rounded-lg border border-borde-campo bg-fondo px-3 py-2" />
        <input name="referencia" maxLength={200} placeholder="Referencia" aria-label="Referencia del pago"
          className="rounded-lg border border-borde-campo bg-fondo px-3 py-2" />
      </div>
      <BotonEnviar variante="secundario">Marcar pagado</BotonEnviar>
      <Aviso estado={estado} />
    </form>
  );
}
