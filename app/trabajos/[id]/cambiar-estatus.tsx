"use client";

import { useActionState } from "react";
import { BotonEnviar } from "@/components/boton-enviar";
import { Aviso } from "@/components/aviso";
import { cambiarEstatus, type EstadoEstatus } from "./acciones";

/** Los de en medio; "Pagado" y "Cancelada" los pone Tasa sola. */
const ESTATUS = [
  { valor: "aceptada", texto: "Aceptada" },
  { valor: "visita_agendada", texto: "Visita agendada" },
  { valor: "en_elaboracion", texto: "En elaboración" },
  { valor: "en_revision", texto: "En revisión" },
  { valor: "entregado", texto: "Entregado" },
];

export default function CambiarEstatus({ solicitudId, actual }: { solicitudId: string; actual: string }) {
  const [estado, enviar] = useActionState<EstadoEstatus, FormData>(cambiarEstatus, { error: null, mensaje: null });
  return (
    <details className="mt-4 rounded-xl border border-linea px-4 py-3">
      <summary className="toque cursor-pointer font-semibold text-acento">Cambiar estatus</summary>
      <form action={enviar} className="mt-3 flex flex-col gap-3">
        <input type="hidden" name="solicitud" value={solicitudId} />
        <label htmlFor="estatus" className="sr-only">Estatus</label>
        <select id="estatus" name="estatus" defaultValue={actual}
          className="w-full rounded-lg border border-borde-campo bg-fondo px-4 py-3 text-[1.0625rem] focus:border-acento">
          {ESTATUS.map((e) => <option key={e.valor} value={e.valor}>{e.texto}</option>)}
        </select>
        <p className="text-[0.9375rem] leading-6 text-secundario">
          Sin conector externo, el estatus lo mueve Administración. Queda en el historial y el comisionista lo ve.
        </p>
        <BotonEnviar variante="secundario">Guardar estatus</BotonEnviar>
        <Aviso estado={estado} />
      </form>
    </details>
  );
}
