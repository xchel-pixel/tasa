/**
 * Textos que usan tanto la página (servidor) como los formularios (cliente). Van aquí y no en
 * un archivo "use client": una función de un archivo de cliente no se puede llamar desde el
 * servidor, y la página truena en cuanto hay algo que pintar.
 */

/** "Comisión normal", "Sin comisión" o "Comisión fija 10%". */
export function textoComision(c: { comision_regla: "normal" | "ninguna" | "fija"; comision_pct: number | null }) {
  return c.comision_regla === "ninguna" ? "Sin comisión" : c.comision_regla === "fija" ? `Comisión fija ${c.comision_pct}%` : "Comisión normal";
}
