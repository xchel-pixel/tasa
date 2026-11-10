/**
 * Cómo se leen los eventos de uso (0070) en Accesos y en "Mi uso": nombres de herramienta, del evento y del
 * motivo de una denegación. Sin directiva: lo usan pantallas del servidor y del navegador.
 */

export type EventoUso = {
  id: number;
  herramienta: string;
  evento: "consulta" | "pdf" | "dxf" | "calculo" | "acceso" | "denegado" | "cierre_limite";
  origen: "fuente" | "guardado" | null;
  clave: string | null;
  resultado: "ok" | "pendiente" | "sin_predio" | "falla" | "denegado";
  codigo: string | null;
  estado_http: number | null;
  consumio: boolean;
  duracion_ms: number | null;
  referencia: string | null;
  creado_en: string;
};

export const NOMBRE_HERRAMIENTA: Record<string, string> = {
  mapa_catastral: "Mapa catastral",
  mapa_catastral_pdf: "PDF del mapa",
  mapa_catastral_dxf: "DXF del mapa",
  mapa_catastral_mosaicos: "Capa de predios",
  calculadora_traslado: "Calculadora rápida",
  calculadora_traslado_completa: "Calculadora completa",
  acceso: "Acceso",
};

export const MOTIVO_DENEGACION: Record<string, string> = {
  sin_herramienta: "no la tiene",
  rol: "su rol no la tiene",
  demo: "en DEMO solo predios de ejemplo",
  sin_cupo: "sin cupo del mes",
  sin_saldo: "sin saldo",
  tope_dia: "tope de seguridad del día",
  limite_mosaicos: "límite de mosaicos por hora",
  no_autorizado: "sin autorización",
};

/** "Consulta del mapa (de la fuente, 1.2 s)", "Negado: PDF del mapa, sin cupo del mes (429)", "Acceso desde Chrome en Android"… */
export function textoEvento(e: EventoUso): string {
  const h = NOMBRE_HERRAMIENTA[e.herramienta] ?? e.herramienta;
  if (e.evento === "acceso") return `Entró${e.referencia ? ` desde ${e.referencia}` : ""}`;
  if (e.evento === "cierre_limite") return `Se cerró su sesión en ${e.referencia ?? "otro equipo"} por el límite de equipos`;
  if (e.evento === "denegado") return `Negado: ${h}, ${MOTIVO_DENEGACION[e.codigo ?? ""] ?? e.codigo ?? "sin motivo"}${e.estado_http ? ` (${e.estado_http})` : ""}`;
  if (e.evento === "consulta") {
    const origen = e.origen === "fuente" ? "de la fuente" : "de lo guardado";
    const resultado = e.resultado === "ok" ? "" : e.resultado === "pendiente" ? ", sin expediente" : e.resultado === "sin_predio" ? ", sin predio" : ", falló";
    const tiempo = e.duracion_ms !== null ? `, ${(e.duracion_ms / 1000).toFixed(1)} s` : "";
    return `Consulta del mapa (${origen}${resultado}${tiempo})`;
  }
  if (e.evento === "calculo") return h;
  return `${h}${e.consumio ? "" : " (repetido, no gastó)"}`;
}

/** "9 nov 2026, 18:42", en hora de México. */
export function fechaHora(iso: string): string {
  const d = new Date(iso);
  const fecha = d.toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric", timeZone: "America/Mexico_City" }).replace(".", "");
  const hora = d.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "America/Mexico_City" });
  return `${fecha}, ${hora}`;
}
