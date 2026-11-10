"use client";

import { useActionState, useState } from "react";
import { Aviso } from "@/components/aviso";
import { BotonEnviar } from "@/components/boton-enviar";
import { pesos } from "@/lib/formato";
import { TIPO_COMPRA, type Paquete, type TipoCompra } from "@/lib/paquetes";
import { cancelarCompra, pedirPaquete, type EstadoPaquete } from "./acciones";

const INICIAL: EstadoPaquete = { error: null, mensaje: null };

/**
 * Elegir paquete y aceptar los términos (en dos pasos). `opciones` ya viene filtrado: para subir, solo los mayores,
 * con la diferencia de precio y de crédito. Con comisión suficiente, se puede pagar con ella.
 */
export function ComprarPaquete({ tipo, opciones, terminos, comision, texto }: {
  tipo: TipoCompra; opciones: (Paquete & { pagar: number; recibe: number })[]; terminos: { version: number; texto: string };
  comision: number; texto: string;
}) {
  const [estado, enviar] = useActionState(pedirPaquete, INICIAL);
  const [elegido, setElegido] = useState<string | null>(null);
  if (estado.mensaje) return <Aviso estado={estado} />;
  const p = opciones.find((o) => o.id === elegido) ?? null;
  return (
    <div className="mt-3 flex flex-col gap-2">
      <ul className="flex flex-col gap-2">
        {opciones.map((o) => (
          <li key={o.id}>
            <button type="button" onClick={() => setElegido(o.id)} aria-pressed={elegido === o.id}
              className={`w-full rounded-xl border px-4 py-3 text-left ${elegido === o.id ? "border-primario bg-tinte" : "border-linea"}`}>
              <span className="flex items-baseline justify-between gap-3">
                <span className="font-bold">{o.nombre}</span>
                <span className="font-bold tabular-nums">{pesos(o.pagar)}</span>
              </span>
              <span className="block text-[0.9375rem] text-secundario">
                Recibes {pesos(o.recibe)} de crédito · {o.meses} mes{o.meses === 1 ? "" : "es"}
              </span>
              <span className="mt-1 block text-[0.9375rem] leading-6">{o.beneficios}</span>
            </button>
          </li>
        ))}
      </ul>
      {p ? (
        <form action={enviar} className="mt-2 flex flex-col gap-3 rounded-xl border border-linea px-4 py-3">
          <input type="hidden" name="paquete" value={p.id} />
          <input type="hidden" name="tipo" value={tipo} />
          <input type="hidden" name="terminos" value={terminos.version} />
          <p className="font-semibold">{TIPO_COMPRA[tipo]}: {p.nombre} · {pesos(p.pagar)} (IVA incluido)</p>
          <div className="max-h-48 overflow-y-auto rounded-lg bg-alterno px-3 py-2 text-[0.875rem] leading-6">
            <p className="font-semibold">Términos del paquete (versión {terminos.version})</p>
            <p className="mt-1">{terminos.texto}</p>
          </div>
          <label className="flex items-start gap-2 text-[0.9375rem] leading-6">
            <input type="checkbox" name="acepto" required className="mt-1 h-5 w-5 shrink-0" />
            Acepto los términos del paquete.
          </label>
          {tipo !== "subida" && comision >= p.pagar ? (
            <fieldset className="flex flex-col gap-1 text-[0.9375rem]">
              <legend className="font-semibold">¿Cómo lo pagas?</legend>
              <label className="flex items-center gap-2"><input type="radio" name="forma" value="transferencia" defaultChecked /> Transferencia</label>
              <label className="flex items-center gap-2">
                <input type="radio" name="forma" value="comision" /> Convertir mi comisión en crédito ({pesos(comision)} por cobrar; el resto se te paga normal)
              </label>
            </fieldset>
          ) : null}
          <BotonEnviar>{texto}</BotonEnviar>
          <Aviso estado={estado} />
        </form>
      ) : null}
    </div>
  );
}

export function CancelarCompra({ compra }: { compra: string }) {
  const [estado, enviar] = useActionState(cancelarCompra, INICIAL);
  if (estado.mensaje) return <Aviso estado={estado} />;
  return (
    <form action={enviar} className="mt-3">
      <input type="hidden" name="compra" value={compra} />
      <BotonEnviar variante="secundario">Cancelar esta compra</BotonEnviar>
      <Aviso estado={estado} />
    </form>
  );
}
