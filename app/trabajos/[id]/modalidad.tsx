"use client";

import { useActionState, useState } from "react";
import { Aviso } from "@/components/aviso";
import { BotonEnviar } from "@/components/boton-enviar";
import { pesos } from "@/lib/formato";
import { aplicarModalidad, revertirModalidad, type EstadoModalidad } from "./acciones-modalidad";

export type VistaModalidad = {
  modalidad: "descontada" | "tomada" | null; motivo: string | null; pct: number; comision: number; honorario: number; honorario_neto: number;
  requiere_factura: boolean; total: number; confirmado: number; regla: "convenio" | "nivel"; mes_aprobado: boolean;
};

const INICIAL: EstadoModalidad = { error: null, mensaje: null };

/**
 * Comisión descontada al cliente (A) o cobrada directamente por el comisionista (B), 0079. Muestra la cuenta antes de
 * confirmar; admin_org y finanzas. Revertir pide motivo y solo hasta que el mes entre a un cierre aprobado.
 */
export function ModalidadComision({ solicitud, v }: { solicitud: string; v: VistaModalidad }) {
  const [estado, enviar] = useActionState(aplicarModalidad, INICIAL);
  const [rev, enviarRev] = useActionState(revertirModalidad, INICIAL);
  const [elegida, setElegida] = useState<"descontada" | "tomada" | null>(null);
  const tasa = `${Number(v.pct).toLocaleString("es-MX")} %${v.regla === "convenio" ? " del convenio" : " vigente"}`;
  if (estado.mensaje) return <Aviso estado={estado} />;
  if (rev.mensaje) return <Aviso estado={rev} />;

  if (v.modalidad) {
    return (
      <div className="flex flex-col gap-2 text-[0.9375rem] leading-6">
        <p>
          {v.modalidad === "descontada"
            ? <>Comisión descontada al cliente: {pesos(v.comision)} ({tasa}). Honorario original {pesos(v.honorario)}, se cobran {pesos(v.honorario_neto)}. Sin comisión ni bono por referido.</>
            : <>El comisionista ya tomó su comisión: {pesos(v.comision)} ({tasa}), conciliada como pago. Se cobra el neto; la comisión no entra al cierre.</>}
        </p>
        {v.mes_aprobado ? <p className="text-secundario">Ya entró a un cierre aprobado: no se revierte.</p> : (
          <form action={enviarRev} className="flex flex-col gap-2">
            <input type="hidden" name="solicitud" value={solicitud} />
            <label className="block font-semibold">Motivo para revertir
              <input name="motivo" required minLength={3} maxLength={200} className="mt-1 w-full rounded-lg border border-borde-campo bg-fondo px-3 py-2 text-[1rem]" />
            </label>
            <BotonEnviar variante="secundario">Revertir</BotonEnviar>
            <Aviso estado={rev} />
          </form>
        )}
      </div>
    );
  }
  if (v.motivo) return <p className="text-[0.9375rem] text-secundario">No aplica: {v.motivo}.</p>;

  const neto = v.honorario - v.comision;
  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-2 gap-2">
        {([["descontada", "Pago con comisión descontada"], ["tomada", "El comisionista ya tomó su comisión"]] as const).map(([m, t]) => (
          <button key={m} type="button" onClick={() => setElegida(m)} aria-pressed={elegida === m}
            className={`min-h-12 rounded-lg border px-3 py-2 text-[0.9375rem] font-semibold ${elegida === m ? "border-primario bg-tinte" : "border-linea"}`}>{t}</button>
        ))}
      </div>
      {elegida ? (
        <form action={enviar} className="flex flex-col gap-2 rounded-lg border border-linea px-3 py-3 text-[0.9375rem] leading-6">
          <input type="hidden" name="solicitud" value={solicitud} />
          <input type="hidden" name="modalidad" value={elegida} />
          {elegida === "descontada" ? (
            <p>
              Honorario {pesos(v.honorario)} − comisión {pesos(v.comision)} ({tasa}) = <span className="font-bold">{pesos(neto)}</span>
              {v.requiere_factura ? " + IVA" : ""}. El cliente paga eso; el comisionista no recibe comisión ni bono por referido y su volumen suma {pesos(neto)}.
            </p>
          ) : (
            <p>
              El total no cambia ({pesos(v.total)}). Entra un pago de {pesos(v.comision)} ({tasa}) como comisión cobrada directamente; falta registrar el neto
              entregado ({pesos(v.total - v.comision - v.confirmado)}). La comisión queda pagada y no entra al cierre.
            </p>
          )}
          <label className="block font-semibold">Nota (opcional)
            <input name="motivo" maxLength={200} className="mt-1 w-full rounded-lg border border-borde-campo bg-fondo px-3 py-2 text-[1rem]" />
          </label>
          <BotonEnviar>Confirmar</BotonEnviar>
          <Aviso estado={estado} />
        </form>
      ) : null}
    </div>
  );
}
