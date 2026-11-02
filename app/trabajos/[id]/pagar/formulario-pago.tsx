"use client";

import { useActionState, useState } from "react";
import { BotonEnviar } from "@/components/boton-enviar";
import { CampoArchivo } from "@/components/campo-archivo";
import { reportarPago, type EstadoReporte } from "./acciones";

const ENTRADA =
  "mt-2 w-full rounded-lg border border-borde-campo bg-fondo px-4 py-3 text-[1.0625rem] focus:border-acento";

type Via = "comprobante" | "aviso" | "efectivo" | "directo";
/** A dónde llegó el dinero (solo lo dice el comisionista). */
type Destino = "cuenta" | "yo" | "staff";
type Opcion = { clave: string; via: Via; titulo: string; detalle: string };

/** Lo que cada quien puede elegir, con la explicación a la vista. */
const OPCIONES: Record<Destino, Opcion[]> = {
  cuenta: [
    { clave: "comprobante", via: "comprobante", titulo: "Transferencia con comprobante", detalle: "Subes la foto o el PDF del depósito." },
    { clave: "aviso", via: "aviso", titulo: "Solo aviso, sin archivo", detalle: "El cliente pagó y no tienes comprobante: avisas con una nota." },
    { clave: "efectivo", via: "efectivo", titulo: "Efectivo en la oficina", detalle: "Dices quién lo recibió. El recibo es opcional." },
  ],
  yo: [
    { clave: "yo-transferencia", via: "comprobante", titulo: "Me transfirió a mí", detalle: "Subes el comprobante de la transferencia que te hizo." },
    { clave: "yo-efectivo", via: "efectivo", titulo: "Me pagó en efectivo", detalle: "El recibo es opcional." },
  ],
  staff: [
    { clave: "directo", via: "directo", titulo: "Transferencia o depósito", detalle: "Con la referencia del banco. Comprobante opcional." },
    { clave: "efectivo", via: "efectivo", titulo: "Efectivo", detalle: "Quién lo recibió. El recibo es opcional." },
  ],
};

/**
 * Primero se elige CÓMO pagó el cliente; los campos aparecen después.
 * Así nadie se topa con un archivo obligatorio cuando no tiene uno.
 */
export default function FormularioPago({
  solicitudId,
  carpeta,
  quien,
  sugerido,
  hoy,
  equipo,
  miNombre,
  entregarAntes,
}: {
  solicitudId: string;
  carpeta: string;
  quien: "comisionista" | "staff";
  sugerido: number;
  hoy: string;
  /** Nombres del staff, como sugerencia de "quién lo recibió" (solo para el staff). */
  equipo: string[];
  /** Nombre del comisionista: es quien recibió el efectivo cuando dice "Lo recibí yo". */
  miNombre: string;
  /** Fecha límite (2 días hábiles) si lo recibe hoy, ya en texto. */
  entregarAntes: string;
}) {
  const [estado, enviar] = useActionState<EstadoReporte, FormData>(reportarPago, { error: null });
  const [destino, setDestino] = useState<Destino | null>(quien === "staff" ? "staff" : null);
  const [opcion, setOpcion] = useState<Opcion | null>(null);
  const via = opcion?.via ?? null;
  const recibioYo = destino === "yo";
  const [comprobante, setComprobante] = useState<string | null>(null);

  return (
    <form action={enviar} className="mt-6 flex flex-col gap-6">
      <input type="hidden" name="solicitud_id" value={solicitudId} />
      {via ? <input type="hidden" name="via" value={via} /> : null}
      {recibioYo ? <input type="hidden" name="recibio_asesor" value="on" /> : null}

      {quien === "comisionista" ? (
        <fieldset>
          <legend className="font-semibold">¿A dónde llegó el dinero?</legend>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {([
              ["cuenta", "El cliente pagó a la cuenta"],
              ["yo", "Lo recibí yo"],
            ] as const).map(([d, texto]) => (
              <button key={d} type="button" aria-pressed={destino === d}
                onClick={() => {
                  setDestino(d);
                  setOpcion(null);
                  setComprobante(null);
                }}
                className={`min-h-12 rounded-lg border px-3 py-2 font-semibold ${destino === d ? "border-acento bg-tinte text-primario" : "border-linea bg-fondo"}`}>
                {texto}
              </button>
            ))}
          </div>
          {recibioYo ? (
            <p className="mt-3 rounded-lg bg-proceso-fondo px-4 py-3 text-[0.9375rem] leading-6 text-proceso">
              Repórtalo el mismo día y entrégalo a la cuenta indicada en la cotización en un máximo de 2 días hábiles (si lo
              recibiste hoy, a más tardar el {entregarAntes}). Al depositarlo, márcalo como entregado en la ficha del trabajo. El
              trabajo no cuenta como pagado, ni genera comisión, hasta que el dinero llegue a esa cuenta.
            </p>
          ) : null}
        </fieldset>
      ) : null}

      {destino ? (
        <fieldset>
          <legend className="font-semibold">¿Cómo pagó el cliente?</legend>
          <div className="mt-2 flex flex-col gap-2">
            {OPCIONES[destino].map((o) => (
              <button
                key={o.clave}
                type="button"
                onClick={() => {
                  setOpcion(o);
                  setComprobante(null);
                }}
                aria-pressed={opcion?.clave === o.clave}
                className={`rounded-lg border px-4 py-3 text-left ${
                  opcion?.clave === o.clave ? "border-acento bg-tinte" : "border-linea bg-fondo"
                }`}
              >
                <span className={`block font-semibold ${opcion?.clave === o.clave ? "text-primario" : ""}`}>{o.titulo}</span>
                <span className="block text-[0.9375rem] leading-6 text-secundario">{o.detalle}</span>
              </button>
            ))}
          </div>
        </fieldset>
      ) : null}

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

          {via === "efectivo" && recibioYo ? <input type="hidden" name="recibido_por" value={miNombre} /> : null}
          {via === "efectivo" && !recibioYo ? (
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
              key={opcion?.clave}
              bucket="comprobantes"
              carpeta={carpeta}
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
