import Link from "next/link";
import { PantallaAdmin } from "@/components/pantalla-admin";
import { VIA_PAGO } from "@/lib/estatus";
import { fechaCorta, pesos } from "@/lib/formato";
import { exigirRol } from "@/lib/sesion";
import { crearClienteServidor, oExplota } from "@/lib/supabase/server";
import RevisarPago from "./revisar-pago";

export const metadata = { title: "Pagos por confirmar — Tasa" };

type FilaPago = {
  id: string;
  via: "comprobante" | "directo" | "aviso";
  monto: string | number;
  fecha_pago: string;
  referencia: string | null;
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

/** Los más viejos primero: el que lleva más tiempo esperando va arriba. */
export default async function PagosPorConfirmar() {
  await exigirRol("super_admin", "finanzas");
  const supabase = await crearClienteServidor();

  const pagos =
    oExplota(
      await supabase
        .from("pagos")
        .select(
          `id, via, monto, fecha_pago, referencia, nota, comprobante_ruta, reportado_en,
           solicitudes(id, folio, cliente_nombre, monto_total,
                       comisionistas(personas(nombre)), cuentas_receptoras(alias), pagos(monto, estado))`
        )
        .eq("estado", "reportado")
        .order("reportado_en")
        .returns<FilaPago[]>(),
      "los pagos por confirmar"
    ) ?? [];

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
              <li key={p.id} className="rounded-xl border border-linea px-4 py-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[1.25rem] font-bold text-primario">{pesos(Number(p.monto))}</p>
                    <p className="text-[0.9375rem] text-secundario">
                      {fechaCorta(p.fecha_pago)} · {VIA_PAGO[p.via]}
                    </p>
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
    </PantallaAdmin>
  );
}
