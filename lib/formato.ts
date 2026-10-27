/**
 * Formato de pantalla. Sin dependencias: lo usan tanto los componentes
 * de servidor como los de cliente.
 */

export function pesos(monto: number): string {
  return monto.toLocaleString("es-MX", {
    style: "currency",
    currency: "MXN",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

/** "13:05" → "1:05 pm". */
export function horaCorta(hora: string): string {
  const [h, m] = hora.split(":").map(Number);
  const tarde = h >= 12;
  const doce = h % 12 === 0 ? 12 : h % 12;
  return `${doce}:${String(m).padStart(2, "0")} ${tarde ? "pm" : "am"}`;
}
