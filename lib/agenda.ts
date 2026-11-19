import { crearClienteServidor } from "@/lib/supabase/server";

/**
 * Agenda HOY (0091): privada de cada persona. La base solo deja leer y escribir lo propio, con la sesión real (en
 * "ver como" la pantalla se muestra cerrada y la base, además, no devuelve nada de la persona que se está viendo).
 * Todo en hora de México.
 */

export type Tarea = { id: string; texto: string; fecha: string | null; hecha_en: string | null; contacto_id: string | null; solicitud_id: string | null };
export type Cita = {
  id: string; inicia: string; termina: string | null; titulo: string; lugar: string | null; clave_catastral: string | null;
  contacto_id: string | null; solicitud_id: string | null; alarma_min: number | null; estatus: "pendiente" | "hecha" | "no_hecha"; notas: string | null;
};
export type Contacto = { id: string; nombre: string; telefono: string | null; nota: string | null; seguimiento_en: string | null; archivado_en: string | null };
export type EventoTasa = { tipo: string; dia: string; hora: string | null; titulo: string; detalle: string | null; solicitud_id: string | null; uid: string };

const ZONA = "America/Mexico_City";

/** Hoy en México, "2026-11-19". */
export function hoyMx(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: ZONA }).format(new Date());
}

/** Un día válido "AAAA-MM-DD" o nulo. */
export function diaValido(texto: string | null | undefined): string | null {
  if (!texto || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(texto)) return null;
  const d = new Date(`${texto}T12:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== texto ? null : texto;
}

export function sumarDias(dia: string, n: number): string {
  const d = new Date(`${dia}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** "jueves 19 de noviembre". */
export function diaLegible(dia: string): string {
  return new Intl.DateTimeFormat("es-MX", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" }).format(new Date(`${dia}T12:00:00Z`));
}

/** "10:15" en México. */
export function horaMx(iso: string): string {
  return new Intl.DateTimeFormat("es-MX", { timeZone: ZONA, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));
}

/** El día (México) de un instante. */
export function diaMx(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: ZONA }).format(new Date(iso));
}

/** "2026-11-19" + "10:15" (hora de México) → instante ISO. México no tiene horario de verano desde 2022: UTC−6. */
export function instanteMx(dia: string, hora: string): string {
  return new Date(`${dia}T${hora}:00-06:00`).toISOString();
}

/** Lo de un día: tareas (las pendientes de días anteriores siguen en "hoy"), "para después", citas, seguimientos y lo de Tasa. */
export async function leerDia(dia: string) {
  const supabase = await crearClienteServidor();
  const hoy = hoyMx();
  const esHoy = dia === hoy;
  const desde = new Date(`${dia}T00:00:00-06:00`).toISOString();
  const hasta = new Date(`${sumarDias(dia, 1)}T00:00:00-06:00`).toISOString();

  let tareasQ = supabase.from("agenda_tareas").select("id, texto, fecha, hecha_en, contacto_id, solicitud_id").not("fecha", "is", null);
  // Hoy: lo de hoy y lo pendiente de antes; otro día: solo lo de ese día.
  tareasQ = esHoy ? tareasQ.or(`fecha.eq.${dia},and(fecha.lt.${dia},hecha_en.is.null)`) : tareasQ.eq("fecha", dia);
  const [tareas, despues, citas, seguimientos, eventos] = await Promise.all([
    tareasQ.order("fecha").order("creado_en").returns<Tarea[]>(),
    supabase.from("agenda_tareas").select("id, texto, fecha, hecha_en, contacto_id, solicitud_id").is("fecha", null).is("hecha_en", null)
      .order("creado_en").returns<Tarea[]>(),
    supabase.from("agenda_citas").select("id, inicia, termina, titulo, lugar, clave_catastral, contacto_id, solicitud_id, alarma_min, estatus, notas")
      .gte("inicia", desde).lt("inicia", hasta).order("inicia").returns<Cita[]>(),
    esHoy
      ? supabase.from("agenda_contactos").select("id, nombre, telefono, nota, seguimiento_en, archivado_en").is("archivado_en", null)
          .lte("seguimiento_en", dia).order("seguimiento_en").returns<Contacto[]>()
      : supabase.from("agenda_contactos").select("id, nombre, telefono, nota, seguimiento_en, archivado_en").is("archivado_en", null)
          .eq("seguimiento_en", dia).returns<Contacto[]>(),
    supabase.rpc("agenda_eventos_tasa", { p_desde: dia, p_hasta: dia }).returns<EventoTasa[]>(),
  ]);
  return {
    // Para saber qué citas ya pasaron (se calcula aquí y no al pintar).
    ahora: Date.now(),
    tareas: tareas.data ?? [],
    despues: despues.data ?? [],
    citas: citas.data ?? [],
    seguimientos: seguimientos.data ?? [],
    eventos: ((eventos.data ?? []) as EventoTasa[]).sort((a, b) => (a.hora ?? "99").localeCompare(b.hora ?? "99")),
  };
}

/** Teléfono para la liga de WhatsApp (México: 10 dígitos → 52…). */
export function ligaWhatsApp(telefono: string | null): string | null {
  const d = (telefono ?? "").replace(/[^0-9]/g, "");
  if (d.length < 10) return null;
  return `https://wa.me/${d.length === 10 ? `52${d}` : d}`;
}
