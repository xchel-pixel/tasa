/**
 * Lo que la gente pega con espacios, guiones o paréntesis se limpia antes
 * de validar. La validación vive en el servidor, con mensajes en español;
 * los campos no llevan `pattern` (el aviso del navegador no dice qué falta).
 */

export const RFC = /^[A-ZÑ&]{3,4}[0-9]{6}[A-Z0-9]{3}$/;

/** "lopa-800101 ab1" → "LOPA800101AB1". */
export const limpiarRfc = (texto: string) => texto.replace(/[\s.\-]/g, "").toUpperCase();

export function errorDeRfc(rfc: string): string | null {
  if (!rfc) return null;
  if (rfc.length !== 12 && rfc.length !== 13) return "El RFC debe tener 12 caracteres (empresa) o 13 (persona).";
  if (!RFC.test(rfc)) return "El RFC no tiene el formato correcto: letras, fecha AAMMDD y homoclave.";
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
