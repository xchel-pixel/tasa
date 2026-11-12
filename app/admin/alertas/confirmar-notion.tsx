"use client";

import { useActionState, useState } from "react";
import { Aviso } from "@/components/aviso";
import { BotonEnviar } from "@/components/boton-enviar";
import { confirmarPaginaNotion, type EstadoAlerta } from "./acciones";

const INICIAL: EstadoAlerta = { error: null, mensaje: null };

/** "Páginas de Notion por confirmar": ligar una parecida, o decir que no es la misma persona y crear una nueva. */
export function ConfirmarPaginaNotion({ personaId, nombre, candidatos }: {
  personaId: string; nombre: string; candidatos: { id: string; nombre: string }[];
}) {
  const [estado, enviar] = useActionState(confirmarPaginaNotion, INICIAL);
  const [nueva, setNueva] = useState(false);
  if (estado.mensaje) return <div className="mt-3"><Aviso estado={estado} /></div>;
  return (
    <div className="mt-3 flex flex-col gap-2">
      {candidatos.map((c) => (
        <form key={c.id} action={enviar}>
          <input type="hidden" name="accion" value="ligar" />
          <input type="hidden" name="persona" value={personaId} />
          <input type="hidden" name="pagina" value={c.id} />
          <input type="hidden" name="nombre" value={c.nombre} />
          <BotonEnviar variante="secundario">Ligar a “{c.nombre}”</BotonEnviar>
        </form>
      ))}
      {nueva ? (
        <form action={enviar} className="flex flex-col gap-3 rounded-lg border border-linea px-3 py-3">
          <input type="hidden" name="accion" value="nueva" />
          <input type="hidden" name="persona" value={personaId} />
          <p className="text-[0.9375rem] leading-6">
            Se crea en Ext Comisionistas la página “{nombre}” (su nombre en Tasa) y se liga. Las parecidas ya no se le volverán a proponer.
          </p>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={() => setNueva(false)} className="min-h-12 rounded-lg border border-linea bg-fondo px-3 font-semibold text-secundario">
              No, dejarlo
            </button>
            <BotonEnviar>Crear y ligar</BotonEnviar>
          </div>
        </form>
      ) : (
        <button type="button" onClick={() => setNueva(true)}
          className="flex min-h-11 w-full items-center justify-center rounded-lg border border-linea bg-fondo px-3 font-semibold">
          No es la misma persona: crear página nueva
        </button>
      )}
      <Aviso estado={estado} />
    </div>
  );
}
