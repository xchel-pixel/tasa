import Link from "next/link";
import { BloqueNivel } from "@/components/bloque-nivel";
import { Etiqueta } from "@/components/etiqueta";
import { ESTATUS_CERRADOS, estatusVisible } from "@/lib/estatus";
import { pesos } from "@/lib/formato";
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

      <div className="mt-6">
        <BloqueNivel nivel={nivel} />
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <Link
          href="/solicitudes/nueva"
          className="flex min-h-12 items-center justify-center rounded-lg bg-primario px-3 py-3 text-center text-[1rem] font-semibold text-sobre-primario"
        >
          Nueva solicitud
        </Link>
        <Link
          href="/estado-de-cuenta"
          className="flex min-h-12 items-center justify-center rounded-lg border border-primario px-3 py-3 text-center text-[1rem] font-semibold text-primario"
        >
          Estado de cuenta
        </Link>
      </div>

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
