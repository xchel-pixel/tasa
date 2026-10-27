import Link from "next/link";
import { Etiqueta } from "@/components/etiqueta";
import { PantallaAdmin } from "@/components/pantalla-admin";
import { comisionesPorPagar, type PorPagar } from "@/lib/comisiones";
import { fechaCorta, mesLargo, pesos } from "@/lib/formato";
import { exigirRol } from "@/lib/sesion";

export const metadata = { title: "Comisiones por pagar — Tasa" };

/** Por comisionista, el que tiene lo más vencido primero. */
export default async function ComisionesPorPagar() {
  await exigirRol("super_admin", "finanzas");
  const pendientes = await comisionesPorPagar();

  const grupos = new Map<string, { nombre: string; filas: PorPagar[] }>();
  for (const p of pendientes) {
    const g = grupos.get(p.comisionista_id) ?? { nombre: p.comisionista, filas: [] };
    g.filas.push(p);
    grupos.set(p.comisionista_id, g);
  }
  const total = pendientes.reduce((s, p) => s + p.saldo, 0);

  return (
    <PantallaAdmin titulo="Comisiones por pagar">
      <dl className="mt-4 flex items-baseline justify-between rounded-xl bg-tinte px-4 py-3">
        <dt className="font-semibold">Total por pagar</dt>
        <dd className="text-[1.25rem] font-bold text-primario">{pesos(total)}</dd>
      </dl>

      {grupos.size === 0 ? (
        <p className="mt-4 rounded-xl bg-alterno px-4 py-3 text-secundario">No hay comisiones por pagar.</p>
      ) : (
        <ul className="mt-4 flex flex-col gap-4">
          {[...grupos].map(([id, g]) => (
            <li key={id} className="rounded-xl border border-linea px-4 py-4">
              <div className="flex items-baseline justify-between gap-3">
                <Link href={`/admin/comisionistas/${id}`} className="font-bold text-acento underline underline-offset-4">
                  {g.nombre}
                </Link>
                <span className="font-bold text-primario">{pesos(g.filas.reduce((s, p) => s + p.saldo, 0))}</span>
              </div>
              <ul className="mt-2 flex flex-col gap-2">
                {g.filas.map((p) => (
                  <li key={p.pendiente_id} className="text-[0.9375rem]">
                    <div className="flex justify-between gap-3">
                      <span className="capitalize">{mesLargo(p.mes)}</span>
                      <span className="font-semibold">{pesos(p.saldo)}</span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      {p.vencido ? (
                        <Etiqueta tono="error">Vencido desde el {fechaCorta(p.vence_en)}</Etiqueta>
                      ) : (
                        <span className="text-secundario">Vence el {fechaCorta(p.vence_en)}</span>
                      )}
                      {p.pagado > 0 ? <Etiqueta tono="proceso">Parcial: {pesos(p.pagado)} pagado</Etiqueta> : null}
                      {p.esperando_factura ? <Etiqueta tono="neutro">Esperando factura</Etiqueta> : null}
                    </div>
                  </li>
                ))}
              </ul>
              <Link
                href={`/admin/comisiones/pagar?c=${id}`}
                className="mt-3 flex min-h-12 items-center justify-center rounded-lg border border-primario px-4 font-semibold text-primario"
              >
                Registrar pago
              </Link>
            </li>
          ))}
        </ul>
      )}
    </PantallaAdmin>
  );
}
