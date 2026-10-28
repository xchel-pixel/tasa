"use client";

import { crearClienteNavegador } from "@/lib/supabase/client";

const CSF_MAXIMA = 5 * 1024 * 1024;

/** El motivo por el que un archivo no sirve como CSF; nulo si sirve. */
export function errorDeCsf(archivo: File | null | undefined): string | null {
  if (!archivo || archivo.size === 0) return "Falta la Constancia de Situación Fiscal (PDF).";
  if (archivo.type !== "application/pdf" && !archivo.name.toLowerCase().endsWith(".pdf")) {
    return "La constancia tiene que ser PDF (descárgala del SAT tal cual).";
  }
  if (archivo.size > CSF_MAXIMA) return "El PDF pesa más de 5 MB.";
  return null;
}

/**
 * Sube la CSF directo al bucket privado `altas`, en la ruta que la base
 * espera. Va del teléfono a Storage sin pasar por el servidor (un PDF de
 * varios MB no cabe en una acción del servidor). La política del bucket
 * decide si esa ruta se puede escribir.
 */
export async function subirCsf(ruta: string, archivo: File): Promise<void> {
  const { error } = await crearClienteNavegador()
    .storage.from("altas")
    .upload(ruta, archivo, { contentType: "application/pdf", upsert: false });
  if (error) throw new Error("No se pudo subir la constancia. Revisa tu señal e inténtalo otra vez.");
}
