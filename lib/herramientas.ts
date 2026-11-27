import { cache } from "react";
import type { Persona, Rol } from "@/lib/sesion";
import { crearClienteServidor } from "@/lib/supabase/server";

/** Las herramientas del catálogo (0053). La base decide quién ve cuál, por rol y nivel. */
export type ClaveHerramienta = "mi_tarjeta" | "para_tus_clientes" | "invitar" | "calculadora_traslado" | "calculadora_traslado_completa" | "mapa_catastral" | "mapa_catastral_pdf" | "agenda";

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
