"use server";

import { revalidatePath } from "next/cache";
import { clabeValida } from "@/lib/clabe";
import { exigirRol } from "@/lib/sesion";
import { crearClienteServidor } from "@/lib/supabase/server";

export type EstadoCatalogo = { error: string | null; mensaje: string | null };

const falla = (error: string): EstadoCatalogo => ({ error, mensaje: null });
const campo = (f: FormData, n: string) => String(f.get(n) ?? "").trim();

/** Los errores de la base que sí sabemos explicar. */
function traducir(error: { code?: string; message: string }, que: string): EstadoCatalogo {
  if (error.code === "23505") return falla(`Ya existe ${que} con ese nombre o clave.`);
  if (error.code === "23503") return falla("Ya tiene movimientos: no se borra. Desactívala para que no aparezca en lo nuevo.");
  return falla(error.message || "No se pudo guardar. Inténtalo otra vez.");
}

function listo(mensaje: string): EstadoCatalogo {
  revalidatePath("/admin/catalogos");
  return { error: null, mensaje };
}

export async function guardarMarca(_previo: EstadoCatalogo, f: FormData): Promise<EstadoCatalogo> {
  await exigirRol("admin_org");
  const id = campo(f, "id");
  const clave = campo(f, "clave").toUpperCase();
  const nombre = campo(f, "nombre");
  const color = campo(f, "color");
  if (!/^[A-Z0-9]{2,10}$/.test(clave)) return falla("La clave va de 2 a 10 letras o números (p. ej. MGP).");
  if (!nombre) return falla("Falta el nombre.");
  if (color && !/^#[0-9a-fA-F]{6}$/.test(color)) return falla("El color no es válido.");

  const datos = {
    clave,
    nombre,
    color: color || null,
    cuenta_sugerida_id: campo(f, "cuenta_sugerida_id") || null,
    activa: id ? f.get("activa") === "on" : true,
  };
  const supabase = await crearClienteServidor();
  const { error } = id
    ? await supabase.from("marcas").update(datos).eq("id", id)
    : await supabase.from("marcas").insert(datos);
  if (error) return traducir(error, "una marca");
  return listo(id ? "Marca guardada." : "Marca agregada.");
}

export async function guardarCuenta(_previo: EstadoCatalogo, f: FormData): Promise<EstadoCatalogo> {
  await exigirRol("admin_org");
  const id = campo(f, "id");
  const clabe = campo(f, "clabe").replace(/\s/g, "");
  const alias = campo(f, "alias");
  if (!alias || alias.length > 30) return falla("El alias va de 1 a 30 caracteres (es la etiqueta corta: \"Scotiabank XG\").");
  if (!campo(f, "titular")) return falla("Falta el titular.");
  if (!clabeValida(clabe)) return falla("La CLABE no es válida: son 18 dígitos y el último no cuadra. Revísala dígito por dígito.");
  if (!campo(f, "marca_id")) return falla("Elige la marca.");

  const datos = {
    alias,
    titular: campo(f, "titular"),
    banco: campo(f, "banco") || null,
    clabe,
    rfc: campo(f, "rfc").toUpperCase() || null,
    marca_id: campo(f, "marca_id"),
    activa: id ? f.get("activa") === "on" : true,
  };
  const supabase = await crearClienteServidor();
  const { error } = id
    ? await supabase.from("cuentas_receptoras").update(datos).eq("id", id)
    : await supabase.from("cuentas_receptoras").insert(datos);
  if (error) return traducir(error, "una cuenta");
  return listo(id ? "Cuenta guardada." : "Cuenta agregada.");
}

export async function guardarServicio(_previo: EstadoCatalogo, f: FormData): Promise<EstadoCatalogo> {
  await exigirRol("admin_org");
  const id = campo(f, "id");
  const nombre = campo(f, "nombre");
  if (!nombre) return falla("Falta el nombre.");
  const supabase = await crearClienteServidor();
  const { error } = id
    ? await supabase.from("servicios").update({ nombre, activo: f.get("activo") === "on" }).eq("id", id)
    : await supabase.from("servicios").insert({ nombre, orden: 99 });
  if (error) return traducir(error, "un servicio");
  return listo(id ? "Servicio guardado." : "Servicio agregado.");
}

/**
 * Borrar solo lo que nunca se usó. Si ya tiene trabajos o movimientos,
 * la base lo impide (llaves) y se pide desactivarlo.
 */
export async function eliminar(_previo: EstadoCatalogo, f: FormData): Promise<EstadoCatalogo> {
  await exigirRol("admin_org");
  const tabla = campo(f, "tabla");
  if (!["marcas", "cuentas_receptoras", "servicios"].includes(tabla)) return falla("No válido.");
  const supabase = await crearClienteServidor();
  const { error, count } = await supabase.from(tabla).delete({ count: "exact" }).eq("id", campo(f, "id"));
  if (error) return traducir(error, "un registro");
  if (count !== 1) return falla("No se pudo borrar.");
  return listo("Borrado.");
}
