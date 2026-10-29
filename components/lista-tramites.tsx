import Link from "next/link";
import { Contraible } from "@/components/contraible";
import { Etiqueta } from "@/components/etiqueta";
import { estatusVisible } from "@/lib/estatus";
import { pesos } from "@/lib/formato";
import { GRUPOS, grupoDe, ordenar, saldoDe, type Tramite } from "@/lib/tramites";

const ORIGEN = { comisionista: "Comisionista", liga: "Liga de cliente", equipo: "Liga de equipo" } as const;

/**
 * Los trámites agrupados por estatus, cada grupo contraíble con su contador. Entregados y
 * cancelados vienen cerrados. Es la misma lista para el comisionista, para "Mis trámites" del
 * equipo y para "Trámites" del staff; `conDueno` agrega quién la trajo (solo quien opera).
 */
export function ListaTramites({
  tramites,
  usuario,
  seccion,
  conDueno = false,
  cuentas,
  vacio = "No hay trámites.",
}: {
  tramites: Tramite[];
  usuario: string;
  /** Prefijo para recordar qué grupos dejó abiertos, p. ej. "mis-tramites". */
  seccion: string;
  conDueno?: boolean;
  /** Cuántos hay en cada grupo si la lista viene paginada (sin esto, se cuentan los de la lista). */
  cuentas?: Partial<Record<string, number>>;
  vacio?: string;
}) {
  if (tramites.length === 0) {
    return <p className="mt-4 rounded-xl bg-alterno px-4 py-3 text-secundario">{vacio}</p>;
  }
  return (
    <>
      {GRUPOS.map((g) => {
        const del = tramites.filter((t) => grupoDe(t) === g.clave).sort(ordenar);
        if (del.length === 0) return null;
        return (
          <Contraible key={g.clave} id={`${seccion}:${g.clave}`} usuario={usuario} titulo={g.titulo}
            cuenta={cuentas?.[g.clave] ?? del.length} abierta={!g.cerrado}>
            <TarjetasTramite tramites={del} conDueno={conDueno} />
          </Contraible>
        );
      })}
    </>
  );
}

export function TarjetasTramite({ tramites, conDueno = false }: { tramites: Tramite[]; conDueno?: boolean }) {
  return (
    <ul className="flex flex-col gap-3">
      {tramites.map((t) => (
        <li key={t.id}>
          <TarjetaTramite tramite={t} conDueno={conDueno} />
        </li>
      ))}
    </ul>
  );
}

/** La tarjeta del comisionista: cliente, servicio, folio, estatus y lo que falta cobrar. Nunca comisiones. */
export function TarjetaTramite({ tramite: t, conDueno = false }: { tramite: Tramite; conDueno?: boolean }) {
  const estatus = estatusVisible(t.estatus_publico, t.folio);
  const saldo = saldoDe(t);
  // Quien opera cotiza desde su bandeja; los demás siguen la ficha.
  const href = conDueno && (t.estado === "solicitada" || t.estado === "vencida") ? `/admin/solicitudes/${t.id}` : `/trabajos/${t.id}`;

  return (
    <Link href={href} className="block rounded-xl border border-linea bg-alterno px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold">{t.cliente_nombre}</p>
          <p className="text-[0.9375rem] text-secundario">
            {t.servicio}
            {t.folio ? ` · ${t.folio}` : ""}
          </p>
          {conDueno ? (
            <p className="text-[0.9375rem] text-secundario">
              {ORIGEN[t.origen]} · {t.dueno ?? "La organización"}
              {t.marca ? ` · ${t.marca}` : ""}
            </p>
          ) : t.origen !== "comisionista" ? (
            <p className="text-[0.9375rem] text-secundario">Por tu liga de cliente</p>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <Etiqueta tono={estatus.tono}>{estatus.texto}</Etiqueta>
          {t.quiere_tramite && (t.estado === "solicitada" || t.estado === "cotizada") ? (
            <Etiqueta tono="exito">Quiere el trámite</Etiqueta>
          ) : null}
        </div>
      </div>

      {t.estimado_pendiente ? (
        <p className="mt-2 text-[0.9375rem] font-semibold text-proceso">
          {t.honorario_minimo !== null && t.honorario_minimo < (t.monto_honorarios ?? 0)
            ? `Estimado ${pesos(t.honorario_minimo)} – ${pesos(t.monto_honorarios ?? 0)}`
            : `Estimado ${pesos(t.monto_honorarios ?? 0)}`}{" "}
          · por definir
        </p>
      ) : t.honorario_tipo === "sin_costo" && t.estado === "tramite" ? (
        <p className="mt-2 text-[0.9375rem] text-secundario">Sin costo</p>
      ) : null}
      {t.monto_total > 0 && !t.estimado_pendiente ? (
        <p className="mt-2 text-[0.9375rem] text-secundario">
          Total {pesos(t.monto_total)}
          {saldo > 0 ? <> · Falta {pesos(saldo)}</> : null}
          {t.por_confirmar > 0 ? <> · {pesos(t.por_confirmar)} por confirmar</> : null}
        </p>
      ) : null}
    </Link>
  );
}
