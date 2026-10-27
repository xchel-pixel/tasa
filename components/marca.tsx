/**
 * El wordmark de Tasa: texto, no imagen. Marino, Manrope 700.
 * No lleva logo ni nombre de MGP.
 */
export function Marca({ className = "" }: { className?: string }) {
  return (
    <span className={`font-bold tracking-tight text-primario ${className}`}>
      Tasa
    </span>
  );
}
