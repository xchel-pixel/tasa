"use server";

import { revalidatePath } from "next/cache";
import { consultarClave, consultarPunto, type Quien, type Resultado } from "@/lib/catastro/servicio";
import { TODOS_LOS_ROLES, tengoHerramienta } from "@/lib/herramientas";
import { exigirRol } from "@/lib/sesion";

/** La persona de la sesión, si tiene el mapa; el servidor escribe a su nombre con la llave de servicio. */
async function quien(): Promise<Quien | null> {
  const persona = await exigirRol(...TODOS_LOS_ROLES);
  if (!(await tengoHerramienta("mapa_catastral"))) return null;
  return { persona: persona.id, organizacion: persona.organizacion.id };
}

const NO = { ok: false as const, error: "El mapa catastral no está disponible para ti." };

/** Picar un punto del mapa. */
export async function picarMapa(lat: number, lon: number): Promise<Resultado> {
  const q = await quien();
  if (!q) return NO;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return { ok: false, error: "Punto inválido." };
  const r = await consultarPunto(q, lat, lon);
  revalidatePath("/mapa-catastral");
  return r;
}

/** Buscar por clave; con `forzar`, "Actualizar desde IDECATQ". */
export async function buscarClave(clave: string, forzar: boolean): Promise<Resultado> {
  const q = await quien();
  if (!q) return NO;
  const r = await consultarClave(q, String(clave ?? ""), Boolean(forzar));
  revalidatePath("/mapa-catastral");
  return r;
}
