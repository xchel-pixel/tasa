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

const ZONA = "America/Mexico_City";

/**
 * "2026-10-02" → "2 oct 2026". Una fecha sin hora se arma con sus
 * partes: `new Date("2026-10-02")` la toma como medianoche en UTC, que
 * en México todavía es el día 1.
 */
export function fechaCorta(valor: string): string {
  const soloFecha = /^\d{4}-\d{2}-\d{2}$/.test(valor);
  const fecha = soloFecha
    ? new Date(Number(valor.slice(0, 4)), Number(valor.slice(5, 7)) - 1, Number(valor.slice(8, 10)))
    : new Date(valor);
  return fecha
    .toLocaleDateString("es-MX", {
      day: "numeric",
      month: "short",
      year: "numeric",
      ...(soloFecha ? {} : { timeZone: ZONA }),
    })
    .replace(".", "");
}

/** "2026-10-01" → "octubre 2026". */
export function mesLargo(valor: string): string {
  const fecha = new Date(Number(valor.slice(0, 4)), Number(valor.slice(5, 7)) - 1, 1);
  return fecha.toLocaleDateString("es-MX", { month: "long", year: "numeric" });
}

/** El primer día del mes en curso en hora de México, "AAAA-MM-01". */
export function mesActual(): string {
  const partes = new Intl.DateTimeFormat("en-CA", { timeZone: ZONA, year: "numeric", month: "2-digit" })
    .format(new Date());
  return `${partes}-01`;
}

/** "2026-10-01" → "2026-11-01". */
export function mesSiguiente(mes: string): string {
  const [a, m] = [Number(mes.slice(0, 4)), Number(mes.slice(5, 7))];
  return m === 12 ? `${a + 1}-01-01` : `${a}-${String(m + 1).padStart(2, "0")}-01`;
}

/** "13:05" → "1:05 pm". */
export function horaCorta(hora: string): string {
  const [h, m] = hora.split(":").map(Number);
  const tarde = h >= 12;
  const doce = h % 12 === 0 ? 12 : h % 12;
  return `${doce}:${String(m).padStart(2, "0")} ${tarde ? "pm" : "am"}`;
}
