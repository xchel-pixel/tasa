"use server";

import { revalidatePath } from "next/cache";
import { exigirRol } from "@/lib/sesion";
import { crearClienteServidor } from "@/lib/supabase/server";

export type EstadoAjustes = { mensaje: string | null; error: string | null };

export async function guardarAjustes(
  _previo: EstadoAjustes,
  formData: FormData
): Promise<EstadoAjustes> {
  const persona = await exigirRol("admin_org");

  const contacto = String(formData.get("contacto_soporte") ?? "").trim();
  const dia = Number(formData.get("dia_limite_pago_comision"));
  const terminos = String(formData.get("terminos") ?? "").trim();
  const aviso = String(formData.get("aviso_privacidad") ?? "").trim();
  const bienvenida = String(formData.get("correo_bienvenida") ?? "").trim();
  const rechazo = String(formData.get("correo_rechazo") ?? "").trim();
  if (terminos.length > 20000 || aviso.length > 20000) {
    return { mensaje: null, error: "Los textos van hasta 20,000 caracteres." };
  }
  if (!bienvenida || !rechazo || bienvenida.length > 5000 || rechazo.length > 2000) {
    return { mensaje: null, error: "Los correos de bienvenida y rechazo no pueden quedar vacíos (hasta 5,000 y 2,000 caracteres)." };
  }
  if (contacto.length > 120) {
    return { mensaje: null, error: "Máximo 120 caracteres." };
  }
  if (!Number.isInteger(dia) || dia < 1 || dia > 28) {
    return { mensaje: null, error: "El día límite va del 1 al 28." };
  }

  const supabase = await crearClienteServidor();
  const { error, count } = await supabase
    .from("ajustes")
    .update(
      {
        contacto_soporte: contacto || null,
        dia_limite_pago_comision: dia,
        terminos: terminos || null,
        aviso_privacidad: aviso || null,
        correo_bienvenida: bienvenida,
        correo_rechazo: rechazo,
        bono_referido_equipo: formData.get("bono_referido_equipo") === "on",
        actualizado_en: new Date().toISOString(),
      },
      { count: "exact" }
    )
    .eq("organizacion_id", persona.organizacion.id);

  // Un update que el RLS no deja pasar no truena: toca cero filas.
  if (error || count !== 1) {
    return { mensaje: null, error: "No se pudo guardar. Inténtalo otra vez." };
  }

  revalidatePath("/ajustes");
  revalidatePath("/");
  return {
    mensaje: contacto ? "Guardado." : "Guardado. No se mostrará contacto.",
    error: null,
  };
}

/** Catálogo de orígenes del dinero para pagar comisiones. No se borran: se apagan. */
export async function guardarOrigen(_previo: EstadoAjustes, formData: FormData): Promise<EstadoAjustes> {
  await exigirRol("admin_org");
  const id = String(formData.get("id") ?? "");
  const nombre = String(formData.get("nombre") ?? "").trim();
  if (!nombre || nombre.length > 40) return { mensaje: null, error: "El nombre va de 1 a 40 caracteres." };

  const supabase = await crearClienteServidor();
  const { error } = id
    ? await supabase.from("origenes_pago").update({ nombre, activo: formData.get("activo") === "on" }).eq("id", id)
    : await supabase.from("origenes_pago").insert({ nombre, orden: 99 });
  if (error) {
    return { mensaje: null, error: error.code === "23505" ? "Ya existe un origen con ese nombre." : "No se pudo guardar." };
  }
  revalidatePath("/ajustes");
  return { mensaje: id ? "Guardado." : "Agregado.", error: null };
}

/** El prefijo con el que Tasa genera folios (conector manual). Aplica a los siguientes. */
export async function guardarPrefijo(_previo: EstadoAjustes, formData: FormData): Promise<EstadoAjustes> {
  const persona = await exigirRol("admin_org");
  const prefijo = String(formData.get("prefijo_folio") ?? "").trim().toUpperCase();
  if (!/^[A-Z0-9]{2,6}$/.test(prefijo)) return { mensaje: null, error: "De 2 a 6 letras o números." };
  const supabase = await crearClienteServidor();
  const { error, count } = await supabase
    .from("organizaciones")
    .update({ prefijo_folio: prefijo }, { count: "exact" })
    .eq("id", persona.organizacion.id);
  if (error || count !== 1) return { mensaje: null, error: "No se pudo guardar. Inténtalo otra vez." };
  revalidatePath("/ajustes");
  return { mensaje: `Guardado: los siguientes folios serán ${prefijo}-AAAA-NNNN.`, error: null };
}

/** Por ahora solo "manual" está disponible; los demás llegan con su etapa. */
export async function usarConectorManual(_previo: EstadoAjustes): Promise<EstadoAjustes> {
  await exigirRol("admin_org");
  const supabase = await crearClienteServidor();
  const { error } = await supabase.rpc("activar_conector", { p_tipo: "manual" });
  if (error) return { mensaje: null, error: error.message || "No se pudo cambiar el conector." };
  revalidatePath("/ajustes");
  return { mensaje: "Conector manual activo: el estatus se mueve desde la ficha y Tasa pone los folios.", error: null };
}

/**
 * El último folio real del año (el de la base de Trámites). Con el conector manual, sin esto no se
 * acepta ningún trabajo: Tasa no inventa un 0001 que choque con el consecutivo real.
 */
export async function fijarUltimoFolio(_previo: EstadoAjustes, formData: FormData): Promise<EstadoAjustes> {
  await exigirRol("admin_org");
  const anio = Number(formData.get("anio"));
  const ultimo = Number(String(formData.get("ultimo") ?? "").replace(/\D/g, ""));
  if (!Number.isInteger(ultimo) || ultimo < 0 || ultimo > 9999) return { mensaje: null, error: "Escribe el número del último folio (de 0 a 9999)." };
  const supabase = await crearClienteServidor();
  const { error } = await supabase.rpc("fijar_ultimo_folio", { p_anio: anio, p_ultimo: ultimo });
  if (error) return { mensaje: null, error: error.message || "No se pudo guardar." };
  revalidatePath("/ajustes");
  return { mensaje: "Guardado: el siguiente folio será " + String(ultimo + 1).padStart(4, "0") + ".", error: null };
}
