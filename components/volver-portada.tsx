import Link from "next/link";

/** "← Portada" arriba de cada pantalla que abre una tarjeta de la portada. */
export function VolverPortada() {
  return (
    <Link href="/" className="toque text-[0.9375rem] font-semibold text-acento">
      ← Portada
    </Link>
  );
}
