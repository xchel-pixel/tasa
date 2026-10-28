"use client";

import { useState } from "react";
import type { Trato } from "@/lib/tratos";

/**
 * La casilla "Tasa de bienvenida" del alta y de la ficha. Solo admin_org
 * cambia la cantidad de meses; finanzas ve la de la organización.
 */
export function CampoBienvenida({
  bienvenida,
  arranque,
  puedeCambiarMeses,
  marcada = false,
}: {
  bienvenida: Trato;
  arranque: Trato;
  puedeCambiarMeses: boolean;
  marcada?: boolean;
}) {
  const [activa, setActiva] = useState(marcada);
  const [meses, setMeses] = useState(bienvenida.meses);
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-linea p-3">
      <label className="flex items-start gap-3 leading-6">
        <input type="checkbox" name="bienvenida" checked={activa} onChange={(e) => setActiva(e.target.checked)}
          className="mt-1 size-5 shrink-0 accent-primario" />
        <span>
          <span className="block font-semibold">Tasa de bienvenida</span>
          <span className="block text-[0.9375rem] text-secundario">
            {bienvenida.nivel} {bienvenida.porcentaje}% fijo, para quien ya trabajaba con ustedes. Al terminar baja un
            nivel por cierre hasta su nivel real.
          </span>
        </span>
      </label>
      {activa ? (
        <label className="block text-[0.9375rem] font-semibold">
          Meses
          {puedeCambiarMeses ? (
            <input name="meses_bienvenida" type="number" min={1} max={12} value={meses}
              onChange={(e) => setMeses(Number(e.target.value))}
              className="mt-1 w-24 rounded-lg border border-borde-campo bg-fondo px-3 py-2 text-[1rem]" />
          ) : (
            <span className="ml-2 font-normal">{bienvenida.meses} (lo cambia administración)</span>
          )}
        </label>
      ) : (
        <p className="text-[0.875rem] leading-5 text-secundario">
          Sin bienvenida arranca en {arranque.nivel} {arranque.porcentaje}% sus primeros {arranque.meses} meses.
        </p>
      )}
    </div>
  );
}
