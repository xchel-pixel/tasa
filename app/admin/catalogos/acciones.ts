"use server";

import { revalidatePath } from "next/cache";
import { errorDeClabe, limpiarClabe } from "@/lib/clabe";
import { errorDeRfc, limpiarRfc } from "@/lib/limpiar";
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
  const acento = campo(f, "color_acento");
  const claro = campo(f, "color_claro");
  if (!/^[A-Z0-9]{2,10}$/.test(clave)) return falla("La clave va de 2 a 10 letras o números (p. ej. MGP).");
  if (!nombre) return falla("Falta el nombre.");
  if ([color, acento, claro].some((c) => c && !/^#[0-9a-fA-F]{6}$/.test(c))) return falla("Un color no es válido: va como #04386C.");

  const datos = {
    clave,
    nombre,
    color: color || null,
    cuenta_sugerida_id: campo(f, "cuenta_sugerida_id") || null,
    activa: id ? f.get("activa") === "on" : true,
    // Lo que imprime el PDF de la cotización.
    nombre_legal: campo(f, "nombre_legal") || null,
    direccion: campo(f, "direccion") || null,
    correo: campo(f, "correo") || null,
    telefonos: campo(f, "telefonos") || null,
    firmante: campo(f, "firmante") || null,
    firmante_cargo: campo(f, "firmante_cargo") || null,
    formas_pago: campo(f, "formas_pago") || null,
    color_acento: acento || null,
    color_claro: claro || null,
    tipografia: campo(f, "tipografia") === "manrope" ? "manrope" : "adventor",
    hoja: campo(f, "hoja") === "oficio" ? "oficio" : "carta",
  };
  const supabase = await crearClienteServidor();
  const { error } = id
    ? await supabase.from("marcas").update(datos).eq("id", id)
    : await supabase.from("marcas").insert(datos);
  if (error) return traducir(error, "una marca");
  return listo(id ? "Marca guardada." : "Marca agregada.");
}

/**
 * El logo del PDF, al bucket privado `marcas`. Cada subida es un archivo
 * nuevo (las cotizaciones ya emitidas no cambian: su PDF ya está hecho).
 */
export async function subirLogo(_previo: EstadoCatalogo, f: FormData): Promise<EstadoCatalogo> {
  const persona = await exigirRol("admin_org");
  const id = campo(f, "id");
  const archivo = f.get("logo");
  if (!(archivo instanceof File) || archivo.size === 0) return falla("Elige la imagen del logo.");
  const tipo = archivo.type === "image/png" ? "png" : archivo.type === "image/jpeg" ? "jpg" : null;
  if (archivo.type === "image/svg+xml") return falla("El SVG todavía no se puede imprimir en la cotización. Expórtalo como PNG y súbelo.");
  if (!tipo) return falla("El logo va en PNG o JPG.");
  if (archivo.size > 900_000) return falla("El logo pesa más de 900 KB: redúcelo (el PDF lo imprime a unos 5 cm).");

  const supabase = await crearClienteServidor();
  const ruta = `${persona.organizacion.id}/${id}-${Date.now()}.${tipo}`;
  const subida = await supabase.storage.from("marcas").upload(ruta, archivo, { contentType: archivo.type });
  if (subida.error) return falla("No se pudo subir el logo. Inténtalo otra vez.");
  const { error, count } = await supabase.from("marcas").update({ logo_ruta: ruta }, { count: "exact" }).eq("id", id);
  if (error || count !== 1) return falla("Se subió el logo pero no se pudo asignar a la marca.");
  return listo("Logo actualizado. Sale en las cotizaciones que emitas desde ahora.");
}

export async function guardarCuenta(_previo: EstadoCatalogo, f: FormData): Promise<EstadoCatalogo> {
  await exigirRol("admin_org");
  const id = campo(f, "id");
  const clabe = limpiarClabe(campo(f, "clabe"));
  const rfc = limpiarRfc(campo(f, "rfc"));
  const alias = campo(f, "alias");
  if (!alias || alias.length > 30) return falla("El alias va de 1 a 30 caracteres (es la etiqueta corta: \"Scotiabank XG\").");
  if (!campo(f, "titular")) return falla("Falta el titular.");
  const errorDato = errorDeClabe(clabe) ?? errorDeRfc(rfc);
  if (errorDato) return falla(errorDato);
  if (!campo(f, "marca_id")) return falla("Elige la marca.");

  const datos = {
    alias,
    titular: campo(f, "titular"),
    banco: campo(f, "banco") || null,
    clabe,
    rfc: rfc || null,
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
  // Lo que imprime el PDF de la cotización para este servicio.
  const textos = {
    alcance: campo(f, "alcance") || null,
    tiempo_entrega: campo(f, "tiempo_entrega") || null,
    documentos: campo(f, "documentos") || null,
    aviso: campo(f, "aviso") || null,
  };
  const supabase = await crearClienteServidor();
  const { error } = id
    ? await supabase.from("servicios").update({ nombre, activo: f.get("activo") === "on", ...textos }).eq("id", id)
    : await supabase.from("servicios").insert({ nombre, orden: 99, ...textos });
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
