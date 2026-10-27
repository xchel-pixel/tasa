import Link from "next/link";
import { PantallaAdmin } from "@/components/pantalla-admin";
import { mesActual, mesLargo, mesSiguiente, pesos } from "@/lib/formato";
import { mesAnterior } from "@/lib/panel";
import { exigirRol } from "@/lib/sesion";
import { crearClienteServidor, oExplota } from "@/lib/supabase/server";

export const metadata = { title: "Reportes — Tasa" };

/**
 * Dos lecturas distintas de un mes:
 *   · ASIGNACIÓN: comisiones del mes por empresa, servicio y comisionista
 *     (sin arrastres: el cargo original ya cuenta en su mes);
 *   · PAGO (solo super_admin): pagos de comisión hechos ese mes por
 *     origen del dinero, y los que se pagaron sin factura.
 */
export default async function Reportes({ searchParams }: PageProps<"/admin/reportes">) {
  const persona = await exigirRol("super_admin", "finanzas");
  const { mes: pedido } = await searchParams;
  const mes = typeof pedido === "string" && /^\d{4}-\d{2}-01$/.test(pedido) ? pedido : mesActual();
  const superAdmin = persona.rol === "super_admin";

  const supabase = await crearClienteServidor();
  const [comisiones, pagos] = await Promise.all([
    supabase
      .from("comisiones")
      .select("monto, tipo, cuentas_receptoras(alias), servicios(nombre), comisionistas(personas(nombre))")
      .eq("mes", mes)
      .neq("tipo", "arrastre")
      .returns<{ monto: string | number; tipo: string; cuentas_receptoras: { alias: string } | null; servicios: { nombre: string } | null; comisionistas: { personas: { nombre: string } | null } | null }[]>(),
    superAdmin
      ? supabase
          .from("pagos_comision")
          .select("monto, documento, origenes_pago(nombre), comisionistas(personas(nombre))")
          .gte("fecha", mes)
          .lt("fecha", mesSiguiente(mes))
          .returns<{ monto: string | number; documento: string; origenes_pago: { nombre: string } | null; comisionistas: { personas: { nombre: string } | null } | null }[]>()
      : Promise.resolve({ data: [], error: null }),
  ]);
  const filas = oExplota(comisiones, "las comisiones") ?? [];
  const listaPagos = oExplota(pagos as { data: unknown[] | null; error: null }, "los pagos") as
    | { monto: string | number; documento: string; origenes_pago: { nombre: string } | null; comisionistas: { personas: { nombre: string } | null } | null }[]
    | null;

  const sumar = <T,>(lista: T[], clave: (x: T) => string, monto: (x: T) => number) => {
    const m = new Map<string, number>();
    for (const x of lista) m.set(clave(x), (m.get(clave(x)) ?? 0) + monto(x));
    return [...m].sort((a, b) => b[1] - a[1]);
  };
  const monto = (x: { monto: string | number }) => Number(x.monto);
  const total = filas.reduce((s, f) => s + Number(f.monto), 0);
  const sinFactura = (listaPagos ?? []).filter((p) => p.documento !== "factura");

  return (
    <PantallaAdmin titulo="Reportes">
      <nav aria-label="Mes" className="mt-3 flex items-center justify-between gap-3">
        <Link href={`/admin/reportes?mes=${mesAnterior(mes)}`} className="toque font-semibold text-acento">← Anterior</Link>
        <span className="font-bold capitalize">{mesLargo(mes)}</span>
        {mes < mesActual() ? (
          <Link href={`/admin/reportes?mes=${mesSiguiente(mes)}`} className="toque font-semibold text-acento">Siguiente →</Link>
        ) : (
          <span className="w-20" />
        )}
      </nav>

      <h2 className="mt-6 text-[1.125rem] font-bold">Comisiones del mes</h2>
      <p className="text-[0.9375rem] text-secundario">Asignadas a la empresa y al servicio de cada trabajo.</p>
      <dl className="mt-3 flex items-baseline justify-between rounded-xl bg-tinte px-4 py-3">
        <dt className="font-semibold">Total</dt>
        <dd className="text-[1.25rem] font-bold text-primario">{pesos(total)}</dd>
      </dl>
      <Tabla titulo="Por empresa" filas={sumar(filas, (f) => f.cuentas_receptoras?.alias ?? "Sin empresa", monto)} />
      <Tabla titulo="Por servicio" filas={sumar(filas, (f) => f.servicios?.nombre ?? "Sin servicio", monto)} />
      <Tabla titulo="Por comisionista" filas={sumar(filas, (f) => f.comisionistas?.personas?.nombre ?? "", monto)} />

      {superAdmin ? (
        <>
          <h2 className="mt-8 text-[1.125rem] font-bold">Pagos de comisión hechos en el mes</h2>
          <p className="text-[0.9375rem] text-secundario">Por fecha de pago, sin importar de qué cierre son.</p>
          <Tabla titulo="Por origen del dinero" filas={sumar(listaPagos ?? [], (p) => p.origenes_pago?.nombre ?? "", monto)} />
          <Tabla
            titulo="Pagados sin factura"
            filas={sumar(sinFactura, (p) => p.comisionistas?.personas?.nombre ?? "", monto)}
            vacio="Todos los pagos del mes llevan factura."
          />
        </>
      ) : null}
    </PantallaAdmin>
  );
}

function Tabla({ titulo, filas, vacio = "Sin movimientos." }: { titulo: string; filas: [string, number][]; vacio?: string }) {
  return (
    <section className="mt-4 rounded-xl border border-linea px-4 py-3">
      <h3 className="font-semibold">{titulo}</h3>
      {filas.length === 0 ? (
        <p className="mt-1 text-[0.9375rem] text-secundario">{vacio}</p>
      ) : (
        <dl className="mt-2 flex flex-col gap-1 text-[0.9375rem]">
          {filas.map(([clave, valor]) => (
            <div key={clave} className="flex justify-between gap-3">
              <dt className="text-secundario">{clave}</dt>
              <dd className={`font-semibold ${valor < 0 ? "text-error" : ""}`}>{pesos(valor)}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}
