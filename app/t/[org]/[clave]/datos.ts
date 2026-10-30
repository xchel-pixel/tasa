import { cache } from "react";
import { crearClienteServidor } from "@/lib/supabase/server";

export type Publicada = {
  disponible: true;
  organizacion: string;
  org: string;
  codigo: string;
  slug: string;
  nivel: number;
  nombre: string;
  frase: string | null;
  telefono: string | null;
  correo: string | null;
  zona: string | null;
  foto: string | null;
  logo: string | null;
  color: string | null;
  servicios: string[];
  testimonios: { cliente: string; texto: string }[];
};
export type NoDisponible = { disponible: false; organizacion: string };

/** Lo que la tarjeta publica (por función de la base: anon no lee tablas). Una sola lectura por petición. */
export const leerTarjeta = cache(async (org: string, clave: string): Promise<Publicada | NoDisponible | null> => {
  const supabase = await crearClienteServidor();
  const { data } = await supabase.rpc("datos_tarjeta", { p_org: org, p_clave: clave });
  return (data as Publicada | NoDisponible | null) ?? null;
});
