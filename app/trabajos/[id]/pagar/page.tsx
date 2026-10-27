import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Encabezado } from "@/components/encabezado";
import { pesos } from "@/lib/formato";
import { exigirRol } from "@/lib/sesion";
import { obtenerTrabajo } from "@/lib/trabajos";
import FormularioPago from "./formulario-pago";

export const metadata = { title: "Reportar pago — Tasa" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function ReportarPago({ params }: PageProps<"/trabajos/[id]/pagar">) {
  const persona = await exigirRol("comisionista");
  const { id } = await params;
  if (!UUID.test(id)) notFound();

  const t = await obtenerTrabajo(id);
  if (!t) notFound();
  // Solo un trámite que aún no está pagado recibe pagos (la base también lo exige).
  if (t.estado !== "tramite" || t.pagado_en) redirect(`/trabajos/${id}`);

  const confirmado = t.pagos.filter((p) => p.estado === "confirmado").reduce((s, p) => s + p.monto, 0);
  const porConfirmar = t.pagos.filter((p) => p.estado === "reportado").reduce((s, p) => s + p.monto, 0);
  const falta = Math.max(0, t.monto_total - confirmado);
  const hoy = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City" }).format(new Date());

  return (
    <>
      <Encabezado />
      <main className="flex flex-1 flex-col px-6 py-6">
        <div className="mx-auto w-full max-w-md">
          <Link href={`/trabajos/${id}`} className="toque text-[0.9375rem] font-semibold text-acento">
            ← {t.cliente_nombre}
          </Link>
          <h1 className="mt-2 text-[1.5rem] font-bold tracking-tight">Reportar pago</h1>

          <dl className="mt-4 flex flex-col gap-1 rounded-xl bg-tinte px-4 py-3 text-[0.9375rem]">
            <div className="flex justify-between gap-3">
              <dt className="text-secundario">Total del trabajo</dt>
              <dd className="font-semibold">{pesos(t.monto_total)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-secundario">Confirmado</dt>
              <dd className="font-semibold">{pesos(confirmado)}</dd>
            </div>
            {porConfirmar > 0 ? (
              <div className="flex justify-between gap-3">
                <dt className="text-secundario">Por confirmar</dt>
                <dd className="font-semibold">{pesos(porConfirmar)}</dd>
              </div>
            ) : null}
            <div className="mt-1 flex justify-between gap-3 border-t border-linea pt-2">
              <dt className="font-semibold">Falta</dt>
              <dd className="text-[1.0625rem] font-bold text-primario">{pesos(falta)}</dd>
            </div>
          </dl>

          <FormularioPago
            solicitudId={id}
            personaId={persona.id}
            sugerido={Math.max(0, falta - porConfirmar)}
            hoy={hoy}
          />
        </div>
      </main>
    </>
  );
}
