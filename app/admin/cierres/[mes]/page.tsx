import { notFound } from "next/navigation";
import { Etiqueta } from "@/components/etiqueta";
import { PantallaAdmin } from "@/components/pantalla-admin";
import { TIPO_MOVIMIENTO, type TipoMovimiento } from "@/lib/estado-de-cuenta";
import { mesActual, mesLargo, mesSiguiente, pesos } from "@/lib/formato";
import { exigirRol } from "@/lib/sesion";
import { crearClienteServidor, oExplota } from "@/lib/supabase/server";
import { AccionCierre, MarcarPagadas } from "./acciones-cierre";

export const metadata = { title: "Cierre — Tasa" };

type Linea = {
  id: string;
  comisionista_id: string;
  tipo: TipoMovimiento;
  base: string | number | null;
  porcentaje: string | number | null;
  monto: string | number;
  provisional: boolean;
  estado: "devengada" | "pagada";
  nota: string | null;
  comisionistas: { personas: { nombre: string } | null } | null;
  solicitudes: { cliente_nombre: string; folio: string | null; cuentas_receptoras: { alias: string } | null } | null;
};

/**
 * Revisar antes de aprobar: las comisiones del mes por comisionista,
 * subtotales por cuenta (alias) y lo que podría estar faltando (pagos
 * de ese mes que nadie ha confirmado).
 */
export default async function CierreDelMes({ params }: PageProps<"/admin/cierres/[mes]">) {
  const persona = await exigirRol("super_admin", "finanzas");
  const { mes: param } = await params;
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(param)) notFound();
  const mes = `${param}-01`;

  const supabase = await crearClienteServidor();
  const [lineas, cierre, pendientes] = await Promise.all([
    supabase
      .from("comisiones")
      .select(
        "id, comisionista_id, tipo, base, porcentaje, monto, provisional, estado, nota, comisionistas(personas(nombre)), solicitudes(cliente_nombre, folio, cuentas_receptoras(alias))"
      )
      .eq("mes", mes)
      .order("creado_en")
      .returns<Linea[]>(),
    supabase.from("cierres").select("estado").eq("mes", mes).maybeSingle().returns<{ estado: "preparado" | "aprobado" } | null>(),
    supabase
      .from("pagos")
      .select("id", { count: "exact", head: true })
      .eq("estado", "reportado")
      .gte("fecha_pago", mes)
      .lt("fecha_pago", mesSiguiente(mes)),
  ]);

  const filas = oExplota(lineas, "las comisiones del mes") ?? [];
  const estado = oExplota(cierre, "el cierre")?.estado ?? null;
  if (pendientes.error) oExplota(pendientes, "los pagos pendientes");
  const terminado = mes < mesActual();

  // Agrupado por comisionista, con subtotal por alias de cuenta.
  const grupos = new Map<string, { nombre: string; lineas: Linea[]; total: number; porCuenta: Map<string, number>; porPagar: number }>();
  for (const l of filas) {
    const g = grupos.get(l.comisionista_id) ?? {
      nombre: l.comisionistas?.personas?.nombre ?? "",
      lineas: [],
      total: 0,
      porCuenta: new Map<string, number>(),
      porPagar: 0,
    };
    const monto = Number(l.monto);
    const cuenta = l.solicitudes?.cuentas_receptoras?.alias ?? "Sin cuenta";
    g.lineas.push(l);
    g.total += monto;
    g.porCuenta.set(cuenta, (g.porCuenta.get(cuenta) ?? 0) + monto);
    if (l.estado === "devengada") g.porPagar += monto;
    grupos.set(l.comisionista_id, g);
  }
  const total = filas.reduce((s, l) => s + Number(l.monto), 0);

  const etiqueta = !terminado
    ? { texto: "En curso", tono: "neutro" as const }
    : estado === "aprobado"
      ? { texto: "Aprobado", tono: "exito" as const }
      : estado === "preparado"
        ? { texto: "Por aprobar", tono: "proceso" as const }
        : { texto: "Por preparar", tono: "proceso" as const };

  return (
    <PantallaAdmin titulo={`Cierre de ${mesLargo(mes)}`} volver={{ href: "/admin/cierres", texto: "Cierres" }}>
      <div className="mt-2"><Etiqueta tono={etiqueta.tono}>{etiqueta.texto}</Etiqueta></div>

      {terminado && estado !== "aprobado" && (pendientes.count ?? 0) > 0 ? (
        <p className="mt-4 rounded-lg bg-proceso-fondo px-4 py-3 text-[0.9375rem] leading-6 text-proceso">
          Hay {pendientes.count} pago(s) con fecha de este mes sin confirmar. Si se confirman después de aprobar,
          caen en el siguiente mes abierto.
        </p>
      ) : null}
      {filas.some((l) => l.provisional) && estado !== "aprobado" ? (
        <p className="mt-3 rounded-lg bg-tinte px-4 py-3 text-[0.9375rem] leading-6 text-primario">
          Hay comisiones provisionales: su porcentaje se fija al aprobar el cierre del mes anterior.
        </p>
      ) : null}

      <dl className="mt-4 flex items-baseline justify-between rounded-xl bg-tinte px-4 py-3">
        <dt className="font-semibold">Total del mes</dt>
        <dd className="text-[1.25rem] font-bold text-primario">{pesos(total)}</dd>
      </dl>

      {grupos.size === 0 ? (
        <p className="mt-4 rounded-xl bg-alterno px-4 py-3 text-secundario">Sin comisiones este mes.</p>
      ) : (
        [...grupos].map(([id, g]) => (
          <section key={id} className="mt-6 rounded-xl border border-linea px-4 py-4">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="font-bold">{g.nombre}</h2>
              <p className="font-bold text-primario">{pesos(g.total)}</p>
            </div>
            <ul className="mt-2 flex flex-col">
              {g.lineas.map((l, i) => (
                <li key={l.id} className={`flex items-start justify-between gap-3 rounded px-2 py-2 text-[0.9375rem] ${i % 2 ? "bg-alterno" : ""}`}>
                  <span className="min-w-0">
                    <span className="block font-semibold">{l.solicitudes?.cliente_nombre ?? l.nota ?? TIPO_MOVIMIENTO[l.tipo]}</span>
                    <span className="block text-secundario">
                      {TIPO_MOVIMIENTO[l.tipo]}
                      {l.solicitudes?.folio ? ` · ${l.solicitudes.folio}` : ""}
                      {l.base !== null && l.porcentaje !== null ? ` · ${Number(l.porcentaje)}% de ${pesos(Number(l.base))}` : ""}
                      {l.provisional ? " · provisional" : ""}
                      {l.estado === "pagada" ? " · pagada" : ""}
                    </span>
                  </span>
                  <span className={`whitespace-nowrap font-semibold ${Number(l.monto) < 0 ? "text-error" : ""}`}>{pesos(Number(l.monto))}</span>
                </li>
              ))}
            </ul>
            <dl className="mt-3 flex flex-col gap-1 border-t border-linea pt-2 text-[0.9375rem]">
              {[...g.porCuenta].map(([cuenta, monto]) => (
                <div key={cuenta} className="flex justify-between"><dt className="text-secundario">{cuenta}</dt><dd className="font-semibold">{pesos(monto)}</dd></div>
              ))}
            </dl>
            {estado === "aprobado" && g.porPagar !== 0 ? (
              <MarcarPagadas comisionistaId={id} mes={mes} monto={g.porPagar} />
            ) : null}
            {estado === "aprobado" && g.porPagar === 0 ? (
              <p className="mt-3 text-[0.9375rem] font-semibold text-exito">Pagado completo.</p>
            ) : null}
          </section>
        ))
      )}

      {terminado && estado !== "aprobado" ? (
        <div className="mt-6 flex flex-col gap-3">
          <AccionCierre mes={mes} accion="preparar" texto={estado === "preparado" ? "Volver a preparar" : "Preparar cierre"} />
          {estado === "preparado" && persona.rol === "super_admin" ? (
            <AccionCierre mes={mes} accion="aprobar" texto="Aprobar cierre" />
          ) : null}
          {estado === "preparado" && persona.rol !== "super_admin" ? (
            <p className="text-[0.9375rem] text-secundario">Listo para que super_admin lo apruebe.</p>
          ) : null}
        </div>
      ) : null}
    </PantallaAdmin>
  );
}
