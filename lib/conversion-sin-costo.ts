/**
 * "Sin costo → conversión": de los trabajos sin costo (p. ej. el valor hacendario de un convenio),
 * cuántos terminaron con su trabajo ligado contratado y por cuánto, y cuántos llevan más de 30
 * días sin él. Solo lectura: el sin costo nunca se cobra, se contrate o no lo ligado.
 */

export type FilaSinCosto = {
  aceptada_en: string;
  convenio: string | null;
  comisionista: string | null;
  /** El trabajo ligado, si hay. Cuenta como contratado si ya es trabajo (estado "tramite"). */
  ligada: { estado: string; monto_honorarios: number | null } | null;
};

export type Conversion = {
  clave: string;
  sinCosto: number;
  convertidos: number;
  /** Honorarios de los trabajos ligados contratados. */
  monto: number;
  /** Más de 30 días desde que se aceptó, sin trabajo ligado contratado. */
  sinLigar30: number;
};

export const DIAS_SIN_LIGAR = 30;

const contratado = (f: FilaSinCosto) => f.ligada?.estado === "tramite";

function sumar(filas: FilaSinCosto[], clave: string, hoy: Date): Conversion {
  const limite = hoy.getTime() - DIAS_SIN_LIGAR * 86_400_000;
  const convertidos = filas.filter(contratado);
  return {
    clave,
    sinCosto: filas.length,
    convertidos: convertidos.length,
    monto: convertidos.reduce((s, f) => s + Number(f.ligada?.monto_honorarios ?? 0), 0),
    sinLigar30: filas.filter((f) => !contratado(f) && Date.parse(f.aceptada_en) < limite).length,
  };
}

function agrupar(filas: FilaSinCosto[], de: (f: FilaSinCosto) => string, hoy: Date): Conversion[] {
  const grupos = new Map<string, FilaSinCosto[]>();
  for (const f of filas) grupos.set(de(f), [...(grupos.get(de(f)) ?? []), f]);
  return [...grupos].map(([clave, g]) => sumar(g, clave, hoy)).sort((a, b) => b.sinCosto - a.sinCosto || a.clave.localeCompare(b.clave, "es"));
}

export function conversionSinCosto(filas: FilaSinCosto[], hoy = new Date()) {
  return {
    total: sumar(filas, "Total", hoy),
    porConvenio: agrupar(filas, (f) => f.convenio ?? "Sin convenio", hoy),
    porComisionista: agrupar(filas, (f) => f.comisionista ?? "Liga de equipo u organización", hoy),
  };
}
