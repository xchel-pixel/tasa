import Link from "next/link";
import { Etiqueta } from "@/components/etiqueta";
import { ESTATUS_CERRADOS, estatusVisible } from "@/lib/estatus";
import { mesActual, mesLargo, pesos } from "@/lib/formato";
import type { Persona } from "@/lib/sesion";
import { miNivel, misTrabajos, type TrabajoEnLista } from "@/lib/trabajos";

/**
 * Lo primero que ve el comisionista: cuánto lleva este mes y cómo van
 * sus trabajos. Lo que no se mueve (pagado, vencido, cancelado) va al
 * final.
 */
export async function InicioComisionista({ persona }: { persona: Persona }) {
  const [trabajos, nivel] = await Promise.all([misTrabajos(), miNivel(persona.id)]);

  const enCurso = trabajos.filter((t) => !ESTATUS_CERRADOS.includes(t.estatus_publico));
  const cerrados = trabajos.filter((t) => ESTATUS_CERRADOS.includes(t.estatus_publico));

  return (
    <>
      <h1 className="text-[1.5rem] font-bold tracking-tight">
        Hola, {persona.nombre.split(" ")[0]}
      </h1>

      <section className="mt-6 rounded-xl bg-tinte px-5 py-4">
        <div className="flex items-baseline justify-between gap-3">
          <p className="font-semibold">Comisión de {mesLargo(mesActual())}</p>
          {nivel.comision_mes_provisional ? <Etiqueta tono="proceso">Provisional</Etiqueta> : null}
        </div>
        <p className="mt-1 text-[1.75rem] font-bold text-primario">{pesos(nivel.comision_mes)}</p>

        <p className="mt-3 text-[0.9375rem] text-secundario">
          Tu nivel: <strong className="font-semibold text-texto">{nivel.nivel}</strong> ·{" "}
          {nivel.porcentaje}%{nivel.provisional ? " (provisional)" : ""}
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
              honorarios pagados este mes para subir a {nivel.siguiente.nombre} (
              {nivel.siguiente.porcentaje}%) el mes que entra.
            </p>
          </>
        ) : (
          <p className="mt-2 text-[0.9375rem] leading-6">Estás en el nivel más alto.</p>
        )}
      </section>

      <Lista titulo="En curso" trabajos={enCurso} vacio="No tienes trabajos en curso." />
      {cerrados.length > 0 ? <Lista titulo="Terminados" trabajos={cerrados} /> : null}
    </>
  );
}

function Lista({
  titulo,
  trabajos,
  vacio,
}: {
  titulo: string;
  trabajos: TrabajoEnLista[];
  vacio?: string;
}) {
  return (
    <section className="mt-8">
      <h2 className="text-[1.125rem] font-bold">{titulo}</h2>
      {trabajos.length === 0 ? (
        <p className="mt-2 text-[0.9375rem] text-secundario">{vacio}</p>
      ) : (
        <ul className="mt-3 flex flex-col gap-3">
          {trabajos.map((t) => (
            <li key={t.id}>
              <Tarjeta trabajo={t} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Tarjeta({ trabajo: t }: { trabajo: TrabajoEnLista }) {
  const estatus = estatusVisible(t.estatus_publico, t.folio);
  const saldo = Math.max(0, t.monto_total - t.confirmado);

  return (
    <Link
      href={`/trabajos/${t.id}`}
      className="block rounded-xl border border-linea bg-alterno px-4 py-3"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold">{t.cliente_nombre}</p>
          <p className="text-[0.9375rem] text-secundario">
            {t.servicio}
            {t.folio ? ` · ${t.folio}` : ""}
          </p>
        </div>
        <Etiqueta tono={estatus.tono}>{estatus.texto}</Etiqueta>
      </div>

      {t.monto_total > 0 ? (
        <p className="mt-2 text-[0.9375rem] text-secundario">
          Total {pesos(t.monto_total)}
          {t.estatus_publico !== "pagado" && saldo > 0 ? <> · Falta {pesos(saldo)}</> : null}
          {t.por_confirmar > 0 ? <> · {pesos(t.por_confirmar)} por confirmar</> : null}
        </p>
      ) : null}
    </Link>
  );
}
