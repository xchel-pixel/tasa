import { crearClienteServidor, oExplota } from "@/lib/supabase/server";
import { mesActual } from "@/lib/formato";

/**
 * Lecturas del panel. El staff ve todo por RLS; aquí no se filtra por
 * persona. Toda lectura pasa por `oExplota`: una bandeja vacía tiene
 * que significar "no hay nada", nunca "la consulta falló".
 */

export type Pendientes = {
  pagos: number;
  solicitudes: number;
  /** De esas, las que llegaron por la liga de un cliente. */
  deLiga: number;
  alertas: number;
  /** Solicitudes de alta por aprobar (admin_marca no las ve: cero). */
  altas: number;
  /** El último mes terminado y en qué va su cierre. */
  cierre: { mes: string; estado: "sin_preparar" | "preparado" | "aprobado" };
};

export function mesAnterior(mes: string): string {
  const [a, m] = [Number(mes.slice(0, 4)), Number(mes.slice(5, 7))];
  return m === 1 ? `${a - 1}-12-01` : `${a}-${String(m - 1).padStart(2, "0")}-01`;
}

export async function pendientesDelPanel(): Promise<Pendientes> {
  const supabase = await crearClienteServidor();
  const anterior = mesAnterior(mesActual());
  const [pagos, solicitudes, deLiga, alertas, altas, cierre] = await Promise.all([
    supabase.from("pagos").select("id", { count: "exact", head: true }).eq("estado", "reportado"),
    supabase.from("solicitudes").select("id", { count: "exact", head: true }).eq("estado", "solicitada"),
    supabase.from("solicitudes").select("id", { count: "exact", head: true }).eq("estado", "solicitada").eq("origen", "liga_cliente"),
    supabase.from("alertas").select("id", { count: "exact", head: true }).is("resuelta_en", null),
    supabase.from("solicitudes_alta").select("id", { count: "exact", head: true }).eq("estado", "pendiente"),
    supabase.from("cierres").select("estado").eq("mes", anterior).maybeSingle().returns<{ estado: "preparado" | "aprobado" } | null>(),
  ]);
  for (const [r, que] of [[pagos, "los pagos"], [solicitudes, "las solicitudes"], [deLiga, "las solicitudes de clientes"], [alertas, "las alertas"], [altas, "las solicitudes de alta"]] as const) {
    if (r.error) oExplota(r, que);
  }
  return {
    pagos: pagos.count ?? 0,
    solicitudes: solicitudes.count ?? 0,
    deLiga: deLiga.count ?? 0,
    alertas: alertas.count ?? 0,
    altas: altas.count ?? 0,
    cierre: { mes: anterior, estado: oExplota(cierre, "el cierre")?.estado ?? "sin_preparar" },
  };
}
