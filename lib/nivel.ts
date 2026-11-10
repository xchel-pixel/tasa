/**
 * El avance de nivel (0081) y sus tres frases. Lo usan la portada, el panel y el estado de cuenta del comisionista, y
 * su ficha en administración: el mismo texto en todas partes. Nunca se mezcla el nivel actual con el proyectado en la
 * misma frase.
 */

export type MiNivel = {
  actual: { nombre: string; porcentaje: number; forzado: boolean; provisional: boolean };
  especial: { tipo: "elite" | "bienvenida" | "arranque" | "escalon"; hasta: string | null } | null;
  proyectado: { nombre: string; porcentaje: number; promedio: number; meses: number };
  objetivo: { tipo: "mantener" | "subir"; nombre: string; porcentaje: number; umbral: number; falta: number } | null;
  comision_mes: number;
  comision_provisional: boolean;
};

type Crudo = {
  actual: { nombre: string; porcentaje: number | string; forzado: boolean; provisional: boolean };
  especial: { tipo: MiNivel["especial"] extends infer E ? (E extends { tipo: infer T } ? T : never) : never; hasta?: string | null } | null;
  proyectado: { nombre: string; porcentaje: number | string | null; promedio: number | string; meses: number };
  objetivo: { tipo: "mantener" | "subir"; nombre: string; porcentaje: number | string; umbral: number | string; falta: number | string } | null;
  comision_mes: number | string;
  comision_provisional: boolean;
} | null;

export function normalizarAvance(d: unknown): MiNivel {
  const c = d as Crudo;
  return {
    actual: { nombre: c?.actual.nombre ?? "—", porcentaje: Number(c?.actual.porcentaje ?? 0), forzado: Boolean(c?.actual.forzado),
      provisional: Boolean(c?.actual.provisional) },
    especial: c?.especial ? { tipo: c.especial.tipo, hasta: c.especial.hasta ?? null } : null,
    proyectado: { nombre: c?.proyectado.nombre ?? "—", porcentaje: Number(c?.proyectado.porcentaje ?? 0), promedio: Number(c?.proyectado.promedio ?? 0),
      meses: Number(c?.proyectado.meses ?? 0) },
    objetivo: c?.objetivo ? { tipo: c.objetivo.tipo, nombre: c.objetivo.nombre, porcentaje: Number(c.objetivo.porcentaje),
      umbral: Number(c.objetivo.umbral), falta: Number(c.objetivo.falta) } : null,
    comision_mes: Number(c?.comision_mes ?? 0),
    comision_provisional: Boolean(c?.comision_provisional),
  };
}

const dma = (iso: string) => iso.slice(0, 10).split("-").reverse().join("/");
const pct = (n: number) => `${Number(n.toFixed(2))}%`;
const dinero = (n: number) => n.toLocaleString("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 });

/** Las tres frases, en orden: este mes, el próximo mes, lo que falta. */
export function frasesDeNivel(n: MiNivel): { esteMes: string; especial: string | null; proximo: string; falta: string } {
  const especial = !n.especial ? null
    : n.especial.tipo === "elite" ? `Tasa Élite${n.especial.hasta ? ` hasta el ${dma(n.especial.hasta)}` : ""}.`
    : n.especial.tipo === "bienvenida" ? `Tasa de bienvenida hasta el ${dma(n.especial.hasta ?? "")}.`
    : n.especial.tipo === "arranque" ? `Tasa de arranque hasta el ${dma(n.especial.hasta ?? "")}.`
    : "Terminó la bienvenida: el nivel baja uno por cierre hasta el que da el promedio.";
  return {
    esteMes: `Este mes cobras ${pct(n.actual.porcentaje)} (${n.actual.nombre}${n.actual.provisional ? ", provisional" : ""}).`,
    especial,
    proximo: `Con tu promedio actual, el próximo mes serías ${n.proyectado.nombre} (${pct(n.proyectado.porcentaje)}).`,
    falta: !n.objetivo
      ? n.actual.forzado ? "Tu tasa Élite no depende del promedio." : "Ya estás en el nivel más alto."
      : n.objetivo.tipo === "mantener"
        ? `Para mantener ${n.objetivo.nombre} te faltan ${dinero(n.objetivo.falta)} este mes.`
        : n.objetivo.falta > 0
          ? `Para subir a ${n.objetivo.nombre} te faltan ${dinero(n.objetivo.falta)} este mes.`
          : `Ya alcanzas ${n.objetivo.nombre} el próximo mes.`,
  };
}
