"use client";

import { useActionState, useState } from "react";
import { Aviso } from "@/components/aviso";
import { BotonEnviar } from "@/components/boton-enviar";
import { CampoArchivo } from "@/components/campo-archivo";
import { asignarComisionista, entregarPago, generaComision, type EstadoEstatus } from "./acciones";

const INICIAL: EstadoEstatus = { error: null, mensaje: null };
const ENTRADA =
  "mt-1 w-full rounded-lg border border-borde-campo bg-fondo px-3 py-2 text-[1rem] focus:border-acento";

/** "Ya lo entregué": comprobante del depósito a la cuenta (el staff puede marcarlo sin archivo). */
export function EntregarPago({ pagoId, solicitudId, carpeta, staff }: { pagoId: string; solicitudId: string; carpeta: string; staff: boolean }) {
  const [estado, enviar] = useActionState(entregarPago, INICIAL);
  const [ruta, setRuta] = useState<string | null>(null);
  return (
    <form action={enviar} className="mt-3 flex flex-col gap-3 border-t border-linea pt-3">
      <input type="hidden" name="pago" value={pagoId} />
      <input type="hidden" name="solicitud" value={solicitudId} />
      <CampoArchivo
        bucket="comprobantes"
        carpeta={carpeta}
        nombre="entrega_ruta"
        etiqueta="Comprobante del depósito a la cuenta"
        ayuda="Foto o PDF de la transferencia o el depósito que hiciste a la cuenta de la cotización."
        opcional={staff}
        onCambio={setRuta}
      />
      {staff || ruta ? <BotonEnviar variante="secundario" pendiente="Guardando…">Ya lo entregué</BotonEnviar> : null}
      <Aviso estado={estado} />
    </form>
  );
}

/** Asignar o cambiar el comisionista del trámite, con motivo (queda en el historial y se le avisa por correo). */
export function AsignarComisionista({
  solicitudId,
  actual,
  comisionistas,
}: {
  solicitudId: string;
  actual: string | null;
  comisionistas: { id: string; nombre: string }[];
}) {
  const [estado, enviar] = useActionState(asignarComisionista, INICIAL);
  return (
    <form action={enviar} className="flex flex-col gap-3">
      <input type="hidden" name="solicitud" value={solicitudId} />
      <label className="block">
        <span className="font-semibold">{actual ? "Cambiar comisionista" : "Asignar comisionista"}</span>
        <select name="comisionista" required defaultValue="" className={ENTRADA}>
          <option value="" disabled>Elige…</option>
          {comisionistas.filter((c) => c.id !== actual).map((c) => (
            <option key={c.id} value={c.id}>{c.nombre}</option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="font-semibold">Motivo</span>
        <input name="motivo" required minLength={3} maxLength={300} className={ENTRADA} placeholder="p. ej. el cliente lo trajo él" />
      </label>
      <p className="text-[0.9375rem] leading-6 text-secundario">
        Si ya está pagado, la comisión pasa al nuevo: si su mes ya cerró, entra como ajuste en el siguiente cierre (y al anterior
        se le descuenta con un cargo).
      </p>
      <BotonEnviar variante="secundario" pendiente="Guardando…">{actual ? "Cambiar comisionista" : "Asignar"}</BotonEnviar>
      <Aviso estado={estado} />
    </form>
  );
}

/** "Genera comisión sí/no" para este trámite, con motivo. */
export function GeneraComision({ solicitudId, genera }: { solicitudId: string; genera: boolean }) {
  const [estado, enviar] = useActionState(generaComision, INICIAL);
  return (
    <form action={enviar} className="flex flex-col gap-3">
      <input type="hidden" name="solicitud" value={solicitudId} />
      <input type="hidden" name="genera" value={genera ? "no" : "si"} />
      <label className="block">
        <span className="font-semibold">{genera ? "Marcar que no genera comisión" : "Que vuelva a generar comisión"}</span>
        <input name="motivo" required minLength={3} maxLength={300} className={ENTRADA}
          placeholder={genera ? "p. ej. solo lo recomendó; ya estaba pactado distinto" : "Motivo"} />
      </label>
      {genera ? (
        <p className="text-[0.9375rem] leading-6 text-secundario">
          Sin comisión tampoco hay bono de referido y no cuenta para su nivel. Si ya la había generado, se le quita.
        </p>
      ) : null}
      <BotonEnviar variante="secundario" pendiente="Guardando…">{genera ? "No genera comisión" : "Sí genera comisión"}</BotonEnviar>
      <Aviso estado={estado} />
    </form>
  );
}
