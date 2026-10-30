import { crearClienteServidor, oExplota } from "@/lib/supabase/server";
import { mesActual, mesSiguiente } from "@/lib/formato";

/**
 * El estado de cuenta es la lectura de `comisiones` por mes. Un mes con
 * cierre aprobado está publicado y ya no cambia; el mes abierto se
 * muestra "en curso" porque todavía puede moverse.
 *
 * Lo pagado sale del pendiente de pago que deja el cierre: un pendiente
 * por mes con saldo a favor, que se cubre con uno o varios pagos.
 */

export type TipoMovimiento = "comision" | "bono" | "ajuste" | "cargo" | "referido" | "arrastre";

export const TIPO_MOVIMIENTO: Record<TipoMovimiento, string> = {
  comision: "Comisión",
  bono: "Bono",
  ajuste: "Ajuste",
  cargo: "Cargo",
  referido: "Bono de referidos",
  arrastre: "Saldo arrastrado",
};

export type Movimiento = {
  id: string;
  tipo: TipoMovimiento;
  base: number | null;
  porcentaje: number | null;
  monto: number;
  provisional: boolean;
  estado: "devengada" | "pagada";
  pagada_en: string | null;
  nota: string | null;
  trabajo: { id: string; folio: string | null; cliente: string } | null;
  /** Alias de la empresa (cuenta receptora) a la que se asigna. */
  entidad: string;
  servicio: string | null;
  /** Este movimiento anula a otro (su contrario). */
  anula_id: string | null;
  /** Este movimiento fue anulado (existe su contrario). */
  anulado: boolean;
};

/** Lo que el comisionista ve de un pago: nunca el origen del dinero. */
export type PagoRecibido = { fecha: string; referencia: string | null; monto: number };

export type Pendiente = {
  id: string;
  monto: number;
  pagado: number;
  pagado_en: string | null;
  factura_ruta: string | null;
  pagos: PagoRecibido[];
};

export type MesDeCuenta = {
  mes: string;
  publicado: boolean;
  movimientos: Movimiento[];
  porEntidad: { entidad: string; total: number }[];
  total: number;
  pendiente: Pendiente | null;
  nivelSiguiente: { nombre: string; porcentaje: number; promedio: number; meses: number } | null;
};

type FilaMovimiento = {
  id: string;
  tipo: TipoMovimiento;
  base: string | number | null;
  porcentaje: string | number | null;
  monto: string | number;
  provisional: boolean;
  estado: "devengada" | "pagada";
  pagada_en: string | null;
  nota: string | null;
  anula_id: string | null;
  cuentas_receptoras: { alias: string } | null;
  servicios: { nombre: string } | null;
  solicitudes: { id: string; folio: string | null; cliente_nombre: string } | null;
};

/**
 * Meses que tiene sentido mostrar: el en curso y los que tienen algún
 * movimiento. Un cierre aprobado donde no tuvo nada no aporta.
 */
export async function mesesDisponibles(personaId: string): Promise<string[]> {
  const supabase = await crearClienteServidor();
  const comisiones = oExplota(
    await supabase.from("comisiones").select("mes").eq("comisionista_id", personaId).returns<{ mes: string }[]>(),
    "los meses"
  );
  const meses = new Set<string>([mesActual(), ...(comisiones ?? []).map((f) => f.mes)]);
  return [...meses].sort().reverse();
}

/**
 * `staff`: quien mira es Administración (la ficha del comisionista). Lee
 * los pagos de la tabla; el comisionista los lee por `mis_pagos_comision`,
 * que no trae el origen.
 */
export async function estadoDelMes(personaId: string, mes: string, staff = false): Promise<MesDeCuenta> {
  const supabase = await crearClienteServidor();
  const [movs, cierre, nivel, pend] = await Promise.all([
    supabase
      .from("comisiones")
      .select(
        "id, tipo, base, porcentaje, monto, provisional, estado, pagada_en, nota, anula_id, cuentas_receptoras(alias), servicios(nombre), solicitudes(id, folio, cliente_nombre)"
      )
      .eq("comisionista_id", personaId)
      .eq("mes", mes)
      .order("creado_en")
      .returns<FilaMovimiento[]>(),
    supabase.from("cierres").select("estado").eq("mes", mes).maybeSingle().returns<{ estado: string } | null>(),
    supabase
      .from("niveles_mensuales")
      .select("porcentaje, promedio, meses_considerados, niveles(nombre)")
      .eq("comisionista_id", personaId)
      .eq("mes", mesSiguiente(mes))
      .maybeSingle()
      .returns<{ porcentaje: string | number; promedio: string | number; meses_considerados: number; niveles: { nombre: string } | null } | null>(),
    supabase
      .from("pendientes_comision")
      .select("id, monto, pagado, pagado_en, factura_ruta")
      .eq("comisionista_id", personaId)
      .eq("mes", mes)
      .maybeSingle()
      .returns<{ id: string; monto: string | number; pagado: string | number; pagado_en: string | null; factura_ruta: string | null } | null>(),
  ]);

  const filasMov = oExplota(movs, "los movimientos") ?? [];
  const anulados = new Set(filasMov.map((f) => f.anula_id).filter(Boolean));
  const movimientos: Movimiento[] = filasMov.map((f) => ({
    id: f.id,
    tipo: f.tipo,
    base: f.base === null ? null : Number(f.base),
    porcentaje: f.porcentaje === null ? null : Number(f.porcentaje),
    monto: Number(f.monto),
    provisional: f.provisional,
    estado: f.estado,
    pagada_en: f.pagada_en,
    nota: f.nota,
    trabajo: f.solicitudes ? { id: f.solicitudes.id, folio: f.solicitudes.folio, cliente: f.solicitudes.cliente_nombre } : null,
    entidad: f.tipo === "arrastre" ? "Saldo arrastrado" : (f.cuentas_receptoras?.alias ?? "Sin cuenta"),
    servicio: f.servicios?.nombre ?? null,
    anula_id: f.anula_id,
    anulado: anulados.has(f.id),
  }));

  const entidades = new Map<string, number>();
  for (const m of movimientos) entidades.set(m.entidad, (entidades.get(m.entidad) ?? 0) + m.monto);

  const p = oExplota(pend, "el pendiente de pago");
  const pendiente: Pendiente | null = p
    ? {
        id: p.id,
        monto: Number(p.monto),
        pagado: Number(p.pagado),
        pagado_en: p.pagado_en,
        factura_ruta: p.factura_ruta,
        pagos: await pagosDelPendiente(p.id, staff),
      }
    : null;
  const n = oExplota(nivel, "el nivel");

  return {
    mes,
    publicado: oExplota(cierre, "el cierre")?.estado === "aprobado",
    movimientos,
    porEntidad: [...entidades].map(([entidad, t]) => ({ entidad, total: t })),
    total: movimientos.reduce((s, m) => s + m.monto, 0),
    pendiente,
    nivelSiguiente: n
      ? { nombre: n.niveles?.nombre ?? "", porcentaje: Number(n.porcentaje), promedio: Number(n.promedio), meses: n.meses_considerados }
      : null,
  };
}

async function pagosDelPendiente(pendienteId: string, staff: boolean): Promise<PagoRecibido[]> {
  const supabase = await crearClienteServidor();
  if (staff) {
    const filas = oExplota(
      await supabase
        .from("aplicaciones_pago_comision")
        .select("monto, pagos_comision(fecha, referencia, estado)")
        .eq("pendiente_id", pendienteId)
        .returns<{ monto: string | number; pagos_comision: { fecha: string; referencia: string | null; estado: string } | null }[]>(),
      "los pagos"
    );
    // Un pago anulado ya no cubre nada (el comisionista tampoco lo ve).
    return (filas ?? [])
      .filter((f) => f.pagos_comision?.estado === "registrado")
      .map((f) => ({ fecha: f.pagos_comision?.fecha ?? "", referencia: f.pagos_comision?.referencia ?? null, monto: Number(f.monto) }))
      .sort((a, b) => a.fecha.localeCompare(b.fecha));
  }
  const filas = oExplota(await supabase.rpc("mis_pagos_comision"), "tus pagos") as
    | { pendiente_id: string; fecha: string; referencia: string | null; monto: string | number }[]
    | null;
  return (filas ?? [])
    .filter((f) => f.pendiente_id === pendienteId)
    .map((f) => ({ fecha: f.fecha, referencia: f.referencia, monto: Number(f.monto) }));
}
