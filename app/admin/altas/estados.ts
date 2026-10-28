import type { Tono } from "@/components/etiqueta";

export type EstadoAltaSolicitud = "pendiente" | "aprobada" | "rechazada";

export const ESTADOS: Record<EstadoAltaSolicitud, { texto: string; tono: Tono }> = {
  pendiente: { texto: "Pendiente", tono: "proceso" },
  aprobada: { texto: "Aprobada", tono: "exito" },
  rechazada: { texto: "Rechazada", tono: "neutro" },
};
