import type { Tono } from "@/components/etiqueta";

/**
 * Lo que el comisionista ve de cada estatus. Mismo orden que
 * `estatus_publicos()` en la base.
 */
export type EstatusPublico =
  | "solicitada"
  | "cotizada"
  | "aceptada"
  | "visita_agendada"
  | "en_elaboracion"
  | "en_revision"
  | "entregado"
  | "pagado"
  | "vencida"
  | "cancelada";

const ESTATUS: Record<EstatusPublico, { texto: string; tono: Tono }> = {
  solicitada: { texto: "Solicitada", tono: "neutro" },
  cotizada: { texto: "Cotizada", tono: "neutro" },
  aceptada: { texto: "Aceptada", tono: "proceso" },
  visita_agendada: { texto: "Visita agendada", tono: "proceso" },
  en_elaboracion: { texto: "En elaboración", tono: "proceso" },
  en_revision: { texto: "En revisión", tono: "proceso" },
  entregado: { texto: "Entregado", tono: "neutro" },
  pagado: { texto: "Pagado", tono: "exito" },
  vencida: { texto: "Vencida", tono: "error" },
  cancelada: { texto: "Cancelada", tono: "error" },
};

/**
 * Sin folio todavía, "aceptada" se dice "Aceptada – folio en asignación":
 * la página de Notion existe pero el folio lo pone el proceso de siempre.
 */
export function estatusVisible(estatus: EstatusPublico, folio: string | null) {
  const e = ESTATUS[estatus];
  if (estatus === "aceptada" && !folio) {
    return { ...e, texto: "Aceptada – folio en asignación" };
  }
  return e;
}

/** Ya no se mueve: no cuenta como "en curso". */
export const ESTATUS_CERRADOS: EstatusPublico[] = ["pagado", "vencida", "cancelada"];

export type EstadoPago = "reportado" | "confirmado" | "rechazado";

export const ESTADO_PAGO: Record<EstadoPago, { texto: string; tono: Tono }> = {
  reportado: { texto: "Por confirmar", tono: "proceso" },
  confirmado: { texto: "Confirmado", tono: "exito" },
  rechazado: { texto: "Rechazado", tono: "error" },
};

export const VIA_PAGO: Record<"comprobante" | "directo" | "aviso", string> = {
  comprobante: "Comprobante",
  directo: "Registrado por Administración",
  aviso: "Aviso sin archivo",
};
