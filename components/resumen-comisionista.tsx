import Link from "next/link";
import { abrirVerComo } from "@/app/ver-como/acciones";
import { Etiqueta } from "@/components/etiqueta";
import { estatusVisible, type EstatusPublico } from "@/lib/estatus";
import { fechaCorta, pesos } from "@/lib/formato";
import { crearClienteServidor } from "@/lib/supabase/server";

type Resumen = {
  nivel: string | null; nivel_anterior: string | null; porcentaje: number; provisional: boolean; motivo: string | null;
  trato: { tipo: string | null; hasta: string; nivel: string | null } | null; elite: { porcentaje: number; hasta: string | null } | null;
  volumen_mes: number; promedio: number; meses: number; nivel_proyectado: string | null;
  siguiente: { nombre: string; porcentaje: number; umbral: number; falta: number } | null;
  comision_mes: number; por_pagar: number; paquete: string | null; paquete_vence: string | null; saldo: number;
  actividad: { estado: "activa" | "por_vencer" | "inactiva" | "no_aplica"; vence: string | null; dias: number | null };
  tramites: { id: string; folio: string | null; cliente_nombre: string; estado: string; estatus_publico: string; monto_honorarios: number | null; creado_en: string }[];
};

const TRATO: Record<string, string> = { bienvenida: "Bienvenida", arranque: "Arranque" };

/** "Ver como este comisionista" (0080): abre su vista de solo lectura. */
export function BotonVerComo({ personaId }: { personaId: string }) {
  return (
    <form action={abrirVerComo}>
      <input type="hidden" name="persona" value={personaId} />
      <button type="submit" className="flex min-h-11 w-full items-center justify-center rounded-lg border border-primario px-3 font-semibold text-primario">
        Ver como este comisionista
      </button>
    </form>
  );
}

function Cifra({ titulo, valor, detalle }: { titulo: string; valor: string; detalle?: string | null }) {
  return (
    <div className="rounded-xl border border-linea px-3 py-2">
      <dt className="text-[0.8125rem] text-secundario">{titulo}</dt>
      <dd className="font-bold tabular-nums">{valor}</dd>
      {detalle ? <dd className="text-[0.8125rem] leading-5 text-secundario">{detalle}</dd> : null}
    </div>
  );
}

/** El resumen arriba de la ficha (admin_org y finanzas): nivel, volumen, lo que falta, comisión, tasa, paquete, estatus y trámites. */
export async function ResumenComisionista({ personaId }: { personaId: string }) {
  const supabase = await crearClienteServidor();
  const { data, error } = await supabase.rpc("resumen_comisionista", { p_persona: personaId });
  if (error || !data) return null;
  const r = data as Resumen;
  const n = (x: number | string | null) => Number(x ?? 0);
  const tasa = r.elite
    ? `Élite ${n(r.elite.porcentaje)} %${r.elite.hasta ? ` hasta el ${fechaCorta(r.elite.hasta)}` : ""}`
    : r.trato
      ? `${TRATO[r.trato.tipo ?? ""] ?? "Trato"} (${r.trato.nivel ?? "nivel"}) hasta el ${fechaCorta(r.trato.hasta)}`
      : r.provisional ? "Provisional hasta el cierre" : "Por su promedio";
  const estado = r.actividad.estado === "inactiva" ? <Etiqueta tono="neutro">Inactiva</Etiqueta>
    : r.actividad.estado === "por_vencer" ? <Etiqueta tono="proceso">Por inactivarse{r.actividad.dias !== null ? ` (${r.actividad.dias} días)` : ""}</Etiqueta>
    : <Etiqueta tono="exito">Activa</Etiqueta>;

  return (
    <section className="mt-4 rounded-xl border border-linea px-4 py-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-bold">Resumen</h2>
        {estado}
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-2 text-[0.9375rem] md:grid-cols-4">
        <Cifra titulo="Nivel actual" valor={`${r.nivel ?? "—"} · ${n(r.porcentaje)} %`} detalle={`Mes anterior: ${r.nivel_anterior ?? "—"}`} />
        <Cifra titulo="Tasa vigente" valor={`${n(r.porcentaje)} %`} detalle={tasa} />
        <Cifra titulo="Volumen del mes" valor={pesos(n(r.volumen_mes))} detalle="Honorarios de trabajos pagados" />
        <Cifra titulo="Promedio para su nivel" valor={pesos(n(r.promedio))} detalle={`${r.meses} mes${r.meses === 1 ? "" : "es"} · proyecta ${r.nivel_proyectado ?? "—"}`} />
        <Cifra titulo="Para el siguiente nivel" valor={r.siguiente ? pesos(n(r.siguiente.falta)) : "Ya está en el más alto"}
          detalle={r.siguiente ? `Faltan este mes para ${r.siguiente.nombre} (${n(r.siguiente.porcentaje)} %)` : null} />
        <Cifra titulo="Comisión del mes" valor={pesos(n(r.comision_mes))} detalle={n(r.por_pagar) ? `${pesos(n(r.por_pagar))} de cierres por pagar` : "Nada de cierres por pagar"} />
        <Cifra titulo="Paquete y saldo" valor={r.paquete ? `${r.paquete} · ${pesos(n(r.saldo))}` : "Sin paquete"}
          detalle={r.paquete_vence ? `Vence el ${fechaCorta(r.paquete_vence)}` : null} />
        <Cifra titulo="Estatus" valor={r.actividad.estado === "inactiva" ? "Inactiva" : r.actividad.estado === "por_vencer" ? "Por inactivarse" : "Activa"}
          detalle={r.actividad.estado !== "inactiva" && r.actividad.vence ? `Sin cobro, pasaría a inactiva el ${fechaCorta(r.actividad.vence)}` : null} />
      </dl>
      <h3 className="mt-4 text-[0.9375rem] font-semibold">Últimos trámites</h3>
      {r.tramites.length ? (
        <ul className="mt-1 flex flex-col gap-1 text-[0.9375rem]">
          {r.tramites.map((t) => {
            const e = estatusVisible(t.estatus_publico as EstatusPublico, t.folio);
            return (
              <li key={t.id} className="flex items-center justify-between gap-2">
                <Link href={`/trabajos/${t.id}`} className="min-w-0 truncate underline underline-offset-4">{t.folio ?? "Sin folio"} · {t.cliente_nombre}</Link>
                <Etiqueta tono={e.tono}>{e.texto}</Etiqueta>
              </li>
            );
          })}
        </ul>
      ) : <p className="mt-1 text-[0.9375rem] text-secundario">Todavía no tiene trámites.</p>}
      <div className="mt-4"><BotonVerComo personaId={personaId} /></div>
    </section>
  );
}
