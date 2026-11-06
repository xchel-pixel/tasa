import { cache } from "react";
import type { Persona, Rol } from "@/lib/sesion";
import { crearClienteServidor } from "@/lib/supabase/server";

/** Las herramientas del catálogo (0053). La base decide quién ve cuál, por rol y nivel. */
export type ClaveHerramienta = "mi_tarjeta" | "para_tus_clientes" | "invitar" | "calculadora_traslado" | "calculadora_traslado_completa";

export type Herramienta = { clave: ClaveHerramienta; nombre: string; en_menu: boolean; orden: number };

/** Lo que ve quien tiene la sesión, una sola consulta por petición. */
export const misHerramientas = cache(async (): Promise<Herramienta[]> => {
  const supabase = await crearClienteServidor();
  const { data } = await supabase.rpc("mis_herramientas");
  return (data ?? []) as Herramienta[];
});

export async function tengoHerramienta(clave: ClaveHerramienta): Promise<boolean> {
  return (await misHerramientas()).some((h) => h.clave === clave);
}

/** Para pantallas de herramientas que puede abrir cualquier rol (el catálogo decide quién la ve). */
export const TODOS_LOS_ROLES: Rol[] = ["admin_org", "finanzas", "admin_marca", "equipo", "comisionista"];

export type EntradaMenu = { href: string; texto: string };

/** Dónde vive cada herramienta que va en el menú. */
const RUTA: Partial<Record<ClaveHerramienta, string>> = {
  mi_tarjeta: "/tarjeta",
  calculadora_traslado: "/calculadora",
};

/**
 * El menú fijo, por rol: Portada siempre; el comisionista además su panel de comisiones y Mis datos; en
 * medio, las herramientas del catálogo que tenga activas y marcadas para el menú, en su orden.
 */
export async function menuDe(persona: Persona): Promise<EntradaMenu[]> {
  const herramientas = (await misHerramientas())
    .filter((h) => h.en_menu && RUTA[h.clave])
    .map((h) => ({ href: RUTA[h.clave]!, texto: h.nombre }));
  if (persona.rol !== "comisionista") return [{ href: "/", texto: "Portada" }, ...herramientas];
  return [
    { href: "/", texto: "Portada" },
    { href: "/estado-de-cuenta", texto: "Comisiones" },
    ...herramientas,
    { href: "/perfil", texto: "Mis datos" },
  ];
}
