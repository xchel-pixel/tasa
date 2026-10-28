"use client";

import { useActionState, useState } from "react";
import { Aviso } from "@/components/aviso";
import { BotonEnviar } from "@/components/boton-enviar";
import { CampoBienvenida } from "@/components/campo-bienvenida";
import type { TratosOrg } from "@/lib/tratos";
import { aprobarAlta, rechazarAlta, reintentarCorreo, type EstadoDecision } from "./acciones";

const INICIAL: EstadoDecision = { error: null, mensaje: null };

export function FormularioAprobar({ id, tratos, rfcNoCuadra }: { id: string; tratos: TratosOrg; rfcNoCuadra: boolean }) {
  const [estado, enviar] = useActionState(aprobarAlta, INICIAL);
  return (
    <form action={enviar} className="mt-4 flex flex-col gap-4">
      <input type="hidden" name="id" value={id} />
      <label className="flex items-start gap-3 text-[0.9375rem] leading-6">
        <input type="checkbox" name="emite_factura" className="mt-1 size-5 shrink-0 accent-primario" />
        Emite factura por sus comisiones
      </label>
      <CampoBienvenida bienvenida={tratos.bienvenida} arranque={tratos.arranque} puedeCambiarMeses />
      {rfcNoCuadra ? (
        <label className="flex items-start gap-3 rounded-lg border border-error bg-error-fondo p-3 text-[0.9375rem] leading-6">
          <input type="checkbox" name="rfc_revisado" className="mt-1 size-5 shrink-0" />
          <span>
            <span className="block font-semibold">RFC revisado a mano</span>
            Comparé el RFC con la constancia y está bien (RFC antiguo). Queda en la bitácora.
          </span>
        </label>
      ) : null}
      <Aviso estado={estado} />
      {estado.mensaje ? null : <BotonEnviar pendiente="Aprobando…">Aprobar y mandar bienvenida</BotonEnviar>}
    </form>
  );
}

export function FormularioRechazar({ id }: { id: string }) {
  const [estado, enviar] = useActionState(rechazarAlta, INICIAL);
  const [abierto, setAbierto] = useState(false);
  if (!abierto && !estado.error) {
    return (
      <button type="button" onClick={() => setAbierto(true)}
        className="toque mt-6 text-[0.9375rem] font-semibold text-error underline underline-offset-4">
        Rechazar la solicitud
      </button>
    );
  }
  return (
    <form action={enviar} className="mt-6 flex flex-col gap-3 rounded-lg border border-error bg-error-fondo px-3 py-3">
      <input type="hidden" name="id" value={id} />
      <p className="text-[0.9375rem] leading-6">No se crea nada y le llega un correo genérico; el motivo va en el correo si lo escribes.</p>
      <label htmlFor="motivo" className="block text-[0.9375rem] font-semibold">
        Motivo <span className="font-normal text-secundario">(opcional)</span>
      </label>
      <textarea id="motivo" name="motivo" rows={2} maxLength={500}
        className="-mt-2 w-full rounded-lg border border-borde-campo bg-fondo px-3 py-2 text-[1rem] focus:border-acento" />
      <Aviso estado={estado} />
      {estado.mensaje ? null : <BotonEnviar variante="peligro" pendiente="Rechazando…">Rechazar</BotonEnviar>}
    </form>
  );
}

export function ReintentarCorreo({ id }: { id: string }) {
  const [estado, enviar] = useActionState(reintentarCorreo, INICIAL);
  return (
    <form action={enviar} className="mt-3 flex flex-col gap-3">
      <input type="hidden" name="id" value={id} />
      <Aviso estado={estado} />
      {estado.mensaje ? null : <BotonEnviar variante="secundario" pendiente="Enviando…">Volver a mandar el correo</BotonEnviar>}
    </form>
  );
}

/** El respaldo del correo: el mismo texto, para pegarlo en WhatsApp. */
export function CopiarWhatsApp({ texto }: { texto: string }) {
  const [copiado, setCopiado] = useState(false);
  async function copiar() {
    try {
      await navigator.clipboard.writeText(texto);
      setCopiado(true);
    } catch {
      setCopiado(false);
    }
  }
  return (
    <div className="mt-3">
      <button type="button" onClick={copiar}
        className="min-h-12 w-full rounded-lg border border-primario bg-fondo px-4 py-3 font-semibold text-primario">
        {copiado ? "Copiado: pégalo en WhatsApp" : "Copiar mensaje para WhatsApp"}
      </button>
      <details className="mt-2 text-[0.9375rem]">
        <summary className="toque cursor-pointer text-secundario">Ver el mensaje</summary>
        <p className="mt-2 rounded-lg border border-linea p-3 leading-6 whitespace-pre-line">{texto}</p>
      </details>
    </div>
  );
}
