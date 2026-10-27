"use client";

import { useActionState, useState } from "react";
import { BotonEnviar } from "@/components/boton-enviar";
import { CampoArchivo } from "@/components/campo-archivo";
import { reportarPago, type EstadoReporte } from "./acciones";

const ENTRADA =
  "mt-2 w-full rounded-lg border border-borde-campo bg-fondo px-4 py-3 text-[1.0625rem] focus:border-acento";

type Via = "comprobante" | "aviso" | "efectivo" | "directo";

/** Lo que cada quien puede elegir, con la explicación a la vista. */
const OPCIONES: Record<"comisionista" | "staff", { via: Via; titulo: string; detalle: string }[]> = {
  comisionista: [
    { via: "comprobante", titulo: "Transferencia con comprobante", detalle: "Subes la foto o el PDF del depósito." },
    { via: "aviso", titulo: "Solo aviso, sin archivo", detalle: "El cliente pagó y no tienes comprobante: avisas con una nota." },
    { via: "efectivo", titulo: "Efectivo", detalle: "Dices quién lo recibió. El recibo es opcional." },
  ],
  staff: [
    { via: "directo", titulo: "Transferencia o depósito", detalle: "Con la referencia del banco. Comprobante opcional." },
    { via: "efectivo", titulo: "Efectivo", detalle: "Quién lo recibió. El recibo es opcional." },
  ],
};

/**
 * Primero se elige CÓMO pagó el cliente; los campos aparecen después.
 * Así nadie se topa con un archivo obligatorio cuando no tiene uno.
 */
export default function FormularioPago({
  solicitudId,
  personaId,
  quien,
  sugerido,
  hoy,
  equipo,
}: {
  solicitudId: string;
  personaId: string;
  quien: "comisionista" | "staff";
  sugerido: number;
  hoy: string;
  /** Nombres del staff, como sugerencia de "quién lo recibió" (solo para el staff). */
  equipo: string[];
}) {
  const [estado, enviar] = useActionState<EstadoReporte, FormData>(reportarPago, { error: null });
  const [via, setVia] = useState<Via | null>(null);
  const [comprobante, setComprobante] = useState<string | null>(null);

  return (
    <form action={enviar} className="mt-6 flex flex-col gap-6">
      <input type="hidden" name="solicitud_id" value={solicitudId} />
      {via ? <input type="hidden" name="via" value={via} /> : null}

      <fieldset>
        <legend className="font-semibold">¿Cómo pagó el cliente?</legend>
        <div className="mt-2 flex flex-col gap-2">
          {OPCIONES[quien].map((o) => (
            <button
              key={o.via}
              type="button"
              onClick={() => {
                setVia(o.via);
                setComprobante(null);
              }}
              aria-pressed={via === o.via}
              className={`rounded-lg border px-4 py-3 text-left ${
                via === o.via ? "border-acento bg-tinte" : "border-linea bg-fondo"
              }`}
            >
              <span className={`block font-semibold ${via === o.via ? "text-primario" : ""}`}>{o.titulo}</span>
              <span className="block text-[0.9375rem] leading-6 text-secundario">{o.detalle}</span>
            </button>
          ))}
        </div>
      </fieldset>

      {via ? (
        <>
          <div>
            <label htmlFor="monto" className="block font-semibold">Monto que pagó el cliente</label>
            <input id="monto" name="monto" inputMode="decimal" required
              defaultValue={sugerido > 0 ? sugerido.toFixed(2) : ""} className={ENTRADA} />
            <p className="mt-1 text-[0.9375rem] text-secundario">Puede ser un pago parcial.</p>
          </div>

          <div>
            <label htmlFor="fecha_pago" className="block font-semibold">Fecha del pago</label>
            <input id="fecha_pago" name="fecha_pago" type="date" required max={hoy} defaultValue={hoy} className={ENTRADA} />
          </div>

          {via === "efectivo" ? (
            <div>
              <label htmlFor="recibido_por" className="block font-semibold">¿Quién lo recibió?</label>
              <input id="recibido_por" name="recibido_por" required maxLength={80} list={quien === "staff" ? "equipo" : undefined}
                placeholder={quien === "staff" ? "" : "Nombre de quien recibió el dinero"} className={ENTRADA} />
              {quien === "staff" ? (
                <datalist id="equipo">{equipo.map((n) => <option key={n} value={n} />)}</datalist>
              ) : null}
            </div>
          ) : null}

          {via === "directo" ? (
            <div>
              <label htmlFor="referencia" className="block font-semibold">Referencia</label>
              <input id="referencia" name="referencia" required maxLength={80} className={ENTRADA} />
            </div>
          ) : null}

          {via !== "aviso" ? (
            <CampoArchivo
              key={via}
              bucket="comprobantes"
              personaId={personaId}
              nombre="comprobante_ruta"
              etiqueta={via === "efectivo" ? "Recibo" : "Comprobante"}
              ayuda={via === "efectivo" ? "Foto del recibo, si hay." : "Foto o PDF de la transferencia o del depósito."}
              opcional={via !== "comprobante"}
              onCambio={setComprobante}
            />
          ) : null}

          <div>
            <label htmlFor="nota" className="block font-semibold">
              Nota {via === "aviso" ? null : <span className="font-normal text-secundario">(opcional)</span>}
            </label>
            {via === "aviso" ? (
              <p className="mt-1 text-[0.9375rem] leading-6 text-secundario">
                Banco, referencia y a nombre de quién: lo que ayude a encontrar el depósito.
              </p>
            ) : null}
            <textarea id="nota" name="nota" rows={3} required={via === "aviso"} className={ENTRADA} />
          </div>

          {estado.error ? <p className="text-[0.9375rem] leading-6 text-error">{estado.error}</p> : null}

          {via === "comprobante" && !comprobante ? (
            <p className="text-[0.9375rem] leading-6 text-secundario">
              Sube el comprobante para continuar, o elige &quot;Solo aviso, sin archivo&quot;.
            </p>
          ) : (
            <BotonEnviar>{quien === "staff" ? "Registrar pago" : "Reportar pago"}</BotonEnviar>
          )}
          <p className="-mt-3 text-[0.9375rem] leading-6 text-secundario">
            {quien === "staff"
              ? "Entra como pago por confirmar, igual que los que reportan los comisionistas."
              : "Administración lo revisa y lo confirma. Si algo no cuadra, te dice el motivo."}
          </p>
        </>
      ) : null}
    </form>
  );
}
