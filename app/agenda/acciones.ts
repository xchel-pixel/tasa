"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { diaValido, instanteMx } from "@/lib/agenda";
import { TODOS_LOS_ROLES, tengoHerramienta } from "@/lib/herramientas";
import { exigirRol } from "@/lib/sesion";
import { crearClienteServidor, verComoId } from "@/lib/supabase/server";

/** Agenda (0091): todo con la sesión de quien la usa; la base solo deja tocar lo propio. */

export type EstadoAgenda = { error: string | null; mensaje: string | null };

const texto = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuidO = (v: string) => (UUID.test(v) ? v : null);

async function puede(): Promise<string | null> {
  await exigirRol(...TODOS_LOS_ROLES);
  if (await verComoId()) return "La agenda es privada: en \"ver como\" no se ve ni se cambia.";
  if (!(await tengoHerramienta("agenda"))) return "La agenda no está disponible para ti.";
  return null;
}

async function listo(error: { message: string } | null, ok = "Listo."): Promise<EstadoAgenda> {
  if (error) return { error: error.message || "No se pudo. Inténtalo otra vez.", mensaje: null };
  revalidatePath("/agenda", "layout");
  return { error: null, mensaje: ok };
}

/** Tarea nueva: para un día o "para después" (sin fecha). */
export async function agregarTarea(_p: EstadoAgenda, f: FormData): Promise<EstadoAgenda> {
  const no = await puede();
  if (no) return { error: no, mensaje: null };
  const t = texto(f, "texto");
  if (!t) return { error: "Escribe la tarea.", mensaje: null };
  if (t.length > 200) return { error: "Máximo 200 caracteres.", mensaje: null };
  const despues = f.get("despues") === "si";
  const { error } = await (await crearClienteServidor()).from("agenda_tareas")
    .insert({ texto: t, fecha: despues ? null : diaValido(texto(f, "dia")) });
  return listo(error, "Tarea agregada.");
}

/** Palomita, mover a hoy / para después, o borrar. Sin estado de regreso: la pantalla se vuelve a pintar. */
export async function cambiarTarea(f: FormData): Promise<void> {
  if (await puede()) return;
  const id = uuidO(texto(f, "id"));
  if (!id) return;
  const supabase = await crearClienteServidor();
  const que = texto(f, "que");
  if (que === "hecha") await supabase.from("agenda_tareas").update({ hecha_en: new Date().toISOString() }).eq("id", id);
  else if (que === "pendiente") await supabase.from("agenda_tareas").update({ hecha_en: null }).eq("id", id);
  else if (que === "hoy") await supabase.from("agenda_tareas").update({ fecha: diaValido(texto(f, "dia")) }).eq("id", id);
  else if (que === "despues") await supabase.from("agenda_tareas").update({ fecha: null }).eq("id", id);
  else if (que === "borrar") await supabase.from("agenda_tareas").delete().eq("id", id);
  revalidatePath("/agenda", "layout");
}

/** Cita nueva o editada. */
export async function guardarCita(_p: EstadoAgenda, f: FormData): Promise<EstadoAgenda> {
  const no = await puede();
  if (no) return { error: no, mensaje: null };
  const dia = diaValido(texto(f, "dia"));
  const hora = texto(f, "hora");
  const titulo = texto(f, "titulo");
  if (!dia) return { error: "Elige el día.", mensaje: null };
  if (!/^[0-9]{2}:[0-9]{2}$/.test(hora)) return { error: "Elige la hora.", mensaje: null };
  if (!titulo) return { error: "Escribe qué es la cita.", mensaje: null };
  const horaFin = texto(f, "hora_fin");
  const clave = texto(f, "clave").replace(/[^0-9]/g, "");
  if (clave && !/^(0[1-9]|1[0-8])[0-9]{13}$/.test(clave)) return { error: "La clave catastral lleva 15 dígitos.", mensaje: null };
  const alarma = texto(f, "alarma");
  const datos = {
    inicia: instanteMx(dia, hora),
    termina: /^[0-9]{2}:[0-9]{2}$/.test(horaFin) && horaFin > hora ? instanteMx(dia, horaFin) : null,
    titulo: titulo.slice(0, 120),
    lugar: texto(f, "lugar").slice(0, 200) || null,
    clave_catastral: clave || null,
    contacto_id: uuidO(texto(f, "contacto_id")),
    solicitud_id: uuidO(texto(f, "solicitud_id")),
    alarma_min: ["0", "15", "30", "60", "1440"].includes(alarma) ? Number(alarma) : null,
    notas: texto(f, "notas").slice(0, 2000) || null,
  };
  const supabase = await crearClienteServidor();
  const id = uuidO(texto(f, "id"));
  const { error } = id ? await supabase.from("agenda_citas").update(datos).eq("id", id) : await supabase.from("agenda_citas").insert(datos);
  if (error) return { error: error.message, mensaje: null };
  revalidatePath("/agenda", "layout");
  redirect(`/agenda?dia=${dia}`);
}

/** Hecha / no hecha / borrar una cita. */
export async function cambiarCita(f: FormData): Promise<void> {
  if (await puede()) return;
  const id = uuidO(texto(f, "id"));
  if (!id) return;
  const supabase = await crearClienteServidor();
  const que = texto(f, "que");
  if (["hecha", "no_hecha", "pendiente"].includes(que)) await supabase.from("agenda_citas").update({ estatus: que }).eq("id", id);
  else if (que === "borrar") {
    await supabase.from("agenda_citas").delete().eq("id", id);
    revalidatePath("/agenda", "layout");
    redirect(`/agenda?dia=${diaValido(texto(f, "dia")) ?? ""}`);
  }
  revalidatePath("/agenda", "layout");
}

/** Contacto nuevo o editado. */
export async function guardarContacto(_p: EstadoAgenda, f: FormData): Promise<EstadoAgenda> {
  const no = await puede();
  if (no) return { error: no, mensaje: null };
  const nombre = texto(f, "nombre");
  if (!nombre) return { error: "Escribe el nombre.", mensaje: null };
  const datos = {
    nombre: nombre.slice(0, 120),
    telefono: texto(f, "telefono").slice(0, 30) || null,
    nota: texto(f, "nota").slice(0, 1000) || null,
    seguimiento_en: diaValido(texto(f, "seguimiento_en")),
  };
  const supabase = await crearClienteServidor();
  const id = uuidO(texto(f, "id"));
  const { error } = id ? await supabase.from("agenda_contactos").update(datos).eq("id", id) : await supabase.from("agenda_contactos").insert(datos);
  if (error) return { error: error.message, mensaje: null };
  revalidatePath("/agenda", "layout");
  redirect("/agenda/contactos");
}

/** Seguimiento hecho (se quita la fecha), archivar o borrar un contacto. */
export async function cambiarContacto(f: FormData): Promise<void> {
  if (await puede()) return;
  const id = uuidO(texto(f, "id"));
  if (!id) return;
  const supabase = await crearClienteServidor();
  const que = texto(f, "que");
  if (que === "seguido") await supabase.from("agenda_contactos").update({ seguimiento_en: null }).eq("id", id);
  else if (que === "archivar") await supabase.from("agenda_contactos").update({ archivado_en: new Date().toISOString() }).eq("id", id);
  else if (que === "borrar") {
    await supabase.from("agenda_contactos").delete().eq("id", id);
    revalidatePath("/agenda", "layout");
    redirect("/agenda/contactos");
  }
  revalidatePath("/agenda", "layout");
}

/** Liga de calendario nueva (la anterior deja de servir). Regresa la liga completa UNA vez. */
export async function regenerarLiga(_p: EstadoAgenda & { liga?: string }, _f: FormData): Promise<EstadoAgenda & { liga?: string }> {
  const no = await puede();
  if (no) return { error: no, mensaje: null };
  const { data, error } = await (await crearClienteServidor()).rpc("generar_liga_calendario");
  if (error || typeof data !== "string") return { error: error?.message ?? "No se pudo crear la liga.", mensaje: null };
  revalidatePath("/agenda/calendario");
  return { error: null, mensaje: "Liga nueva lista. Cópiala ahora: por seguridad no se vuelve a mostrar.", liga: data };
}

export async function quitarLiga(): Promise<void> {
  if (await puede()) return;
  await (await crearClienteServidor()).rpc("revocar_liga_calendario");
  revalidatePath("/agenda/calendario");
}
