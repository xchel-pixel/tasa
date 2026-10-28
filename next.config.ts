import type { NextConfig } from "next";
import { networkInterfaces } from "node:os";

/**
 * Las direcciones IP de esta computadora en la red local.
 *
 * Next bloquea las peticiones de sus propios archivos de JavaScript
 * cuando llegan desde un origen que no reconoce. En la computadora se
 * entra por `localhost` y todo va bien; desde el celular se entra por
 * `http://192.168.x.x:3000`, Next no reconoce ese origen, **sirve el
 * HTML pero se niega a servir el JavaScript**, y la página nunca
 * hidrata: se ve completa y no responde a nada.
 *
 * Se calculan solas en vez de escribirlas a mano porque la IP de una
 * red doméstica cambia sin avisar, y el síntoma —una página muda— no
 * se parece en nada a la causa.
 *
 * Solo afecta al servidor de desarrollo. En Vercel todo llega del mismo
 * origen y esto no interviene.
 */
function direccionesLocales(): string[] {
  return Object.values(networkInterfaces())
    .flat()
    .filter((red) => red && red.family === "IPv4" && !red.internal)
    .map((red) => red!.address);
}

const nextConfig: NextConfig = {
  allowedDevOrigins: direccionesLocales(),
  // Las fuentes del PDF se leen del disco al emitir una cotización; sin
  // esto Vercel no las sube y el PDF falla solo en producción.
  outputFileTracingIncludes: {
    "/admin/solicitudes/[id]": ["./assets/fuentes/**"],
  },
};

export default nextConfig;
