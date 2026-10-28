"use server";

import { revalidatePath } from "next/cache";
import { exigirRol } from "@/lib/sesion";
import { crearClienteServidor } from "@/lib/supabase/server";

export type EstadoNivel = { error: string | null; mensaje: string | null };

const falla = (error: string): EstadoNivel => ({ error, mensaje: null });
const campo = (f: FormData, n: string) => String(f.get(n) ?? "").trim();
const cifra = (v: string) => Number(v.replace(/[$,\s]/g, ""));

type Nivel = { id: string; orden: number; umbral_minimo: number | null; es_forzado: boolean };

/**
 * Guarda un nivel. Lo ya calculado no cambia: cada mes guarda su
 * porcentaje al aprobar el cierre. Los niveles nuevos rigen desde el
 * siguiente cierre.
 *
 * Siempre debe quedar un nivel con umbral 0: es donde cae quien empieza
 * o tuvo un mes flojo. Sin él, ese comisionista se quedaría sin porcentaje.
 */
export async function guardarNivel(_previo: EstadoNivel, f: FormData): Promise<EstadoNivel> {
  await exigirRol("admin_org");
  const id = campo(f, "id");
  const nombre = campo(f, "nombre");
  const forzado = f.get("es_forzado") === "true";
  if (!nombre || nombre.length > 40) return falla("El nombre va de 1 a 40 caracteres.");

  const supabase = await crearClienteServidor();
  const { data: actuales, error: errorLeer } = await supabase
    .from("niveles")
    .select("id, orden, umbral_minimo, es_forzado")
    .returns<Nivel[]>();
  if (errorLeer || !actuales) return falla("No se pudieron leer los niveles. Inténtalo otra vez.");

  // El nivel de porcentaje fijo (Élite) solo cambia de nombre: su
  // porcentaje se pone a cada comisionista en su ficha.
  if (forzado) {
    const { error } = await supabase.from("niveles").update({ nombre }).eq("id", id);
    if (error) return traducir(error);
    return listo("Nivel guardado.");
  }

  const umbral = cifra(campo(f, "umbral_minimo"));
  const porcentaje = cifra(campo(f, "porcentaje"));
  if (!Number.isFinite(umbral) || umbral < 0) return falla("El promedio mínimo va en pesos, de 0 en adelante.");
  if (!(porcentaje > 0 && porcentaje <= 30)) return falla("El porcentaje va de más de 0 hasta 30 (el tope por trabajo).");

  const quedaUnoEnCero = actuales.some(
    (n) => !n.es_forzado && (n.id === id ? umbral : Number(n.umbral_minimo)) === 0
  ) || (!id && umbral === 0);
  if (!quedaUnoEnCero) return falla("Debe quedar un nivel con promedio mínimo de $0: es el de quien empieza.");

  const datos = { nombre, umbral_minimo: umbral, porcentaje };
  const { error } = id
    ? await supabase.from("niveles").update(datos).eq("id", id)
    : await supabase.from("niveles").insert({ ...datos, orden: Math.max(0, ...actuales.map((n) => n.orden)) + 1 });
  if (error) return traducir(error);
  return listo(id ? "Nivel guardado. Rige desde el siguiente cierre." : "Nivel agregado. Rige desde el siguiente cierre.");
}

/** Solo si nunca se usó en un cierre (la base lo impide si ya se usó). */
export async function borrarNivel(_previo: EstadoNivel, f: FormData): Promise<EstadoNivel> {
  await exigirRol("admin_org");
  const id = campo(f, "id");
  const supabase = await crearClienteServidor();
  const { data: actuales } = await supabase.from("niveles").select("id, orden, umbral_minimo, es_forzado").returns<Nivel[]>();
  const objetivo = actuales?.find((n) => n.id === id);
  if (!objetivo) return falla("No se encontró el nivel.");
  if (objetivo.es_forzado) return falla("El nivel de porcentaje fijo no se borra.");
  if (!actuales!.some((n) => n.id !== id && !n.es_forzado && Number(n.umbral_minimo) === 0)) {
    return falla("Es el único nivel con promedio mínimo de $0: no se borra.");
  }
  const { error, count } = await supabase.from("niveles").delete({ count: "exact" }).eq("id", id);
  if (error) return traducir(error);
  if (count !== 1) return falla("No se pudo borrar.");
  return listo("Nivel borrado.");
}

function traducir(error: { code?: string; message: string }): EstadoNivel {
  if (error.code === "23505") return falla("Ya existe un nivel con ese nombre.");
  if (error.code === "23503") return falla("Ya se usó en un cierre: no se borra. Cámbiale el umbral o el porcentaje.");
  return falla("No se pudo guardar. Inténtalo otra vez.");
}

function listo(mensaje: string): EstadoNivel {
  revalidatePath("/admin/niveles");
  return { error: null, mensaje };
}

/**
 * El trato inicial de la organización: con qué nivel y cuántos meses
 * entra la tasa de bienvenida y el arranque. Aplica a las altas que
 * vengan; quien ya lo tiene conserva sus fechas.
 */
export async function guardarTratos(_previo: EstadoNivel, f: FormData): Promise<EstadoNivel> {
  const persona = await exigirRol("admin_org");
  const mesesB = Number(campo(f, "bienvenida_meses"));
  const mesesA = Number(campo(f, "arranque_meses"));
  if (!Number.isInteger(mesesB) || mesesB < 1 || mesesB > 12) return falla("La bienvenida va de 1 a 12 meses.");
  if (!Number.isInteger(mesesA) || mesesA < 0 || mesesA > 12) return falla("El arranque va de 0 a 12 meses (0 = sin arranque).");

  const supabase = await crearClienteServidor();
  const { error, count } = await supabase
    .from("ajustes")
    .update(
      {
        bienvenida_nivel_id: campo(f, "bienvenida_nivel_id") || null,
        bienvenida_meses: mesesB,
        arranque_nivel_id: campo(f, "arranque_nivel_id") || null,
        arranque_meses: mesesA,
      },
      { count: "exact" }
    )
    .eq("organizacion_id", persona.organizacion.id);
  if (error || count !== 1) return falla("No se pudo guardar. Inténtalo otra vez.");
  return listo("Guardado. Aplica a las altas que vengan.");
}
