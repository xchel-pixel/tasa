import { Etiqueta } from "@/components/etiqueta";
import { mesActual, mesLargo, pesos } from "@/lib/formato";
import type { MiNivel } from "@/lib/trabajos";

/**
 * Comisión del mes, nivel y cuánto falta para subir. Lo mismo en el
 * inicio y en el estado de cuenta: si dijeran cifras distintas, ninguna
 * sería creíble.
 */
export function BloqueNivel({ nivel }: { nivel: MiNivel }) {
  return (
    <section className="rounded-xl bg-tinte px-5 py-4">
      <div className="flex items-baseline justify-between gap-3">
        <p className="font-semibold">Comisión de {mesLargo(mesActual())}</p>
        {nivel.comision_mes_provisional ? <Etiqueta tono="proceso">Provisional</Etiqueta> : null}
      </div>
      <p className="mt-1 text-[1.75rem] font-bold text-primario">{pesos(nivel.comision_mes)}</p>

      <p className="mt-3 text-[0.9375rem] text-secundario">
        Tu nivel: <strong className="font-semibold text-texto">{nivel.nivel}</strong> · {nivel.porcentaje}%
        {nivel.provisional ? " (provisional)" : ""}
      </p>

      {nivel.siguiente ? (
        <>
          <div
            className="mt-3 h-2.5 w-full overflow-hidden rounded-full bg-fondo"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(nivel.avance * 100)}
            aria-label={`Avance hacia ${nivel.siguiente.nombre}`}
          >
            <div className="h-full rounded-full bg-primario" style={{ width: `${nivel.avance * 100}%` }} />
          </div>
          <p className="mt-2 text-[0.9375rem] leading-6">
            Te faltan <strong className="font-semibold text-acento">{pesos(nivel.faltante)}</strong> en
            honorarios pagados este mes para subir a {nivel.siguiente.nombre} ({nivel.siguiente.porcentaje}%) el
            mes que entra.
          </p>
        </>
      ) : (
        <p className="mt-2 text-[0.9375rem] leading-6">Estás en el nivel más alto.</p>
      )}
    </section>
  );
}
