/**
 * Los correos de bienvenida y rechazo salen de un texto editable en
 * Ajustes con variables entre corchetes. Es pura: la usan el correo, el
 * botón "Copiar mensaje para WhatsApp" y las pruebas, así los tres dicen
 * lo mismo.
 *
 * Si la primera línea empieza con "Asunto:", es el asunto del correo.
 */

export type VariablesAlta = {
  nombre: string;
  /** "Socio Plus 15%"; nulo si no hay nivel que decir. */
  nivel?: string | null;
  /** Fin del trato, "dd/mm/aaaa"; nulo si no hay fecha (sin arranque ni bienvenida). */
  fecha?: string | null;
  contacto?: string | null;
  motivo?: string | null;
};

export type TextoLleno = { asunto: string; texto: string };

/** "María José López" → "María". */
export const nombreDePila = (nombre: string) => nombre.trim().split(/\s+/)[0] ?? "";

/** 12.5 → "Socio 12.5%"; 15 → "Socio Plus 15%". */
export const nivelYPorcentaje = (nombre: string, porcentaje: number | string) =>
  `${nombre} ${Number(porcentaje).toLocaleString("es-MX", { maximumFractionDigits: 2 })}%`;

/** Solo un correo lleva Reply-To; un teléfono como contacto no. */
export const esCorreo = (texto: string | null | undefined) => Boolean(texto && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(texto.trim()));

export function llenarTexto(plantilla: string, v: VariablesAlta, asuntoPorOmision: string): TextoLleno {
  const lineas = plantilla.replace(/\r/g, "").split("\n");
  let asunto = asuntoPorOmision;
  if (/^asunto:/i.test(lineas[0] ?? "")) {
    asunto = lineas.shift()!.replace(/^asunto:\s*/i, "").trim() || asuntoPorOmision;
    while (lineas.length && !lineas[0].trim()) lineas.shift();
  }

  let texto = lineas
    // Sin contacto, el renglón que lo menciona no sale.
    .filter((l) => v.contacto || !l.includes("[CONTACTO DE SOPORTE]"))
    .join("\n");
  if (!v.fecha) texto = texto.replace(/\s*hasta el \[FECHA\]/g, "");
  if (!v.nivel) texto = texto.split("\n").filter((l) => !l.includes("[NIVEL Y %]")).join("\n");

  texto = texto
    .replaceAll("[NOMBRE]", nombreDePila(v.nombre))
    .replaceAll("[NIVEL Y %]", v.nivel ?? "")
    .replaceAll("[FECHA]", v.fecha ?? "")
    .replaceAll("[CONTACTO DE SOPORTE]", v.contacto ?? "")
    // Sin motivo, desaparece con su espacio.
    .replace(/ ?\[MOTIVO OPCIONAL\]/g, v.motivo?.trim() ? ` ${v.motivo.trim()}` : "")
    // Un renglón que se quitó no deja dos líneas en blanco seguidas.
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return { asunto, texto };
}
