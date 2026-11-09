import { limpiarClave } from "@/lib/traslado/calculo";

/**
 * Lo que el Mapa catastral manda por la liga a la calculadora (?clave=&municipio=&valor_catastral=) y a la
 * nueva solicitud (?clave=&municipio=&direccion=&nota=), ya validado. Sin directiva: lo usan las páginas del
 * servidor y las pruebas.
 */

type Parametros = Record<string, string | undefined>;

/** Valores iniciales de la calculadora: clave, municipio (si tiene tarifa) y valor catastral total. */
export function inicialCalculadora(q: Parametros, municipios: string[]): Record<string, string> {
  const inicial: Record<string, string> = {};
  if (q.municipio && municipios.includes(q.municipio)) inicial.municipio = q.municipio;
  const clave = limpiarClave(q.clave ?? "");
  if (clave) inicial.clave_catastral = clave;
  const valor = Number(q.valor_catastral);
  if (q.valor_catastral && Number.isFinite(valor) && valor > 0 && valor < 1e12) inicial.valor_catastral = valor.toFixed(2);
  return inicial;
}

/** La solicitud que viene del mapa (sin datos del cliente), o nulo si no trae clave. */
export function inicialSolicitudDelMapa(q: Parametros) {
  const clave = limpiarClave(q.clave ?? "");
  if (!clave) return null;
  return {
    municipio: (q.municipio ?? "").slice(0, 60),
    clave,
    descripcion: (q.nota ?? "").slice(0, 800),
    direccion: (q.direccion ?? "").slice(0, 300),
    // Vino del botón "Cotizar avalúo" de la ficha: la solicitud se liga a la consulta (0070).
    desde: q.desde === "mapa" ? ("mapa" as const) : undefined,
  };
}
