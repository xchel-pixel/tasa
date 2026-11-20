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

  // Las eliminadas (0093) no se muestran: se pueden deshacer y la limpieza las quita a los 30 días.
  let tareasQ = supabase.from("agenda_tareas").select("id, texto, fecha, hecha_en, contacto_id, solicitud_id").not("fecha", "is", null)
    .is("eliminada_en", null);
  // Hoy: lo de hoy y lo pendiente de antes; otro día: solo lo de ese día.
  tareasQ = esHoy ? tareasQ.or(`fecha.eq.${dia},and(fecha.lt.${dia},hecha_en.is.null)`) : tareasQ.eq("fecha", dia);
  // "Para después": las pendientes y las que se palomearon hoy (tachadas, como en "Para hoy"); al día siguiente se van.
  const inicioHoy = new Date(`${hoy}T00:00:00-06:00`).toISOString();
  const [tareas, despues, citas, seguimientos, eventos] = await Promise.all([
    tareasQ.order("fecha").order("creado_en").returns<Tarea[]>(),
    supabase.from("agenda_tareas").select("id, texto, fecha, hecha_en, contacto_id, solicitud_id").is("fecha", null).is("eliminada_en", null)
      .or(`hecha_en.is.null,hecha_en.gte.${inicioHoy}`).order("creado_en").returns<Tarea[]>(),
    supabase.from("agenda_citas").select("id, inicia, termina, titulo, lugar, clave_catastral, contacto_id, solicitud_id, alarma_min, estatus, notas")
      .gte("inicia", desde).lt("inicia", hasta).order("inicia").returns<Cita[]>(),
    esHoy
      ? supabase.from("agenda_contactos").select("id, nombre, telefono, nota, seguimiento_en, archivado_en").is("archivado_en", null)
          .lte("seguimiento_en", dia).order("seguimiento_en").returns<Contacto[]>()
      : supabase.from("agenda_contactos").select("id, nombre, telefono, nota, seguimiento_en, archivado_en").is("archivado_en", null)
          .eq("seguimiento_en", dia).returns<Contacto[]>(),
    supabase.rpc("agenda_eventos_tasa", { p_desde: dia, p_hasta: dia }).returns<EventoTasa[]>(),
  ]);
  const { data: ajustes } = await supabase.from("agenda_ajustes").select("jornada_inicia, jornada_termina")
    .maybeSingle<{ jornada_inicia: number; jornada_termina: number }>();
  return {
    // Para saber qué citas ya pasaron (se calcula aquí y no al pintar).
    ahora: Date.now(),
    jornada: { inicia: ajustes?.jornada_inicia ?? JORNADA.inicia, termina: ajustes?.jornada_termina ?? JORNADA.termina },
    tareas: tareas.data ?? [],
    despues: despues.data ?? [],
    citas: citas.data ?? [],
    seguimientos: seguimientos.data ?? [],
    eventos: ((eventos.data ?? []) as EventoTasa[]).sort((a, b) => (a.hora ?? "99").localeCompare(b.hora ?? "99")),
  };
}

export type CambioTarea = "hecha" | "pendiente" | "hoy" | "despues" | "borrar" | "restaurar";

/**
 * Qué le pasa a la tarea con cada botón. Nada borra de verdad: "borrar" la marca como eliminada (0093) y "restaurar"
 * la regresa. La casilla de cualquier lista solo cambia hecha_en.
 */
export function cambioDeTarea(que: string, dia: string | null, ahora = new Date()): Record<string, string | null> | null {
  const sello = ahora.toISOString();
  switch (que) {
    case "hecha": return { hecha_en: sello };
    case "pendiente": return { hecha_en: null };
    case "hoy": return dia ? { fecha: dia } : null;
    case "despues": return { fecha: null };
    case "borrar": return { eliminada_en: sello };
    case "restaurar": return { eliminada_en: null };
    default: return null;
  }
}

/** Horario de la jornada por omisión (0092): de 7:00 a 21:00. */
export const JORNADA = { inicia: 7, termina: 21 };

/** Minutos desde la medianoche (México) de un instante. */
export function minutosMx(iso: string | number): number {
  const [h, m] = new Intl.DateTimeFormat("en-GB", { timeZone: ZONA, hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .format(new Date(iso)).split(":").map(Number);
  return h * 60 + m;
}

/** "HH:MM" válida o nula. */
export function horaValida(texto: string | null | undefined): string | null {
  if (!texto || !/^[0-9]{2}:[0-9]{2}$/.test(texto)) return null;
  const [h, m] = texto.split(":").map(Number);
  return h < 24 && m < 60 ? texto : null;
}

export type Bloque = { id: string; desde: number; hasta: number };
export type BloqueAcomodado<T extends Bloque> = T & { columna: number; columnas: number };

/**
 * Acomoda los bloques de la jornada: los que se enciman van lado a lado. Cada grupo de bloques encimados (directa o
 * indirectamente) se reparte en columnas; cada bloque toma la primera columna libre. desde/hasta en minutos.
 */
export function acomodar<T extends Bloque>(bloques: T[]): BloqueAcomodado<T>[] {
  const orden = [...bloques].sort((a, b) => a.desde - b.desde || b.hasta - a.hasta);
  const salida: BloqueAcomodado<T>[] = [];
  let grupo: BloqueAcomodado<T>[] = [];
  let finGrupo = -1;
  let finales: number[] = [];
  const cerrar = () => {
    for (const b of grupo) b.columnas = finales.length;
    salida.push(...grupo);
    grupo = [];
    finales = [];
  };
  for (const b of orden) {
    if (grupo.length && b.desde >= finGrupo) cerrar();
    let columna = finales.findIndex((fin) => fin <= b.desde);
    if (columna === -1) {
      columna = finales.length;
      finales.push(b.hasta);
    } else finales[columna] = b.hasta;
    grupo.push({ ...b, columna, columnas: 0 });
    finGrupo = Math.max(grupo.length === 1 ? -1 : finGrupo, b.hasta);
  }
  if (grupo.length) cerrar();
  return salida;
}

/** Los días de un mes ("AAAA-MM") con citas propias o visitas de Tasa: llevan un punto en el calendario del mes. */
export async function diasConCitas(mes: string): Promise<string[]> {
  if (!/^[0-9]{4}-[0-9]{2}$/.test(mes) || !diaValido(`${mes}-01`)) return [];
  const supabase = await crearClienteServidor();
  const primero = `${mes}-01`;
  const ultimo = sumarDias(primero.slice(0, 8) + "28", 4).slice(0, 8) + "01";
  const fin = sumarDias(ultimo, -1);
  const [citas, eventos] = await Promise.all([
    supabase.from("agenda_citas").select("inicia")
      .gte("inicia", new Date(`${primero}T00:00:00-06:00`).toISOString()).lt("inicia", new Date(`${ultimo}T00:00:00-06:00`).toISOString())
      .returns<{ inicia: string }[]>(),
    supabase.rpc("agenda_eventos_tasa", { p_desde: primero, p_hasta: fin }).returns<EventoTasa[]>(),
  ]);
  const dias = new Set<string>();
  for (const c of citas.data ?? []) dias.add(diaMx(c.inicia));
  for (const e of (eventos.data ?? []) as EventoTasa[]) if (e.tipo === "visita") dias.add(e.dia);
  return [...dias].sort();
}

/** Teléfono para la liga de WhatsApp (México: 10 dígitos → 52…). */
export function ligaWhatsApp(telefono: string | null): string | null {
  const d = (telefono ?? "").replace(/[^0-9]/g, "");
  if (d.length < 10) return null;
  return `https://wa.me/${d.length === 10 ? `52${d}` : d}`;
}
