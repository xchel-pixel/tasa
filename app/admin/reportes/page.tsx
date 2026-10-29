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
 *   · PAGO (solo admin_org): pagos de comisión hechos ese mes por
 *     origen del dinero, y los que se pagaron sin factura.
 * Más los trabajos aceptados en el mes por tipo de honorario (fijo, sin
 * costo, estimado ya fijado y estimado pendiente de fijar).
 */

type FilaHonorario = {
  honorario_tipo: "fijo" | "sin_costo" | "estimado";
  honorario_final_en: string | null;
  monto_honorarios: string | number | null;
  estado: string;
};
export default async function Reportes({ searchParams }: PageProps<"/admin/reportes">) {
  const persona = await exigirRol("admin_org", "finanzas");
  const { mes: pedido } = await searchParams;
  const mes = typeof pedido === "string" && /^\d{4}-\d{2}-01$/.test(pedido) ? pedido : mesActual();
  const superAdmin = persona.rol === "admin_org";

  const supabase = await crearClienteServidor();
  const [comisiones, pagos, trabajos, pendientes] = await Promise.all([
    supabase
      .from("comisiones")
      .select("monto, tipo, cuentas_receptoras(alias), servicios(nombre), comisionistas(personas!comisionistas_persona_id_fkey(nombre))")
      .eq("mes", mes)
      .neq("tipo", "arrastre")
      .returns<{ monto: string | number; tipo: string; cuentas_receptoras: { alias: string } | null; servicios: { nombre: string } | null; comisionistas: { personas: { nombre: string } | null } | null }[]>(),
    superAdmin
      ? supabase
          .from("pagos_comision")
          .select("monto, documento, origenes_pago(nombre), comisionistas(personas!comisionistas_persona_id_fkey(nombre))")
          .eq("estado", "registrado")
          .gte("fecha", mes)
          .lt("fecha", mesSiguiente(mes))
          .returns<{ monto: string | number; documento: string; origenes_pago: { nombre: string } | null; comisionistas: { personas: { nombre: string } | null } | null }[]>()
      : Promise.resolve({ data: [], error: null }),
    supabase
      .from("solicitudes")
      .select("honorario_tipo, honorario_final_en, monto_honorarios, estado")
      .eq("estado", "tramite")
      .gte("aceptada_en", mes)
      .lt("aceptada_en", mesSiguiente(mes))
      .returns<FilaHonorario[]>(),
    // Pendientes de fijar, de cualquier mes: es trabajo por hacer, no historia.
    supabase
      .from("solicitudes")
      .select("honorario_tipo, honorario_final_en, monto_honorarios, estado")
      .eq("estado", "tramite")
      .eq("honorario_tipo", "estimado")
      .is("honorario_final_en", null)
      .returns<FilaHonorario[]>(),
  ]);
  const delMes = oExplota(trabajos, "los trabajos del mes") ?? [];
  const porFijar = oExplota(pendientes, "los estimados pendientes") ?? [];
  const grupo = (que: (x: FilaHonorario) => boolean) => {
    const g = delMes.filter(que);
    return { cuantos: g.length, honorarios: g.reduce((s, x) => s + Number(x.monto_honorarios ?? 0), 0) };
  };
  const tipos = [
    { texto: "Fijo", ...grupo((x) => x.honorario_tipo === "fijo") },
    { texto: "Sin costo", ...grupo((x) => x.honorario_tipo === "sin_costo") },
    { texto: "Estimado con honorario final", ...grupo((x) => x.honorario_tipo === "estimado" && x.honorario_final_en !== null) },
    { texto: "Estimado pendiente de fijar", ...grupo((x) => x.honorario_tipo === "estimado" && x.honorario_final_en === null) },
  ];
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

      <h2 className="mt-8 text-[1.125rem] font-bold">Trabajos por tipo de honorario</h2>
      <p className="text-[0.9375rem] text-secundario">Aceptados en el mes. En un estimado pendiente, el monto es el estimado.</p>
      <section className="mt-3 rounded-xl border border-linea px-4 py-3">
        <dl className="flex flex-col gap-1 text-[0.9375rem]">
          {tipos.map((x) => (
            <div key={x.texto} className="flex justify-between gap-3">
              <dt className="text-secundario">
                {x.texto} · {x.cuantos}
              </dt>
              <dd className="font-semibold">{x.texto === "Sin costo" ? "—" : pesos(x.honorarios)}</dd>
            </div>
          ))}
        </dl>
      </section>
      {porFijar.length > 0 ? (
        <Link href="/admin/tramites?estimado=1" className="mt-3 block rounded-xl border border-proceso bg-proceso-fondo px-4 py-3 text-[0.9375rem] text-proceso">
          <span className="font-semibold">
            {porFijar.length === 1 ? "1 estimado" : `${porFijar.length} estimados`} sin honorario final
          </span>{" "}
          (de cualquier mes), por {pesos(porFijar.reduce((s, x) => s + Number(x.monto_honorarios ?? 0), 0))} estimados.
        </Link>
      ) : null}

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
