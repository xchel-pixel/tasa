/** Un mensaje de error o de éxito que regresa una acción del servidor. */
export function Aviso({ estado }: { estado: { error?: string | null; mensaje?: string | null } }) {
  if (estado.error) return <p className="text-[0.9375rem] leading-6 text-error">{estado.error}</p>;
  if (estado.mensaje)
    return <p className="rounded-lg bg-exito-fondo px-4 py-2 text-[0.9375rem] leading-6 text-exito">{estado.mensaje}</p>;
  return null;
}
