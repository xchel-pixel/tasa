"use client";

import { useActionState } from "react";
import { Aviso } from "@/components/aviso";
import { BotonEnviar } from "@/components/boton-enviar";
import { borrarNivel, guardarNivel, guardarTratos, type EstadoNivel } from "./acciones";

const INICIAL: EstadoNivel = { error: null, mensaje: null };
const ENTRADA =
  "mt-1 w-full rounded-lg border border-borde-campo bg-fondo px-3 py-2 text-[1rem] focus:border-acento";

export type Nivel = {
  id: string;
  nombre: string;
  umbral_minimo: string | number | null;
  porcentaje: string | number | null;
  es_forzado: boolean;
};

export function FormularioNivel({ nivel }: { nivel?: Nivel }) {
  const [estado, enviar] = useActionState(guardarNivel, INICIAL);
  const [estadoBorrar, borrar] = useActionState(borrarNivel, INICIAL);
  return (
    <div className="flex flex-col gap-3">
      <form action={enviar} className="flex flex-col gap-3">
        {nivel ? <input type="hidden" name="id" value={nivel.id} /> : null}
        <input type="hidden" name="es_forzado" value={String(Boolean(nivel?.es_forzado))} />
        <label className="block text-[0.9375rem] font-semibold">
          Nombre
          <input name="nombre" required maxLength={40} defaultValue={nivel?.nombre} className={ENTRADA} />
        </label>
        {nivel?.es_forzado ? (
          <p className="text-[0.875rem] leading-5 text-secundario">
            Porcentaje fijo: se lo pones a cada comisionista en su ficha y manda sobre el promedio.
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            <label className="block text-[0.9375rem] font-semibold">
              Promedio mínimo ($)
              <input name="umbral_minimo" required inputMode="decimal" defaultValue={nivel?.umbral_minimo ?? ""}
                className={ENTRADA} />
            </label>
            <label className="block text-[0.9375rem] font-semibold">
              Porcentaje (%)
              <input name="porcentaje" required inputMode="decimal" defaultValue={nivel?.porcentaje ?? ""}
                className={ENTRADA} />
            </label>
          </div>
        )}
        <BotonEnviar variante="secundario">{nivel ? "Guardar nivel" : "Agregar nivel"}</BotonEnviar>
        <Aviso estado={estado} />
      </form>
      {nivel && !nivel.es_forzado ? (
        <form action={borrar} className="flex flex-col gap-1">
          <input type="hidden" name="id" value={nivel.id} />
          <button type="submit" className="toque self-start text-[0.9375rem] font-semibold text-error underline underline-offset-4">
            Borrar (solo si nunca se usó)
          </button>
          <Aviso estado={estadoBorrar} />
        </form>
      ) : null}
    </div>
  );
}

export function FormularioTratos({
  niveles,
  valores,
}: {
  niveles: Nivel[];
  valores: { bienvenida_nivel_id: string | null; bienvenida_meses: number; arranque_nivel_id: string | null; arranque_meses: number };
}) {
  const [estado, enviar] = useActionState(guardarTratos, INICIAL);
  const opciones = niveles.filter((n) => !n.es_forzado);
  const selector = (nombre: string, valor: string | null) => (
    <select name={nombre} defaultValue={valor ?? ""} className={ENTRADA}>
      {opciones.map((n) => (
        <option key={n.id} value={n.id}>{n.nombre} · {Number(n.porcentaje)}%</option>
      ))}
    </select>
  );
  return (
    <form action={enviar} className="flex flex-col gap-3">
      <div className="grid grid-cols-[1fr_6rem] gap-2">
        <label className="block text-[0.9375rem] font-semibold">
          Tasa de bienvenida
          {selector("bienvenida_nivel_id", valores.bienvenida_nivel_id)}
        </label>
        <label className="block text-[0.9375rem] font-semibold">
          Meses
          <input name="bienvenida_meses" type="number" min={1} max={12} defaultValue={valores.bienvenida_meses} className={ENTRADA} />
        </label>
      </div>
      <div className="grid grid-cols-[1fr_6rem] gap-2">
        <label className="block text-[0.9375rem] font-semibold">
          Arranque (nuevos)
          {selector("arranque_nivel_id", valores.arranque_nivel_id)}
        </label>
        <label className="block text-[0.9375rem] font-semibold">
          Meses
          <input name="arranque_meses" type="number" min={0} max={12} defaultValue={valores.arranque_meses} className={ENTRADA} />
        </label>
      </div>
      <BotonEnviar variante="secundario">Guardar trato inicial</BotonEnviar>
      <Aviso estado={estado} />
    </form>
  );
}
