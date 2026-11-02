const MAXIMO_BYTES = 2 * 1024 * 1024;

/**
 * Recorta en el teléfono, sin librerías (solo corre en el navegador):
 * - la foto, al cuadrado del centro, en 512×512 JPEG;
 * - el logo, entero dentro de 512×512, en PNG para conservar la transparencia;
 * - la foto de un inmueble, al 4:3 del centro, en 1024×768 JPEG.
 * Lo que pese más de 2 MB aun recortado se rechaza.
 */
export async function prepararImagen(archivo: File, tipo: "foto" | "logo" | "inmueble"): Promise<Blob> {
  if (!["image/jpeg", "image/png", "image/webp"].includes(archivo.type)) {
    throw new Error("Usa una imagen JPG, PNG o WebP.");
  }
  const img = await createImageBitmap(archivo);
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d")!;
  if (tipo === "foto") {
    const corte = Math.min(img.width, img.height);
    canvas.width = 512;
    canvas.height = 512;
    ctx.drawImage(img, (img.width - corte) / 2, (img.height - corte) / 2, corte, corte, 0, 0, 512, 512);
  } else if (tipo === "inmueble") {
    // El rectángulo 4:3 más grande que cabe, centrado.
    const ancho = Math.min(img.width, (img.height * 4) / 3);
    const alto = (ancho * 3) / 4;
    canvas.width = 1024;
    canvas.height = 768;
    ctx.drawImage(img, (img.width - ancho) / 2, (img.height - alto) / 2, ancho, alto, 0, 0, 1024, 768);
  } else {
    const escala = Math.min(1, 512 / Math.max(img.width, img.height));
    canvas.width = Math.round(img.width * escala);
    canvas.height = Math.round(img.height * escala);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  }
  const png = tipo === "logo";
  const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, png ? "image/png" : "image/jpeg", png ? undefined : 0.85));
  if (!blob) throw new Error("No se pudo preparar la imagen.");
  if (blob.size > MAXIMO_BYTES) throw new Error("La imagen pesa más de 2 MB aun recortada: usa una más ligera.");
  return blob;
}
