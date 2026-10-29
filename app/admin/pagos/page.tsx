import Link from "next/link";
import { PantallaAdmin } from "@/components/pantalla-admin";
import { Etiqueta } from "@/components/etiqueta";
import { AccionConMotivo, MesCerrado } from "@/components/accion-con-motivo";
import { ESTADO_PAGO, VIA_PAGO, type ViaPago } from "@/lib/estatus";
import { mesDeFecha, mesesCerrados } from "@/lib/meses";
import { fechaCorta, pesos } from "@/lib/formato";
import { exigirRol, ROLES_OPERACION } from "@/lib/sesion";
import { crearClienteServidor, oExplota } from "@/lib/supabase/server";
import RevisarPago from "./revisar-pago";

export const metadata = { title: "Pagos por confirmar — Tasa" };

type FilaPago = {
  id: string;
  via: ViaPago;
  monto: string | number;
  fecha_pago: string;
  referencia: string | null;
  recibido_por: string | null;
  nota: string | null;
  comprobante_ruta: string | null;
  reportado_en: string;
  solicitudes: {
    id: string;
    folio: string | null;
    cliente_nombre: string;
    monto_total: string | number;
    comisionistas: { personas: { nombre: string } | null } | null;
    cuentas_receptoras: { alias: string } | null;
    pagos: { monto: string | number; estado: string }[];
  } | null;
};

/** El instante de hace `n` días, para filtrar por fecha de revisión. */
function haceDias(n: number) {
  return new Date(Date.now() - n * 24 * 3600 * 1000).toISOString();
}

/** Los más viejos primero: el que lleva más tiempo esperando va arriba. */
export default async function PagosPorConfirmar() {
  await exigirRol(...ROLES_OPERACION);
  const supabase = await crearClienteServidor();

  const pagos =
    oExplota(
      await supabase
        .from("pagos")
        .select(
          `id, via, monto, fecha_pago, referencia, recibido_por, nota, comprobante_ruta, reportado_en,
           solicitudes(id, folio, cliente_nombre, monto_total,
                       comisionistas(personas!comisionistas_persona_id_fkey(nombre)), cuentas_receptoras(alias), pagos(monto, estado))`
        )
        .eq("estado", "reportado")
        .order("reportado_en")
        .returns<FilaPago[]>(),
      "los pagos por confirmar"
    ) ?? [];

  // Lo revisado en los últimos 30 días, para corregir sin buscar el trabajo.
  const hace30 = haceDias(30);
  const [revisados, cerrados] = await Promise.all([
    supabase
      .from("pagos")
      .select("id, monto, fecha_pago, estado, motivo_rechazo, revisado_en, solicitudes(id, cliente_nombre, folio, mes_cierre)")
      .in("estado", ["confirmado", "rechazado"])
      .gte("revisado_en", hace30)
      .order("revisado_en", { ascending: false })
      .limit(30)
      .returns<Revisado[]>(),
    mesesCerrados(),
  ]);
  const listaRevisados = oExplota(revisados, "los pagos revisados") ?? [];

  // El bucket es privado: cada comprobante se abre con una liga que vence en 10 minutos.
  const ligas = await Promise.all(
    pagos.map(async (p) => {
      if (!p.comprobante_ruta) return null;
      const { data } = await supabase.storage.from("comprobantes").createSignedUrl(p.comprobante_ruta, 600);
      return data?.signedUrl ?? null;
    })
  );

  return (
    <PantallaAdmin titulo="Pagos por confirmar">
      {pagos.length === 0 ? (
        <p className="mt-4 rounded-xl bg-alterno px-4 py-3 text-secundario">No hay pagos esperando confirmación.</p>
      ) : (
        <ul className="mt-4 flex flex-col gap-4">
          {pagos.map((p, i) => {
            const s = p.solicitudes;
            const confirmado = (s?.pagos ?? [])
              .filter((x) => x.estado === "confirmado")
              .reduce((t, x) => t + Number(x.monto), 0);
            const falta = Number(s?.monto_total ?? 0) - confirmado;
            return (
              <li
                key={p.id}
                className={`rounded-xl border px-4 py-4 ${p.via === "efectivo" ? "border-proceso border-l-4" : "border-linea"}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[1.25rem] font-bold text-primario">{pesos(Number(p.monto))}</p>
                    <p className="text-[0.9375rem] text-secundario">
                      {fechaCorta(p.fecha_pago)}
                      {p.via === "efectivo" ? "" : ` · ${VIA_PAGO[p.via]}`}
                    </p>
                    {p.via === "efectivo" ? (
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <Etiqueta tono="proceso">Efectivo</Etiqueta>
                        <span className="text-[0.9375rem]">Recibió: {p.recibido_por}</span>
                      </div>
                    ) : null}
                  </div>
                  {s?.cuentas_receptoras ? (
                    <span className="rounded-full bg-tinte px-3 py-1 text-[0.875rem] font-semibold text-primario">
                      {s.cuentas_receptoras.alias}
                    </span>
                  ) : null}
                </div>

                {s ? (
                  <p className="mt-2 text-[0.9375rem]">
                    <Link href={`/trabajos/${s.id}`} className="font-semibold text-acento underline underline-offset-4">
                      {s.cliente_nombre}
                    </Link>
                    {s.folio ? ` · ${s.folio}` : ""} · {s.comisionistas?.personas?.nombre}
                  </p>
                ) : null}
                <p className="text-[0.9375rem] text-secundario">
                  Total {pesos(Number(s?.monto_total ?? 0))} · confirmado {pesos(confirmado)} · falta {pesos(falta)}
                </p>

                {p.referencia ? <p className="mt-2 text-[0.9375rem]">Referencia: {p.referencia}</p> : null}
                {p.nota ? <p className="mt-2 rounded-lg bg-alterno px-3 py-2 text-[0.9375rem]">{p.nota}</p> : null}
                {ligas[i] ? (
                  <a
                    href={ligas[i]!}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="toque text-[0.9375rem] font-semibold text-acento underline underline-offset-4"
                  >
                    Ver comprobante
                  </a>
                ) : null}

                <RevisarPago pagoId={p.id} excede={Number(p.monto) > falta + 0.001} />
              </li>
            );
          })}
        </ul>
      )}

      {listaRevisados.length > 0 ? (
        <section className="mt-10">
          <h2 className="text-[1.125rem] font-bold">Revisados en los últimos 30 días</h2>
          <p className="mt-1 text-[0.9375rem] leading-6 text-secundario">
            Si alguno se confirmó o rechazó por error, regrésalo a &quot;Por confirmar&quot;.
          </p>
          <ul className="mt-3 flex flex-col gap-2">
            {listaRevisados.map((r) => {
              const cerrado =
                cerrados.has(mesDeFecha(r.fecha_pago)) ||
                (r.estado === "confirmado" && Boolean(r.solicitudes?.mes_cierre) && cerrados.has(mesDeFecha(r.solicitudes!.mes_cierre!)));
              return (
                <li key={r.id} className="rounded-lg border border-linea px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 text-[0.9375rem]">
                      <p className="font-semibold">{pesos(Number(r.monto))}</p>
                      {r.solicitudes ? (
                        <Link href={`/trabajos/${r.solicitudes.id}`} className="text-acento underline underline-offset-4">
                          {r.solicitudes.cliente_nombre}
                        </Link>
                      ) : null}
                      <p className="text-secundario">Pago del {fechaCorta(r.fecha_pago)}</p>
                    </div>
                    <Etiqueta tono={ESTADO_PAGO[r.estado].tono}>{ESTADO_PAGO[r.estado].texto}</Etiqueta>
                  </div>
                  {cerrado ? (
                    <MesCerrado />
                  ) : (
                    <AccionConMotivo
                      que="revertir_pago"
                      id={r.id}
                      texto={r.estado === "confirmado" ? "Revertir confirmación" : "Revertir rechazo"}
                      explicacion={
                        r.estado === "confirmado"
                          ? "El pago vuelve a \"Por confirmar\". Si con él el trabajo había quedado pagado, deja de estarlo y la comisión que devengó se quita."
                          : "El pago vuelve a \"Por confirmar\" para revisarlo otra vez."
                      }
                    />
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
    </PantallaAdmin>
  );
}

type Revisado = {
  id: string;
  monto: string | number;
  fecha_pago: string;
  estado: "confirmado" | "rechazado";
  motivo_rechazo: string | null;
  revisado_en: string;
  solicitudes: { id: string; cliente_nombre: string; folio: string | null; mes_cierre: string | null } | null;
};
