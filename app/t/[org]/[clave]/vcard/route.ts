import { urlDelSitio } from "@/lib/altas";
import { leerTarjeta } from "../datos";

/** Escapa lo que va en un campo de vCard (comas, punto y coma, diagonales, saltos). */
const v = (s: string) =>
  s.replace(/\\/g, "\\\\").replace(/[,;]/g, (c) => "\\" + c).replace(/\r?\n/g, "\\n");

/** "Guardar contacto": la vCard con lo publicado en la tarjeta (nombre, WhatsApp, correo si lo muestra). */
export async function GET(_req: Request, { params }: { params: Promise<{ org: string; clave: string }> }) {
  const { org, clave } = await params;
  const t = await leerTarjeta(org, clave);
  if (!t || !t.disponible) return new Response("Esta tarjeta no está disponible", { status: 404 });
  const liga = `${await urlDelSitio()}/t/${t.org}/${t.slug}`;
  const lineas = [
    "BEGIN:VCARD",
    "VERSION:3.0",
    `FN:${v(t.nombre)}`,
    `N:${v(t.nombre)};;;;`,
    "TITLE:Asesor afiliado",
    t.telefono ? `TEL;TYPE=CELL:+52${t.telefono}` : null,
    t.correo ? `EMAIL:${v(t.correo)}` : null,
    `URL:${liga}`,
    t.zona ? `NOTE:${v(t.zona)}` : null,
    "END:VCARD",
  ].filter(Boolean);
  return new Response(lineas.join("\r\n") + "\r\n", {
    headers: {
      "Content-Type": "text/vcard; charset=utf-8",
      "Content-Disposition": `attachment; filename="${t.slug}.vcf"`,
    },
  });
}
