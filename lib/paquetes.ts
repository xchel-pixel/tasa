/**
 * Monedero de paquetes de crédito (0077): tipos y textos que comparten "Mis paquetes", la administración, el
 * trámite, Accesos y Estadísticas. Todo lo calcula la base; aquí solo se nombra.
 */

export type Paquete = {
  id: string; clave: string; nombre: string; precio: number; credito: number; meses: number; cupos: "socio" | "sin_limite";
  dxf_extra: number; entrega_prioritaria: boolean; insignia: string | null; beneficios: string; activo: boolean; orden: number;
};

export type Movimiento = {
  id: number; tipo: "carga" | "aplicacion" | "devolucion" | "vencimiento" | "traspaso"; monto: number; creado_en: string;
  nota: string | null; folio: string | null; cliente_nombre: string | null; paquete: string;
};

export type MisPaquetes = {
  saldo: number;
  vigente: { compra_id: string; paquete: string; clave: string; beneficios: string; inicia: string; vence: string; credito: number; saldo: number;
    puede_subir: boolean; subir_hasta: string } | null;
  catalogo: Paquete[];
  terminos: { version: number; texto: string } | null;
  cuenta: { alias: string | null; banco: string | null; clabe: string; titular: string } | null;
  por_pagar: { id: string; tipo: TipoCompra; paquete: string; precio: number; credito: number; creado_en: string } | null;
  comision_por_cobrar: number;
  por_vencer: { vence: string; saldo: number }[] | null;
  compras: { id: string; tipo: TipoCompra; forma_pago: "transferencia" | "comision"; paquete: string; precio: number; credito: number;
    estado: "por_pagar" | "confirmada" | "cancelada"; inicia: string | null; vence: string | null; creado_en: string; terminos_version: number;
    terminos_aceptados_en: string }[];
  movimientos: Movimiento[];
};

export type TipoCompra = "compra" | "renovacion" | "subida";

export type Lote = {
  id: string; persona: string; persona_id: string; paquete: string; forma_pago: "transferencia" | "comision"; inicia: string; vence: string;
  credito: number; pago_monto: number | null; folio_cfdi: string | null; saldo: number; consumido: number; vencido: number;
  estado: "vigente" | "por_vencer" | "consumido" | "vencido" | "renovado";
};

export type PaquetesAdmin = {
  por_confirmar: { id: string; persona: string; persona_id: string; tipo: TipoCompra; paquete: string; precio: number; credito: number; creado_en: string }[];
  lotes: Lote[];
  cuentas: { id: string; alias: string | null }[];
  cuenta_paquetes: string | null;
};

export const TIPO_COMPRA: Record<TipoCompra, string> = { compra: "Compra", renovacion: "Renovación", subida: "Subida de paquete" };

export const TIPO_MOVIMIENTO: Record<Movimiento["tipo"], string> = {
  carga: "Crédito cargado", aplicacion: "Aplicado a un trabajo", devolucion: "Devuelto (trabajo cancelado)", vencimiento: "Venció",
  traspaso: "Traspaso por renovación",
};

export const ESTADO_LOTE: Record<Lote["estado"], { texto: string; tono: "exito" | "proceso" | "error" | "neutro" }> = {
  vigente: { texto: "Vigente", tono: "exito" },
  por_vencer: { texto: "Por vencer", tono: "proceso" },
  consumido: { texto: "Consumido", tono: "neutro" },
  vencido: { texto: "Vencido", tono: "error" },
  renovado: { texto: "Renovado", tono: "neutro" },
};

/** "Trabajo MGP-2026-0012" o la nota, para un movimiento. */
export function detalleMovimiento(m: Movimiento): string {
  if (m.tipo === "aplicacion" || m.tipo === "devolucion") return `${m.folio ?? m.cliente_nombre ?? "Trabajo"}`;
  return m.nota ?? m.paquete;
}

/** Días que faltan para una fecha AAAA-MM-DD (hora de México). */
export function diasHasta(fecha: string, hoy: string): number {
  return Math.round((Date.parse(`${fecha}T12:00:00Z`) - Date.parse(`${hoy}T12:00:00Z`)) / 86_400_000);
}
