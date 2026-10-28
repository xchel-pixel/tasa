import { errorDeRfc, errorDeTelefono, limpiarRfc, limpiarTelefono } from "@/lib/limpiar";

/**
 * Lee la tabla de comisionistas que se pega desde Excel o Google Sheets
 * (columnas separadas por tabulador; también acepta coma o punto y coma).
 *
 * Columnas, en este orden: nombre, correo, teléfono, RFC, factura (sí/no),
 * porcentaje élite y tasa de bienvenida (sí/no, o el número de meses).
 * Solo nombre y correo son obligatorios. Si el primer
 * renglón trae "correo", se toma como encabezado y se salta.
 *
 * Es pura: la usan la vista previa (en el navegador) y la importación
 * (en el servidor), así las dos ven exactamente lo mismo.
 */

export type FilaImportada = {
  linea: number;
  nombre: string;
  correo: string;
  telefono: string;
  rfc: string;
  emite_factura: boolean;
  /** Porcentaje fijo (nivel Élite); nulo si no se forzó. */
  elite: number | null;
  bienvenida: boolean;
  /** Meses pedidos en la tabla; nulo = los de la organización. */
  mesesBienvenida: number | null;
  errores: string[];
};

const CORREO = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const SI = /^(s[ií]|si|x|1|true|factura|bienvenida)$/i;
export const MAXIMO_FILAS = 300;

function separador(linea: string): string | RegExp {
  if (linea.includes("\t")) return "\t";
  if (linea.includes(";")) return ";";
  return ",";
}

export function parsearTabla(texto: string): FilaImportada[] {
  const lineas = texto.replace(/\r/g, "").split("\n");
  const filas: FilaImportada[] = [];
  const vistos = new Set<string>();

  lineas.forEach((cruda, i) => {
    if (!cruda.trim()) return;
    const celdas = cruda.split(separador(cruda)).map((c) => c.trim().replace(/^"|"$/g, ""));
    if (filas.length === 0 && i === lineas.findIndex((l) => l.trim()) && celdas.some((c) => /correo|e-?mail/i.test(c))) return;

    const [nombre = "", correoCrudo = "", telefonoCrudo = "", rfcCrudo = "", facturaCruda = "", eliteCruda = "", bienvenidaCruda = ""] = celdas;
    const correo = correoCrudo.toLowerCase();
    const rfc = limpiarRfc(rfcCrudo);
    const telefono = limpiarTelefono(telefonoCrudo);
    const elite = eliteCruda ? Number(eliteCruda.replace(/[%\s]/g, "")) : null;
    const mesesBienvenida = /^\d+$/.test(bienvenidaCruda) ? Number(bienvenidaCruda) : null;
    const bienvenida = mesesBienvenida !== null ? mesesBienvenida > 0 : SI.test(bienvenidaCruda);
    const errores: string[] = [];

    if (!nombre) errores.push("falta el nombre");
    if (!CORREO.test(correo)) errores.push("correo no válido");
    else if (vistos.has(correo)) errores.push("correo repetido en la tabla");
    if (errorDeRfc(rfc)) errores.push("RFC con formato incorrecto");
    if (errorDeTelefono(telefono)) errores.push("teléfono sin 10 dígitos");
    if (elite !== null && !(elite > 0 && elite <= 30)) errores.push("el porcentaje élite va de más de 0 a 30");
    if (mesesBienvenida !== null && mesesBienvenida > 12) errores.push("la bienvenida va de 1 a 12 meses");
    vistos.add(correo);

    filas.push({
      linea: i + 1,
      nombre,
      correo,
      telefono,
      rfc,
      emite_factura: SI.test(facturaCruda),
      elite,
      bienvenida,
      mesesBienvenida: bienvenida ? mesesBienvenida : null,
      errores,
    });
  });

  return filas;
}

/** La liga del comisionista a partir de su nombre: "José Pérez" → "jose-perez". */
export function slugDe(nombre: string): string {
  const base = nombre
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .split("-")
    .slice(0, 3)
    .join("-");
  return base || "comisionista";
}

/** La primera liga libre: "jose-perez", "jose-perez-2", … */
export function slugLibre(nombre: string, ocupados: Set<string>): string {
  const base = slugDe(nombre);
  let slug = base;
  for (let n = 2; ocupados.has(slug); n++) slug = `${base}-${n}`;
  ocupados.add(slug);
  return slug;
}
