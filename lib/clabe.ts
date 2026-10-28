/**
 * CLABE: 18 dígitos y el último es de control (pesos 3, 7, 1 sobre los
 * primeros 17, como la calcula Banxico). Atrapa un dígito mal copiado
 * antes de que un cliente transfiera a una cuenta que no existe.
 */
export function clabeValida(clabe: string): boolean {
  if (!/^\d{18}$/.test(clabe)) return false;
  const pesos = [3, 7, 1];
  let suma = 0;
  for (let i = 0; i < 17; i++) suma += (Number(clabe[i]) * pesos[i % 3]) % 10;
  return (10 - (suma % 10)) % 10 === Number(clabe[17]);
}

/** Quita espacios, guiones y puntos: la CLABE se copia de muchas formas. */
export const limpiarClabe = (texto: string) => texto.replace(/[\s.\-]/g, "");

/** El motivo, en palabras, por el que una CLABE (ya limpia) no sirve; nulo si sirve. */
export function errorDeClabe(clabe: string): string | null {
  if (!/^\d{18}$/.test(clabe)) return "La CLABE debe tener 18 dígitos.";
  if (!clabeValida(clabe)) return "El dígito de control no coincide, revisa la CLABE.";
  return null;
}
