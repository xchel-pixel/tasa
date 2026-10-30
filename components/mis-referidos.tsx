import { Contraible } from "@/components/contraible";
import { Etiqueta, type Tono } from "@/components/etiqueta";
import { fechaCorta, pesos } from "@/lib/formato";
import { crearClienteServidor } from "@/lib/supabase/server";

type Referido = {
  vinculo: string;
  nombre: string;
  estado: "en_espera" | "vigente" | "vencido" | "quitado" | "anulado" | "liberado";
  activo: boolean;
  fin: string | null;
  meses_restantes: number | null;
  generado: string | number;
};

type Resumen = {
  activos: number;
  porcentaje: string | number;
  siguiente_desde: number | null;
  siguiente_porcentaje: string | number | null;
  cobra_este_mes: boolean;
  meses_sin_pagos: number;
  aviso_meses: number;
  perdida_meses: number;
  generado_mes: string | number;
};

const ESTADO: Record<Referido["estado"], { texto: string; tono: Tono }> = {
  en_espera: { texto: "En espera", tono: "neutro" },
  vigente: { texto: "Vigente", tono: "exito" },
  vencido: { texto: "Vencido", tono: "neutro" },
  quitado: { texto: "Sin bono", tono: "neutro" },
  anulado: { texto: "Anulado", tono: "error" },
  liberado: { texto: "Liberado", tono: "error" },
};

/**
 * "Mis referidos" del comisionista: cada referido (vigente, en espera hasta su primer trabajo
 * pagado, vencido…), si está activo, meses que le quedan, lo que lleva generado este mes (se
 * confirma al cerrar) y su escalón con cuántos activos le faltan para subir. Nunca montos ni
 * comisiones del referido.
 */
export async function MisReferidos({ usuario }: { usuario: string }) {
  const supabase = await crearClienteServidor();
  const [{ data: lista }, { data: resumen }] = await Promise.all([
    supabase.rpc("mis_referidos"),
    supabase.rpc("mi_resumen_referidos").maybeSingle(),
  ]);
  const referidos = (lista ?? []) as Referido[];
  const r = resumen as Resumen | null;
  if (referidos.length === 0 || !r) return null;

  const faltan = r.siguiente_desde !== null ? r.siguiente_desde - r.activos : null;
  const avisoPerdida = r.meses_sin_pagos >= r.aviso_meses && referidos.some((x) => x.estado === "vigente" || x.estado === "en_espera");

  return (
    <>
      {avisoPerdida ? (
        <p className="mt-4 rounded-xl bg-proceso-fondo px-4 py-3 text-[0.9375rem] leading-6 text-proceso">
          <span className="font-semibold">Llevas {r.meses_sin_pagos} meses sin trabajos pagados:</span> a los {r.perdida_meses} pierdes
          tus referidos.
        </p>
      ) : null}
      <Contraible id="inicio:mis-referidos" usuario={usuario} titulo="Mis referidos" cuenta={referidos.length} abierta>
        <dl className="grid grid-cols-2 gap-2 text-center">
          <div className="rounded-xl bg-tinte px-2 py-3">
            <dt className="text-[0.8125rem]">Tu escalón</dt>
            <dd className="text-[1.25rem] font-bold">{Number(r.porcentaje)}%</dd>
            <dd className="text-[0.8125rem]">{r.activos === 1 ? "1 activo" : `${r.activos} activos`}</dd>
          </div>
          <div className="rounded-xl bg-tinte px-2 py-3">
            <dt className="text-[0.8125rem]">Este mes</dt>
            <dd className="text-[1.25rem] font-bold">{pesos(Number(r.generado_mes))}</dd>
            <dd className="text-[0.8125rem]">se confirma al cerrar</dd>
          </div>
        </dl>
        <p className="mt-2 text-[0.9375rem] leading-6 text-secundario">
          {faltan !== null && r.siguiente_porcentaje !== null
            ? `Te ${faltan === 1 ? "falta 1 referido activo" : `faltan ${faltan} referidos activos`} para subir a ${Number(r.siguiente_porcentaje)}%.`
            : "Estás en el escalón más alto."}{" "}
          Activo = con un trabajo pagado en los últimos 3 meses.
          {!r.cobra_este_mes ? " Para cobrar el bono de este mes necesitas un trabajo pagado tuyo en los últimos 3 meses." : ""}
        </p>
        <ul className="mt-3 flex flex-col gap-2">
          {referidos.map((x) => (
            <li key={x.vinculo} className="rounded-lg border border-linea px-3 py-2 text-[0.9375rem]">
              <div className="flex items-start justify-between gap-3">
                <p className="font-semibold">{x.nombre}</p>
                <Etiqueta tono={ESTADO[x.estado].tono}>{ESTADO[x.estado].texto}</Etiqueta>
              </div>
              <p className="text-secundario">
                {x.activo ? "Activo" : "Sin trabajos pagados recientes"}
                {x.estado === "vigente" && x.fin
                  ? ` · ${x.meses_restantes === 1 ? "queda 1 mes" : `quedan ${x.meses_restantes} meses`} (hasta el ${fechaCorta(x.fin)})`
                  : ""}
                {x.estado === "en_espera" ? " · empieza con su primer trabajo pagado" : ""}
                {Number(x.generado) > 0 ? ` · este mes ${pesos(Number(x.generado))}` : ""}
              </p>
            </li>
          ))}
        </ul>
      </Contraible>
    </>
  );
}
