import type { CalculoGuardado } from "./servidor";

/**
 * Lo que lleva la solicitud del avalúo cuando se encarga desde la calculadora: servicio, municipio, clave
 * y, en la descripción, todo lo demás que se capturó (referencia, operación, valores, extemporáneo, firma) con
 * el resumen del cálculo. Sin datos del cliente: esos se capturan en la solicitud.
 */

export type Prellenado = { servicio: "hacendario" | "comercial"; municipio: string; clave: string; descripcion: string };

const pesos = (x: number) => x.toLocaleString("es-MX", { style: "currency", currency: "MXN", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fecha = (f: string) => f.slice(0, 10).split("-").reverse().join("/");
const OPERACION: Record<string, string> = { compraventa: "compraventa", donacion: "donación", herencia: "herencia (adjudicación)" };

export function prellenadoDesdeCalculo(c: Pick<CalculoGuardado, "referencia" | "entrada" | "resultado">, servicio: string): Prellenado {
  const e = c.entrada, r = c.resultado;
  const parte = r.lado === "C" ? "comprador" : r.lado === "V" ? "vendedor" : "comprador y vendedor";
  const total = r.lado === "C" ? r.totC : r.lado === "V" ? r.totV : r.totC + r.totV;
  const lineas = [
    `Desde calculadora de traslado: ${parte}, total estimado ${pesos(total)}${r.lado === "AMBOS" ? ` (comprador ${pesos(r.totC)} · vendedor ${pesos(r.totV)})` : ""}`,
    c.referencia ? `Referencia: ${c.referencia}` : null,
    `Operación: ${OPERACION[e.operacion ?? "compraventa"] ?? e.operacion}${e.operacion === "donacion" && e.donacion_exenta ? " entre cónyuges o línea recta" : ""}`,
    e.valor_operacion ? `Valor de operación: ${pesos(Number(e.valor_operacion))}` : null,
    e.avaluo ? `Avalúo o valor de referencia: ${pesos(Number(e.avaluo))}` : null,
    e.valor_catastral ? `Valor catastral: ${pesos(Number(e.valor_catastral))}` : null,
    e.extemporaneo ? `Extemporáneo: operación original del ${fecha(e.extemporaneo.fecha_operacion)} (se necesita avalúo referido a esa fecha)` : null,
    e.comprador?.vivienda_primera ? `Primera vivienda de interés ${e.comprador.vivienda_primera}` : null,
    `Firma estimada: ${fecha(e.fecha_firma)}`,
  ];
  return {
    servicio: servicio === "comercial" ? "comercial" : "hacendario",
    municipio: r.municipio,
    clave: e.clave_catastral ?? "",
    descripcion: lineas.filter(Boolean).join("\n"),
  };
}
