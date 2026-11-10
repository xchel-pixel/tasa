import { Etiqueta } from "@/components/etiqueta";
import { mesActual, mesLargo, pesos } from "@/lib/formato";
import { frasesDeNivel, type MiNivel } from "@/lib/nivel";

/**
 * Comisión del mes y avance de nivel (0081). Lo mismo en la portada, el panel, el estado de cuenta y la ficha del
 * comisionista en administración: tres frases separadas, nunca el nivel actual y el proyectado juntos.
 */
export function BloqueNivel({ nivel, conComision = true }: { nivel: MiNivel; conComision?: boolean }) {
  const f = frasesDeNivel(nivel);
  const o = nivel.objetivo;
  const avance = o && o.umbral > 0 ? Math.min(1, Math.max(0, nivel.proyectado.promedio / o.umbral)) : 1;
  return (
    <section className="rounded-xl bg-tinte px-5 py-4">
      {conComision ? (
        <>
          <div className="flex items-baseline justify-between gap-3">
            <p className="font-semibold">Comisión de {mesLargo(mesActual())}</p>
            {nivel.comision_provisional ? <Etiqueta tono="proceso">Provisional</Etiqueta> : null}
          </div>
          <p className="mt-1 text-[1.75rem] font-bold text-primario">{pesos(nivel.comision_mes)}</p>
        </>
      ) : null}
      <ul className="mt-3 flex flex-col gap-2 text-[0.9375rem] leading-6">
        <li>
          <strong className="font-semibold">{f.esteMes}</strong>
          {f.especial ? <span className="block text-primario">{f.especial}</span> : null}
        </li>
        <li className="text-secundario">{f.proximo}</li>
        <li>
          {o ? (
            <div className="mb-2 h-2.5 w-full overflow-hidden rounded-full bg-fondo" role="progressbar" aria-valuemin={0} aria-valuemax={100}
              aria-valuenow={Math.round(avance * 100)} aria-label={o.tipo === "mantener" ? `Avance para mantener ${o.nombre}` : `Avance hacia ${o.nombre}`}>
              <div className="h-full rounded-full bg-primario" style={{ width: `${avance * 100}%` }} />
            </div>
          ) : null}
          <span className={o && o.falta > 0 ? "font-semibold text-acento" : ""}>{f.falta}</span>
        </li>
      </ul>
    </section>
  );
}
