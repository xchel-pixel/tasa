import { crearClienteServidor, oExplota } from "@/lib/supabase/server";

/** Lo que falta por pagar, según `comisiones_por_pagar()` (solo el staff lo lee). */
export type PorPagar = {
  pendiente_id: string;
  comisionista_id: string;
  comisionista: string;
  mes: string;
  monto: number;
  pagado: number;
  saldo: number;
  vence_en: string;
  vencido: boolean;
  esperando_factura: boolean;
};

export async function comisionesPorPagar(): Promise<PorPagar[]> {
  const supabase = await crearClienteServidor();
  const filas = (oExplota(await supabase.rpc("comisiones_por_pagar"), "las comisiones por pagar") ?? []) as Record<string, unknown>[];
  return filas.map((f) => ({
    pendiente_id: String(f.pendiente_id),
    comisionista_id: String(f.comisionista_id),
    comisionista: String(f.comisionista),
    mes: String(f.mes),
    monto: Number(f.monto),
    pagado: Number(f.pagado),
    saldo: Number(f.saldo),
    vence_en: String(f.vence_en),
    vencido: Boolean(f.vencido),
    esperando_factura: Boolean(f.esperando_factura),
  }));
}

/**
 * Desglose de un mes de un comisionista por empresa y por servicio (para
 * ver qué cubre un pago). El arrastre no es de ninguna empresa.
 */
export async function desgloseDelMes(comisionistaId: string, meses: string[]) {
  const supabase = await crearClienteServidor();
  const filas =
    oExplota(
      await supabase
        .from("comisiones")
        .select("mes, tipo, monto, cuentas_receptoras(alias), servicios(nombre)")
        .eq("comisionista_id", comisionistaId)
        .in("mes", meses)
        .returns<{ mes: string; tipo: string; monto: string | number; cuentas_receptoras: { alias: string } | null; servicios: { nombre: string } | null }[]>(),
      "el desglose"
    ) ?? [];
  const porMes = new Map<string, Map<string, number>>();
  for (const f of filas) {
    const clave =
      f.tipo === "arrastre"
        ? "Saldo arrastrado"
        : `${f.cuentas_receptoras?.alias ?? "Sin empresa"} · ${f.servicios?.nombre ?? "Sin servicio"}`;
    const m = porMes.get(f.mes) ?? new Map<string, number>();
    m.set(clave, (m.get(clave) ?? 0) + Number(f.monto));
    porMes.set(f.mes, m);
  }
  return porMes;
}
