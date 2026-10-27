import { crearClienteServidor, oExplota } from "@/lib/supabase/server";
import { mesActual, mesSiguiente } from "@/lib/formato";

/**
 * El estado de cuenta es la lectura de `comisiones` por mes. Un mes con
 * cierre aprobado está publicado y ya no cambia; el mes abierto se
 * muestra "en curso" porque todavía puede moverse.
 */

export type TipoMovimiento = "comision" | "bono" | "ajuste" | "cargo" | "referido";

export const TIPO_MOVIMIENTO: Record<TipoMovimiento, string> = {
  comision: "Comisión",
  bono: "Bono",
  ajuste: "Ajuste",
  cargo: "Cargo",
  referido: "Referido",
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
  /** Alias de la cuenta que recibió el dinero del trabajo (etiqueta, no el titular). */
  entidad: string;
};

export type MesDeCuenta = {
  mes: string;
  publicado: boolean;
  movimientos: Movimiento[];
  porEntidad: { entidad: string; total: number }[];
  total: number;
  pagado: number;
  porPagar: number;
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
  solicitudes: {
    id: string;
    folio: string | null;
    cliente_nombre: string;
    cuentas_receptoras: { alias: string } | null;
  } | null;
};

/**
 * Meses que tiene sentido mostrar: el en curso y los que tienen algún
 * movimiento suyo. Un cierre aprobado donde no tuvo nada no aporta.
 */
export async function mesesDisponibles(): Promise<string[]> {
  const supabase = await crearClienteServidor();
  const comisiones = oExplota(
    await supabase.from("comisiones").select("mes").returns<{ mes: string }[]>(),
    "tus meses"
  );
  const meses = new Set<string>([mesActual(), ...(comisiones ?? []).map((f) => f.mes)]);
  return [...meses].sort().reverse();
}

export async function estadoDelMes(personaId: string, mes: string): Promise<MesDeCuenta> {
  const supabase = await crearClienteServidor();
  const [movs, cierre, nivel] = await Promise.all([
    supabase
      .from("comisiones")
      .select(
        "id, tipo, base, porcentaje, monto, provisional, estado, pagada_en, nota, solicitudes(id, folio, cliente_nombre, cuentas_receptoras(alias))"
      )
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
  ]);

  const movimientos: Movimiento[] = (oExplota(movs, "tus movimientos") ?? []).map((f) => ({
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
    entidad: f.solicitudes?.cuentas_receptoras?.alias ?? "Sin cuenta",
  }));

  const entidades = new Map<string, number>();
  for (const m of movimientos) entidades.set(m.entidad, (entidades.get(m.entidad) ?? 0) + m.monto);

  const total = movimientos.reduce((s, m) => s + m.monto, 0);
  const pagado = movimientos.filter((m) => m.estado === "pagada").reduce((s, m) => s + m.monto, 0);
  const n = oExplota(nivel, "tu nivel");

  return {
    mes,
    publicado: oExplota(cierre, "el cierre")?.estado === "aprobado",
    movimientos,
    porEntidad: [...entidades].map(([entidad, t]) => ({ entidad, total: t })),
    total,
    pagado,
    porPagar: total - pagado,
    nivelSiguiente: n
      ? { nombre: n.niveles?.nombre ?? "", porcentaje: Number(n.porcentaje), promedio: Number(n.promedio), meses: n.meses_considerados }
      : null,
  };
}
