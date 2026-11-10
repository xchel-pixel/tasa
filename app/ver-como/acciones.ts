"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { exigirRol } from "@/lib/sesion";
import { COOKIE_SOLO_LECTURA, COOKIE_VER_COMO, crearClienteServidor } from "@/lib/supabase/server";

/**
 * "Ver como este comisionista" (0080). La base abre la vista (solo admin_org o finanzas, bitácora) y desde ahí cada
 * petición lleva el encabezado: la base responde como él y en solo lectura. Una hora, igual que la vista.
 */
export async function abrirVerComo(formData: FormData) {
  await exigirRol("admin_org", "finanzas");
  const persona = String(formData.get("persona") ?? "");
  const supabase = await crearClienteServidor();
  const { error } = await supabase.rpc("iniciar_ver_como", { p_persona: persona });
  if (error) throw new Error(error.message || "No se pudo abrir la vista.");
  const almacen = await cookies();
  const opciones = { path: "/", maxAge: 3600, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production" };
  almacen.set(COOKIE_VER_COMO, persona, { ...opciones, httpOnly: true });
  // Sin httpOnly: el navegador la lee para no subir archivos en este modo.
  almacen.set(COOKIE_SOLO_LECTURA, "1", opciones);
  redirect("/");
}

export async function salirVerComo() {
  const almacen = await cookies();
  const persona = almacen.get(COOKIE_VER_COMO)?.value ?? "";
  almacen.delete(COOKIE_VER_COMO);
  almacen.delete(COOKIE_SOLO_LECTURA);
  // Ya sin la cookie, el cliente va sin el encabezado: cierra la vista como quien es.
  const supabase = await crearClienteServidor();
  await supabase.rpc("cerrar_ver_como");
  redirect(persona.length === 36 ? `/admin/comisionistas/${persona}` : "/");
}
