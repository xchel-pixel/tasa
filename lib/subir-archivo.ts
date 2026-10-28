"use client";

import { crearClienteNavegador } from "@/lib/supabase/client";

/** Lado largo máximo de una foto, en pixeles. */
const LADO_MAXIMO = 1600;
/** Un PDF o XML se sube tal cual; más de esto ya no es un comprobante. */
const DOCUMENTO_MAXIMO = 5 * 1024 * 1024;

/**
 * Sube un archivo directo al bucket privado, a la carpeta de quien lo
 * sube dentro de su organización (`{organización}/{persona}/{uuid}.ext`:
 * la política del bucket no deja otra).
 * Las fotos se achican en el teléfono: una de 3 o 4 MB queda en unos
 * 300 KB, que sí suben con mala señal. Al servidor solo llega la ruta.
 */
export async function subirArchivo(
  bucket: "comprobantes" | "facturas" | "altas",
  carpeta: string,
  archivo: File,
  { xml = false, soloPdf = false }: { xml?: boolean; soloPdf?: boolean } = {}
): Promise<string> {
  const esPdf = archivo.type === "application/pdf";
  const esXml = xml && (archivo.type.includes("xml") || archivo.name.toLowerCase().endsWith(".xml"));
  const esImagen = archivo.type.startsWith("image/");

  if (soloPdf && !esPdf) throw new Error("Tiene que ser PDF.");
  if (!esPdf && !esXml && !esImagen) throw new Error(xml ? "Sube un PDF, un XML o una foto." : "Sube una foto o un PDF.");
  if ((esPdf || esXml) && archivo.size > DOCUMENTO_MAXIMO) throw new Error("El archivo pesa más de 5 MB.");

  const [cuerpo, extension, tipo] = esPdf
    ? [archivo, "pdf", "application/pdf"]
    : esXml
      ? [archivo, "xml", "text/xml"]
      : [await achicar(archivo), "jpg", "image/jpeg"];
  const ruta = `${carpeta}/${crypto.randomUUID()}.${extension}`;

  const { error } = await crearClienteNavegador().storage.from(bucket).upload(ruta, cuerpo, { contentType: tipo });
  if (error) throw error;
  return ruta;
}

/** Redimensiona con el canvas del navegador, sin librerías. Siempre JPEG. */
async function achicar(archivo: File): Promise<Blob> {
  const mapa = await createImageBitmap(archivo);
  const escala = Math.min(1, LADO_MAXIMO / Math.max(mapa.width, mapa.height));
  const lienzo = document.createElement("canvas");
  lienzo.width = Math.round(mapa.width * escala);
  lienzo.height = Math.round(mapa.height * escala);
  const pincel = lienzo.getContext("2d");
  if (!pincel) throw new Error("El teléfono no pudo procesar la foto.");
  pincel.drawImage(mapa, 0, 0, lienzo.width, lienzo.height);
  mapa.close();
  return new Promise((resolver, rechazar) =>
    lienzo.toBlob((b) => (b ? resolver(b) : rechazar(new Error("No se pudo preparar la foto."))), "image/jpeg", 0.82)
  );
}
