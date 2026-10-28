/**
 * Lo que la gente pega con espacios, guiones o paréntesis se limpia antes
 * de validar. La validación vive en el servidor, con mensajes en español;
 * los campos no llevan `pattern` (el aviso del navegador no dice qué falta).
 */

export const RFC = /^[A-ZÑ&]{3,4}[0-9]{6}[A-Z0-9]{3}$/;

/** "lopa-800101 ab1" → "LOPA800101AB1". */
export const limpiarRfc = (texto: string) => texto.replace(/[\s.\-]/g, "").toUpperCase();

const TABLA_RFC = "0123456789ABCDEFGHIJKLMN&OPQRSTUVWXYZ Ñ";

/**
 * Dígito verificador del SAT (el último carácter). El de empresa (12) se
 * completa con un espacio al frente; pesos 13 a 2, módulo 11; 10 es "A".
 * Es la misma cuenta que `rfc_digito()` en la base.
 */
export function rfcValido(rfc: string): boolean {
  if (!RFC.test(rfc)) return false;
  const base = rfc.slice(0, -1).padStart(12, " ");
  let suma = 0;
  for (let i = 0; i < 12; i++) suma += TABLA_RFC.indexOf(base[i]) * (13 - i);
  const resto = suma % 11;
  const digito = resto === 0 ? "0" : 11 - resto === 10 ? "A" : String(11 - resto);
  return rfc.endsWith(digito);
}

/**
 * Vacío pasa (campos opcionales) salvo con `obligatorio`. Con
 * `revisadoAMano` no se exige el dígito: RFC antiguo comprobado con la CSF.
 */
export function errorDeRfc(
  rfc: string,
  { obligatorio = false, revisadoAMano = false }: { obligatorio?: boolean; revisadoAMano?: boolean } = {}
): string | null {
  if (!rfc) return obligatorio ? "Falta el RFC." : null;
  if (rfc.length !== 12 && rfc.length !== 13) return "El RFC debe tener 12 caracteres (empresa) o 13 (persona).";
  if (!RFC.test(rfc)) return "El RFC no tiene el formato correcto: letras, fecha AAMMDD y homoclave.";
  if (!revisadoAMano && !rfcValido(rfc)) return "El RFC no cuadra: revisa el último carácter (dígito verificador).";
  return null;
}

/** "(442) 123-45 67" → "4421234567"; conserva el + de un número internacional. */
export const limpiarTelefono = (texto: string) => texto.trim().replace(/(?!^\+)[^\d]/g, "");

export function errorDeTelefono(telefono: string): string | null {
  if (!telefono) return null;
  const digitos = telefono.replace(/\D/g, "").length;
  if (digitos < 10 || digitos > 13) return "El teléfono debe tener 10 dígitos (o con lada internacional, hasta 13).";
  return null;
}
