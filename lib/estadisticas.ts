import { municipioPorClave } from "@/lib/traslado/calculo";
import { NOMBRE_HERRAMIENTA } from "@/lib/uso";

/**
 * Estadísticas (0073): filtros, tipos y las tablas que comparten la pantalla y el CSV. Todo sale de estadisticas()
 * en la base, sin lo de humo. Nada de propietarios: claves, colonias, conteos y nombres de comisionistas.
 */

export type Filtros = { desde: string; hasta: string; persona: string | null; nivel: string | null; herramienta: string | null };

export const HERRAMIENTAS_FILTRO = ["mapa_catastral", "mapa_catastral_pdf", "mapa_catastral_dxf", "calculadora_traslado",
  "calculadora_traslado_completa"] as const;

const esFecha = (s: string | undefined) => Boolean(s && s.length === 10 && !Number.isNaN(Date.parse(`${s}T12:00:00Z`)));
const esId = (s: string | undefined) => Boolean(s && s.length === 36 && s.split("-").length === 5);

/** Hoy en México, AAAA-MM-DD. */
export function hoyMx(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City" }).format(new Date());
}

/** Hace n días en México, AAAA-MM-DD. */
export function haceDiasMx(n: number): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City" }).format(new Date(Date.now() - n * 86_400_000));
}

/** Los filtros de la dirección; por omisión, el mes en curso. */
export function filtrosDe(q: Record<string, string | undefined>): Filtros {
  const hoy = hoyMx();
  const desde = esFecha(q.desde) ? q.desde! : `${hoy.slice(0, 8)}01`;
  const hasta = esFecha(q.hasta) ? q.hasta! : hoy;
  return {
    desde: desde <= hasta ? desde : hasta,
    hasta,
    persona: esId(q.persona) ? q.persona! : null,
    nivel: esId(q.nivel) ? q.nivel! : null,
    herramienta: (HERRAMIENTAS_FILTRO as readonly string[]).includes(q.herramienta ?? "") ? q.herramienta! : null,
  };
}

export const parametros = (f: Filtros) => ({
  p_desde: f.desde, p_hasta: f.hasta, p_persona: f.persona, p_nivel: f.nivel, p_herramienta: f.herramienta,
});

export function queryDe(f: Filtros, extra: Record<string, string> = {}): string {
  const p = new URLSearchParams({ desde: f.desde, hasta: f.hasta, ...extra });
  if (f.persona) p.set("persona", f.persona);
  if (f.nivel) p.set("nivel", f.nivel);
  if (f.herramienta) p.set("herramienta", f.herramienta);
  return p.toString();
}

type CupoStat = { usados: number; limite: number | null; extras: number | null };
export type Estadisticas = {
  periodo: { desde: string; hasta: string; un_mes: boolean };
  uso: Record<"fuente" | "guardado" | "fallas" | "pdf" | "pdf_nuevos" | "dxf" | "dxf_nuevos" | "calculo_rapida" | "calculo_completa" | "denegaciones" | "accesos", number>;
  personas: { persona_id: string; nombre: string; rol: string; nivel: string | null; total: number; cupos: Record<string, CupoStat> | null; pidio_mas: number; denegaciones: number }[];
  embudo: { persona_id: string; nombre: string; mapa_consultas: number; mapa_solicitudes: number; mapa_tramites: number; calc_calculos: number;
    calc_solicitudes: number; calc_tramites: number }[];
  zonas: { municipio: string; ejemplo: string; colonia: string; consultas: number; predios: number; personas: number }[];
  salud: { dia: string; consultas: number; fallas: number; ms_promedio: number | null }[];
};

const pct = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 100)} %` : "—");

/** "12 de 40 (30 %)", "12 · sin límite" o solo "12" si el periodo no es un mes. */
export function textoCupoStat(c: CupoStat, unMes: boolean): string {
  if (!unMes) return String(c.usados);
  if (c.limite === null) return `${c.usados} · sin límite`;
  const total = c.limite + (c.extras ?? 0);
  return `${c.usados} de ${total} (${pct(c.usados, total)})`;
}

export function agoto(c: CupoStat): boolean {
  return c.limite !== null && c.usados >= c.limite + (c.extras ?? 0);
}

export type Tabla = { titulo: string; columnas: string[]; filas: (string | number)[][] };

export type ActividadComisionista = { persona_id: string; nombre: string; estado: "activa" | "por_vencer" | "inactiva"; ultima_actividad: string;
  vence: string | null; inactiva_desde: string | null; paquete: boolean };

const fechaMx = (t: string | null) => (t ? new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City" }).format(new Date(t)) : "—");
const ESTADO_ACTIVIDAD = { activa: "Al corriente", por_vencer: "Por inactivarse", inactiva: "Inactiva" } as const;

export type EstadisticasCredito = {
  ventas: { paquete: string; vendidos: number; cobrado: number | string; con_comision: number; credito: number | string }[];
  consumo: { aplicado: number | string; devuelto: number | string; vencido: number | string; trabajos: number };
  saldo_vigente: number | string;
};

const dinero = (x: number | string) => Number(x).toLocaleString("es-MX", { style: "currency", currency: "MXN" });

/** Ventas de paquetes y consumo de crédito (0077), del periodo. */
export function tablasCredito(c: EstadisticasCredito): { ventas: Tabla; credito: Tabla } {
  return {
    ventas: {
      titulo: "Ventas de paquetes",
      columnas: ["Paquete", "Vendidos", "Con comisión", "Cobrado (IVA incluido)", "Crédito otorgado"],
      filas: c.ventas.map((v) => [v.paquete, v.vendidos, v.con_comision, dinero(v.cobrado), dinero(v.credito)]),
    },
    credito: {
      titulo: "Consumo de crédito",
      columnas: ["Concepto", "Monto"],
      filas: [
        ["Aplicado a trabajos", dinero(c.consumo.aplicado)],
        ["Trabajos pagados con crédito", c.consumo.trabajos],
        ["Devuelto por cancelación", dinero(c.consumo.devuelto)],
        ["Vencido sin renovar", dinero(c.consumo.vencido)],
        ["Saldo vigente hoy", dinero(c.saldo_vigente)],
      ],
    },
  };
}

/** Actividad de comisionistas (0075): no depende del periodo, es la foto de hoy. */
export function tablaActividad(a: ActividadComisionista[]): Tabla {
  return {
    titulo: "Actividad de comisionistas (hoy)",
    columnas: ["Comisionista", "Estado", "Último trabajo cobrado o alta", "Pasaría a inactiva", "Inactiva desde"],
    filas: a.map((x) => [x.nombre, x.paquete ? "Al corriente (paquete vigente)" : ESTADO_ACTIVIDAD[x.estado], fechaMx(x.ultima_actividad),
      x.estado === "inactiva" ? "—" : fechaMx(x.vence), fechaMx(x.inactiva_desde)]),
  };
}

/** Las cinco tablas, listas para pantalla o CSV. */
export function tablas(e: Estadisticas): Record<"uso" | "personas" | "embudo" | "zonas" | "salud", Tabla> {
  const u = e.uso;
  const consultas = u.fuente + u.guardado;
  const herramientas = Object.keys(e.personas[0]?.cupos ?? {});
  return {
    uso: {
      titulo: "Uso del periodo",
      columnas: ["Concepto", "Cantidad"],
      filas: [
        ["Consultas a la fuente", u.fuente],
        ["Consultas desde lo guardado (reuso)", u.guardado],
        ["Ahorro por reuso", pct(u.guardado, consultas)],
        ["Fallas de la fuente", u.fallas],
        ["PDF (nuevos)", `${u.pdf} (${u.pdf_nuevos})`],
        ["DXF (nuevos)", `${u.dxf} (${u.dxf_nuevos})`],
        ["Cálculos rápida", u.calculo_rapida],
        ["Cálculos completa", u.calculo_completa],
        ["Denegaciones", u.denegaciones],
        ["Accesos", u.accesos],
      ],
    },
    personas: {
      titulo: "Por persona y nivel",
      columnas: ["Persona", "Nivel", ...herramientas.map((h) => NOMBRE_HERRAMIENTA[h] ?? h), "Agotó", "Pidió más", "Denegaciones"],
      filas: e.personas.map((p) => [
        p.nombre, p.nivel ?? (p.rol === "equipo" ? "Equipo" : "—"),
        ...herramientas.map((h) => (p.cupos?.[h] ? textoCupoStat(p.cupos[h], e.periodo.un_mes) : "—")),
        Object.entries(p.cupos ?? {}).filter(([, c]) => agoto(c)).map(([h]) => NOMBRE_HERRAMIENTA[h] ?? h).join(", ") || "—",
        p.pidio_mas, p.denegaciones,
      ]),
    },
    embudo: {
      titulo: "Embudo por comisionista",
      columnas: ["Comisionista", "Consultas del mapa", "Solicitudes del mapa", "Trámites del mapa", "Cálculos", "Solicitudes de la calculadora",
        "Trámites de la calculadora"],
      filas: e.embudo.map((x) => [x.nombre, x.mapa_consultas, x.mapa_solicitudes, x.mapa_tramites, x.calc_calculos, x.calc_solicitudes, x.calc_tramites]),
    },
    zonas: {
      titulo: "Por municipio y colonia",
      columnas: ["Municipio", "Colonia", "Consultas", "Predios distintos", "Personas"],
      filas: e.zonas.map((z) => [municipioPorClave(z.ejemplo) ?? z.municipio, z.colonia, z.consultas, z.predios, z.personas]),
    },
    salud: {
      titulo: "Salud de la fuente",
      columnas: ["Día", "Consultas", "Fallas", "% fallas", "Tiempo promedio"],
      filas: e.salud.map((d) => [d.dia, d.consultas, d.fallas, pct(d.fallas, d.consultas), d.ms_promedio === null ? "—" : `${(d.ms_promedio / 1000).toFixed(1)} s`]),
    },
  };
}

/** CSV para Excel: UTF-8 con BOM, comas y comillas dobles. */
export function csv(t: Tabla): string {
  const celda = (v: string | number) => {
    const s = String(v);
    return s.includes(",") || s.includes('"') || s.includes("\n") ? `"${s.replaceAll('"', '""')}"` : s;
  };
  return "﻿" + [t.columnas, ...t.filas].map((fila) => fila.map(celda).join(",")).join("\r\n") + "\r\n";
}
