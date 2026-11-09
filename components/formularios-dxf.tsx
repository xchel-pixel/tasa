"use client";

import { useActionState } from "react";
import { agregarDxf, autorizarDxf, pedirMasDxf, quitarDxf, type EstadoDxfForm } from "@/app/acciones-dxf";
import { Aviso } from "@/components/aviso";
import { BotonEnviar } from "@/components/boton-enviar";

const INICIAL: EstadoDxfForm = { error: null, mensaje: null };
const ENTRADA = "w-full rounded-lg border border-borde-campo bg-fondo px-3 py-2 text-[1rem] focus:border-acento";

/** Sin saldo: aviso a admin_org dentro de Tasa. */
export function PedirMasDxf() {
  const [estado, enviar] = useActionState(pedirMasDxf, INICIAL);
  return (
    <form action={enviar} className="flex flex-col gap-2">
      <BotonEnviar variante="secundario">Pedir más</BotonEnviar>
      <Aviso estado={estado} />
    </form>
  );
}

function Motivo({ ejemplo }: { ejemplo: string }) {
  return (
    <label className="block text-[0.9375rem] font-semibold">Motivo
      <input name="motivo" required minLength={3} maxLength={300} className={`mt-1 ${ENTRADA}`} placeholder={ejemplo} />
    </label>
  );
}

/** Autorizar con un saldo o sin límite (si ya estaba autorizada, el saldo queda en lo que se escriba). */
export function AutorizarDxf({ personaId, yaAutorizada }: { personaId: string; yaAutorizada: boolean }) {
  const [estado, enviar] = useActionState(autorizarDxf, INICIAL);
  return (
    <form action={enviar} className="mt-3 flex flex-col gap-2">
      <input type="hidden" name="persona" value={personaId} />
      <p className="font-semibold">{yaAutorizada ? "Cambiar el saldo" : "Autorizar"}</p>
      <div className="grid grid-cols-[7rem_1fr] items-end gap-2">
        <label className="block text-[0.9375rem] font-semibold">Descargas
          <input name="saldo" inputMode="numeric" pattern="\d{1,5}" className={`mt-1 ${ENTRADA}`} />
        </label>
        <label className="flex min-h-11 items-center gap-2 text-[0.9375rem]">
          <input type="checkbox" name="sin_limite" className="size-5" /> Sin límite
        </label>
      </div>
      <Motivo ejemplo="Ej. trabaja con planos de clientes" />
      <BotonEnviar variante="secundario">{yaAutorizada ? "Guardar saldo" : "Autorizar"}</BotonEnviar>
      <Aviso estado={estado} />
    </form>
  );
}

export function AgregarDxf({ personaId }: { personaId: string }) {
  const [estado, enviar] = useActionState(agregarDxf, INICIAL);
  return (
    <form action={enviar} className="mt-3 flex flex-col gap-2">
      <input type="hidden" name="persona" value={personaId} />
      <p className="font-semibold">Agregar descargas</p>
      <div className="grid grid-cols-[7rem_1fr] gap-2">
        <label className="block text-[0.9375rem] font-semibold">Cantidad
          <input name="cantidad" inputMode="numeric" required pattern="\d{1,4}" className={`mt-1 ${ENTRADA}`} />
        </label>
        <Motivo ejemplo="Ej. pidió más" />
      </div>
      <BotonEnviar variante="secundario">Agregar al saldo</BotonEnviar>
      <Aviso estado={estado} />
    </form>
  );
}

export function QuitarDxf({ personaId }: { personaId: string }) {
  const [estado, enviar] = useActionState(quitarDxf, INICIAL);
  return (
    <form action={enviar} className="mt-3 flex flex-col gap-2">
      <input type="hidden" name="persona" value={personaId} />
      <p className="font-semibold">Quitar autorización</p>
      <Motivo ejemplo="Ej. ya no lo necesita" />
      <BotonEnviar variante="peligro">Quitar autorización</BotonEnviar>
      <Aviso estado={estado} />
    </form>
  );
}
