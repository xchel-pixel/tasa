"use server";

import { revalidatePath } from "next/cache";
import { obtenerSesion } from "@/lib/sesion";
import { crearClienteServidor } from "@/lib/supabase/server";

export type EstadoPlataforma = { error: string | null; mensaje: string | null };

/** `crear_organizacion` revisa que sea la plataforma y arma lo mínimo. */
export async function crearOrganizacion(_previo: EstadoPlataforma, formData: FormData): Promise<EstadoPlataforma> {
  const sesion = await obtenerSesion();
  if (!sesion?.superPlataforma) return { error: "Solo la plataforma da de alta organizaciones.", mensaje: null };
  const campo = (n: string) => String(formData.get(n) ?? "").trim();

  const slug = campo("slug").toLowerCase();
  const prefijo = campo("prefijo").toUpperCase();
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) return { error: "El slug solo lleva minúsculas, números y guiones.", mensaje: null };
  if (!/^[A-Z0-9]{2,6}$/.test(prefijo)) return { error: "El prefijo va de 2 a 6 letras o números.", mensaje: null };

  const supabase = await crearClienteServidor();
  const { error } = await supabase.rpc("crear_organizacion", {
    p_nombre: campo("nombre"),
    p_slug: slug,
    p_prefijo: prefijo,
    p_admin_nombre: campo("admin_nombre"),
    p_admin_correo: campo("admin_correo"),
  });
  if (error) return { error: error.message || "No se pudo dar de alta. Inténtalo otra vez.", mensaje: null };

  revalidatePath("/plataforma");
  return { error: null, mensaje: `Organización "${campo("nombre")}" dada de alta. Su administrador ya puede entrar.` };
}
