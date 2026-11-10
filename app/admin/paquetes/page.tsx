import Link from "next/link";
import { Etiqueta } from "@/components/etiqueta";
import { PantallaAdmin } from "@/components/pantalla-admin";
import { hoyMx } from "@/lib/estadisticas";
import { fechaCorta, pesos } from "@/lib/formato";
import { ESTADO_LOTE, TIPO_COMPRA, type Lote, type PaquetesAdmin } from "@/lib/paquetes";
import { exigirRol } from "@/lib/sesion";
import { crearClienteServidor } from "@/lib/supabase/server";
import { ConfirmarCompra } from "./formularios";

export const metadata = { title: "Paquetes — Tasa" };

const GRUPOS: { estado: Lote["estado"]; titulo: string }[] = [
  { estado: "por_vencer", titulo: "Por vencer (30 días)" },
  { estado: "vigente", titulo: "Saldos vigentes" },
  { estado: "consumido", titulo: "Consumidos" },
  { estado: "vencido", titulo: "Vencidos" },
  { estado: "renovado", titulo: "Renovados" },
];

/** Paquetes de crédito (0077): pagos por confirmar y los paquetes vendidos por estado. admin_org y finanzas. */
export default async function PaquetesAdminPagina() {
  await exigirRol("admin_org", "finanzas");
  const supabase = await crearClienteServidor();
  const { data, error } = await supabase.rpc("paquetes_admin");
  if (error) throw new Error(`No se pudieron leer los paquetes: ${error.message}`);
  const d = data as PaquetesAdmin;
  const hoy = hoyMx();
  const n = (x: number | string | null) => Number(x ?? 0);
  const vigentes = d.lotes.filter((l) => l.estado === "vigente" || l.estado === "por_vencer");

  return (
    <PantallaAdmin titulo="Paquetes de crédito" ancha>
      <dl className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          ["Por confirmar", String(d.por_confirmar.length)],
          ["Paquetes vigentes", String(vigentes.length)],
          ["Saldo vigente", pesos(vigentes.reduce((s, l) => s + n(l.saldo), 0))],
          ["Crédito consumido", pesos(d.lotes.reduce((s, l) => s + n(l.consumido), 0))],
        ].map(([t, v]) => (
          <div key={t} className="rounded-xl border border-linea px-4 py-3">
            <dt className="text-[0.875rem] text-secundario">{t}</dt>
            <dd className="mt-1 text-[1.25rem] font-bold tabular-nums">{v}</dd>
          </div>
        ))}
      </dl>

      <section className="mt-6">
        <h2 className="text-[1.125rem] font-bold">Pagos por confirmar</h2>
        {d.por_confirmar.length ? (
          <ul className="mt-2 grid gap-2 md:grid-cols-2">
            {d.por_confirmar.map((c) => (
              <li key={c.id} className="rounded-xl border border-proceso px-4 py-3">
                <p className="font-semibold">{c.persona}</p>
                <p className="text-[0.9375rem] text-secundario">
                  {TIPO_COMPRA[c.tipo]} {c.paquete} · paga {pesos(n(c.precio))} · recibe {pesos(n(c.credito))} · pedido el {fechaCorta(c.creado_en)}
                </p>
                <ConfirmarCompra compra={c.id} precio={n(c.precio)} cuentas={d.cuentas} cuentaSugerida={d.cuenta_paquetes} hoy={hoy} />
              </li>
            ))}
          </ul>
        ) : <p className="mt-1 text-[0.9375rem] text-secundario">Nada por confirmar.</p>}
      </section>

      {GRUPOS.map((g) => {
        const lista = d.lotes.filter((l) => l.estado === g.estado);
        if (!lista.length) return null;
        return (
          <section key={g.estado} className="mt-6">
            <h2 className="text-[1.125rem] font-bold">{g.titulo} ({lista.length})</h2>
            <div className="mt-2 overflow-x-auto rounded-xl border border-linea">
              <table className="w-full min-w-max border-collapse text-left text-[0.875rem] leading-5">
                <thead className="bg-alterno">
                  <tr>{["Comisionista", "Paquete", "Vigencia", "Crédito", "Consumido", "Saldo", "Vencido", "Pago", ""].map((c) => <th key={c} className="px-3 py-2 font-semibold">{c}</th>)}</tr>
                </thead>
                <tbody>
                  {lista.map((l) => (
                    <tr key={l.id} className="border-t border-linea">
                      <td className="px-3 py-2 font-semibold"><Link href={`/admin/accesos/${l.persona_id}`} className="underline underline-offset-4">{l.persona}</Link></td>
                      <td className="px-3 py-2">{l.paquete}</td>
                      <td className="px-3 py-2">{fechaCorta(l.inicia)} – {fechaCorta(l.vence)}</td>
                      <td className="px-3 py-2 tabular-nums">{pesos(n(l.credito))}</td>
                      <td className="px-3 py-2 tabular-nums">{pesos(n(l.consumido))}</td>
                      <td className="px-3 py-2 font-semibold tabular-nums">{pesos(n(l.saldo))}</td>
                      <td className="px-3 py-2 tabular-nums">{n(l.vencido) ? pesos(n(l.vencido)) : "—"}</td>
                      <td className="px-3 py-2">{l.forma_pago === "comision" ? "Con comisión" : `${pesos(n(l.pago_monto))}${l.folio_cfdi ? ` · CFDI ${l.folio_cfdi}` : ""}`}</td>
                      <td className="px-3 py-2"><Etiqueta tono={ESTADO_LOTE[l.estado].tono}>{ESTADO_LOTE[l.estado].texto}</Etiqueta></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}
      {!d.lotes.length ? <p className="mt-6 text-[0.9375rem] text-secundario">Todavía no se ha vendido ningún paquete.</p> : null}
      <p className="mt-6 text-[0.875rem] leading-6 text-secundario">
        El catálogo de paquetes y la cuenta para transferir se editan en <Link href="/admin/catalogos" className="underline underline-offset-4">Catálogos</Link>.
      </p>
    </PantallaAdmin>
  );
}
