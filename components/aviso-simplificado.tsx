/**
 * El aviso de privacidad simplificado (Ajustes → aviso_simplificado) junto a la casilla de aceptación. La
 * dirección del aviso integral que trae el texto se vuelve liga. Sin texto, no se muestra.
 */
export function AvisoSimplificado({ texto, liga }: { texto: string | null | undefined; liga: string }) {
  if (!texto?.trim()) return null;
  const partes = texto.split(/(tasa\.xgplataform\.com\/privacidad)/);
  return (
    <p className="rounded-xl bg-alterno px-4 py-3 text-[0.875rem] leading-6 text-secundario">
      {partes.map((p, i) =>
        p === "tasa.xgplataform.com/privacidad" ? (
          <a key={i} href={liga} target="_blank" rel="noopener" className="font-semibold text-acento underline underline-offset-4">{p}</a>
        ) : (
          p
        ))}
    </p>
  );
}
