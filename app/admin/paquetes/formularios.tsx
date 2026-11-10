"use client";

import { useActionState, useState } from "react";
import { Aviso } from "@/components/aviso";
import { BotonEnviar } from "@/components/boton-enviar";
import { aplicarCredito, cancelarCompraAdmin, confirmarCompra, type EstadoConfirmar } from "./acciones";

const INICIAL: EstadoConfirmar = { error: null, mensaje: null };
const ENTRADA = "mt-1 w-full rounded-lg border border-borde-campo bg-fondo px-3 py-2 text-[1rem] focus:border-acento";

/** Confirmar el pago de una compra: monto (el precio), fecha, cuenta, referencia y folio CFDI de anticipo (opcional). */
export function ConfirmarCompra({ compra, precio, cuentas, cuentaSugerida, hoy }: {
  compra: string; precio: number; cuentas: { id: string; alias: string | null }[]; cuentaSugerida: string | null; hoy: string;
}) {
  const [estado, enviar] = useActionState(confirmarCompra, INICIAL);
  const [cancelar, enviarCancelar] = useActionState(cancelarCompraAdmin, INICIAL);
  const [abierto, setAbierto] = useState(false);
  if (estado.mensaje) return <Aviso estado={estado} />;
  if (cancelar.mensaje) return <Aviso estado={cancelar} />;
  if (!abierto) {
    return (
      <button type="button" onClick={() => setAbierto(true)}
        className="mt-2 flex min-h-11 w-full items-center justify-center rounded-lg bg-primario px-3 font-semibold text-sobre-primario">
        Confirmar pago
      </button>
    );
  }
  return (
    <div className="mt-2 flex flex-col gap-3">
      <form action={enviar} className="grid grid-cols-2 gap-3 rounded-lg border border-linea px-3 py-3">
        <input type="hidden" name="compra" value={compra} />
        <label className="block text-[0.875rem] font-semibold">Monto recibido
          <input name="monto" inputMode="decimal" required defaultValue={precio} className={ENTRADA} />
        </label>
        <label className="block text-[0.875rem] font-semibold">Fecha del pago
          <input name="fecha" type="date" required max={hoy} defaultValue={hoy} className={ENTRADA} />
        </label>
        <label className="col-span-2 block text-[0.875rem] font-semibold">Cuenta
          <select name="cuenta" required defaultValue={cuentaSugerida ?? ""} className={ENTRADA}>
            <option value="" disabled>Elige la cuenta</option>
            {cuentas.map((c) => <option key={c.id} value={c.id}>{c.alias ?? c.id.slice(0, 8)}</option>)}
          </select>
        </label>
        <label className="block text-[0.875rem] font-semibold">Referencia
          <input name="referencia" required maxLength={80} className={ENTRADA} />
        </label>
        <label className="block text-[0.875rem] font-semibold">Folio CFDI de anticipo
          <input name="cfdi" maxLength={60} placeholder="Opcional" className={ENTRADA} />
        </label>
        <div className="col-span-2"><BotonEnviar>Confirmar y cargar el crédito</BotonEnviar></div>
        <div className="col-span-2"><Aviso estado={estado} /></div>
      </form>
      <form action={enviarCancelar} className="flex flex-col gap-2">
        <input type="hidden" name="compra" value={compra} />
        <input type="hidden" name="motivo" value="Cancelada por Administración: no llegó el pago" />
        <BotonEnviar variante="secundario">No llegó el pago: cancelar la compra</BotonEnviar>
        <Aviso estado={cancelar} />
      </form>
    </div>
  );
}

/** En el detalle del trámite: aplicar crédito (vacío = lo más que se pueda). */
export function AplicarCredito({ solicitud, maximo }: { solicitud: string; maximo: number }) {
  const [estado, enviar] = useActionState(aplicarCredito, INICIAL);
  if (estado.mensaje) return <Aviso estado={estado} />;
  return (
    <form action={enviar} className="mt-3 flex flex-col gap-2">
      <input type="hidden" name="solicitud" value={solicitud} />
      <label className="block text-[0.9375rem] font-semibold">Monto a aplicar
        <input name="monto" inputMode="decimal" placeholder={`Hasta ${maximo.toLocaleString("es-MX", { minimumFractionDigits: 2 })}`} className={ENTRADA} />
      </label>
      <BotonEnviar variante="secundario">Aplicar crédito</BotonEnviar>
      <Aviso estado={estado} />
    </form>
  );
}
