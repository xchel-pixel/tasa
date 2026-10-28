import Image from "next/image";

/**
 * El logo de la plataforma Tasa (símbolo + palabra). Solo en la
 * interfaz: el PDF de cotización lleva la marca ejecutora, nunca este.
 * `blanco` es para fondos marino u oscuros. No lleva logo ni nombre de MGP.
 *
 * El PNG trae aire alrededor (748×300); `alto` es el de la imagen completa.
 * El margen negativo alinea el símbolo con el texto de abajo.
 */
export function Marca({ alto = 40, blanco = false, prioridad = false }: { alto?: number; blanco?: boolean; prioridad?: boolean }) {
  const ancho = Math.round((alto * 748) / 300);
  return (
    <Image
      src={blanco ? "/tasa-logo-horizontal-blanco.png" : "/tasa-logo-horizontal.png"}
      alt="Tasa"
      width={ancho}
      height={alto}
      priority={prioridad}
      className="block"
      style={{ marginLeft: -Math.round((ancho * 55) / 748) }}
    />
  );
}
