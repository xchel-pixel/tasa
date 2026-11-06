import { crearClienteServidor } from "@/lib/supabase/server";
import { clienteDeServicio } from "@/lib/supabase/servicio";
import { aLonLat, caja, contiene, geometriaValida, puntoInterior, type Geometria } from "./geo";
import { consultarExpediente, consultarMapa, type PredioDeCapa } from "./idecatq";
import { centroideDelExpediente, limpiarExpediente, type Datos, type Privados } from "./limpiar";

/**
 * El kardex del mapa catastral: primero Tasa; IDECATQ solo si el predio no está, tiene más de 90 días, quedó
 * sin expediente o alguien pide "Actualizar". Solo cuenta en el cupo una consulta que trajo el expediente.
 * Todo se lee por catastro_ficha() (la base decide qué campos ve cada rol).
 *
 * Escribir en las tablas compartidas (guardar y anotar fallas) lo hace solo este servidor, con la llave de
 * servicio: la sesión ya se verificó (acciones.ts) y aquí se pasan los ids de esa persona y su organización.
 */

/** Quién consulta, ya verificado con su sesión. */
export type Quien = { persona: string; organizacion: string };

function servicio() {
  const db = clienteDeServicio();
  if (!db) throw new Error("Falta la llave de servicio en el servidor.");
  return db;
}

export const DIAS_VIGENCIA = 90;

export type Ficha = {
  clave: string;
  municipio: string;
  geometria: Geometria | null;
  latitud: number | null;
  longitud: number | null;
  consultado_en: string;
  expediente: "completo" | "pendiente";
  campos: Record<string, unknown>;
  /** Solo admin_org, finanzas y equipo. */
  privados?: (Omit<Privados, "propietarios"> & { propietarios: Privados["propietarios"]; actualizado_en: string }) | null;
  historial?: { consultado_en: string; reemplazada_en: string; cambios: string[] }[];
};

export type Resultado =
  | { ok: true; ficha: Ficha; aviso: string | null }
  | { ok: false; error: string; geometria?: Geometria | null };

const fechaCorta = (iso: string) =>
  new Intl.DateTimeFormat("es-MX", { timeZone: "America/Mexico_City", dateStyle: "long" }).format(new Date(iso));

export function vigente(f: Pick<Ficha, "consultado_en" | "expediente">): boolean {
  return f.expediente === "completo" && Date.now() - new Date(f.consultado_en).getTime() < DIAS_VIGENCIA * 86_400_000;
}

/** Querétaro, con holgura. Fuera de aquí no se consulta. */
export function enQueretaro(lat: number, lon: number): boolean {
  return lat > 20 && lat < 21.8 && lon > -100.7 && lon < -99;
}

export function normalizarClave(texto: string): string | null {
  const c = texto.replace(/\D/g, "");
  return /^(0[1-9]|1[0-8])\d{13}$/.test(c) ? c : null;
}

/**
 * El punto del predio (Maps, WhatsApp, QR, prellenado) se calcula del polígono al leer: siempre dentro del
 * terreno. Así también se corrigen los guardados antes (su centroide podía caer fuera).
 */
export function conPunto<T extends Ficha | null>(f: T): T {
  const g = f?.geometria ? geometriaValida(f.geometria) : null;
  if (!f || !g) return f;
  const [lon, lat] = puntoInterior(g);
  return { ...f, latitud: Math.round(lat * 1e6) / 1e6, longitud: Math.round(lon * 1e6) / 1e6 };
}

async function ficha(clave: string): Promise<Ficha | null> {
  const supabase = await crearClienteServidor();
  const { data, error } = await supabase.rpc("catastro_ficha", { p_clave: clave });
  if (error) throw new Error(error.message);
  return conPunto((data as Ficha | null) ?? null);
}

async function impedimento(): Promise<string | null> {
  const supabase = await crearClienteServidor();
  const { data, error } = await supabase.rpc("catastro_impedimento");
  if (error) throw new Error(error.message);
  return (data as string | null) ?? null;
}

async function registrarFalla(quien: Quien, tipo: "mapa" | "expediente") {
  await servicio().rpc("catastro_registrar_falla", { p_org: quien.organizacion, p_persona: quien.persona, p_servicio: tipo });
}

async function guardar(quien: Quien, p: {
  clave: string; geometria: Geometria | null; datos: Datos; expediente: "completo" | "pendiente"; privados: Privados | null; modo: "consulta" | "actualizar";
}): Promise<string | null> {
  const [lon, lat] = p.geometria ? puntoInterior(p.geometria) : [null, null];
  const { error } = await servicio().rpc("catastro_guardar", {
    p_org: quien.organizacion,
    p_persona: quien.persona,
    p_clave: p.clave,
    p_geometria: p.geometria,
    p_latitud: lat === null ? null : Math.round(lat * 1e6) / 1e6,
    p_longitud: lon === null ? null : Math.round(lon * 1e6) / 1e6,
    p_caja: p.geometria ? caja(p.geometria) : null,
    p_datos: p.datos,
    p_expediente: p.expediente,
    p_privados: p.privados,
    p_modo: p.modo,
  });
  return error ? error.message : null;
}

/** Lo guardado, con la razón por la que no se actualizó. */
function guardado(f: Ficha, motivo: string): Resultado {
  return { ok: true, ficha: f, aviso: `${motivo} Se muestra lo guardado en Tasa del ${fechaCorta(f.consultado_en)}.` };
}

/** Lo que lee el usuario nunca nombra la fuente (ni el gobierno ni su visor). */
export const SIN_FUENTE = "No se pudo consultar la fuente externa en este momento.";
const SIN_EXPEDIENTE = "No se pudo traer el expediente completo. Se muestra lo que da el mapa; puedes intentar más tarde con \"Actualizar información\".";

/** Trae el expediente de una clave ya ubicada en el mapa y lo guarda. */
async function traerYGuardar(quien: Quien, capa: PredioDeCapa & { clave: string }, modo: "consulta" | "actualizar"): Promise<Resultado> {
  const exp = await consultarExpediente(capa.clave);
  const limpio = exp.ok ? limpiarExpediente(exp.json) : null;
  if (!limpio) {
    await registrarFalla(quien, "expediente");
    const err = await guardar(quien, { clave: capa.clave, geometria: capa.geometria, datos: capa.datos, expediente: "pendiente", privados: null, modo });
    if (err) return { ok: false, error: err, geometria: capa.geometria };
    const f = await ficha(capa.clave);
    if (!f) return { ok: false, error: SIN_EXPEDIENTE, geometria: capa.geometria };
    return f.expediente === "completo" ? guardado(f, SIN_FUENTE) : { ok: true, ficha: f, aviso: SIN_EXPEDIENTE };
  }
  const err = await guardar(quien, { clave: capa.clave, geometria: capa.geometria, datos: { ...limpio.datos, ...capa.datos }, expediente: "completo",
    privados: limpio.privados, modo });
  if (err) return { ok: false, error: err, geometria: capa.geometria };
  const f = await ficha(capa.clave);
  return f ? { ok: true, ficha: f, aviso: null } : { ok: false, error: "No se pudo leer la ficha." };
}

/** Picar el mapa: primero un predio guardado que contenga el punto; si no, IDECATQ. */
export async function consultarPunto(quien: Quien, lat: number, lon: number): Promise<Resultado> {
  if (!enQueretaro(lat, lon)) return { ok: false, error: "Ese punto está fuera de Querétaro." };
  const supabase = await crearClienteServidor();
  const { data: candidatos, error } = await supabase.rpc("catastro_candidatos", { p_lat: lat, p_lon: lon });
  if (error) return { ok: false, error: error.message };
  const encontrado = ((candidatos ?? []) as { clave: string; geometria: unknown }[])
    .find((c) => { const g = geometriaValida(c.geometria); return g && contiene(g, [lon, lat]); });
  const previa = encontrado ? await ficha(encontrado.clave) : null;
  if (previa && vigente(previa)) return { ok: true, ficha: previa, aviso: null };

  const impide = await impedimento();
  if (impide) return previa ? guardado(previa, impide) : { ok: false, error: impide };

  const mapa = await consultarMapa(lat, lon);
  if (!mapa.ok) {
    await registrarFalla(quien, "mapa");
    return previa ? guardado(previa, SIN_FUENTE) : { ok: false, error: `${SIN_FUENTE} Intenta en unos minutos.` };
  }
  if (!mapa.predio) return { ok: false, error: "Ahí no hay un predio en el catastro." };
  if (!mapa.predio.clave) {
    return { ok: false, error: "Ese polígono no tiene clave catastral (puede ser una vialidad, plaza o área común).", geometria: mapa.predio.geometria };
  }
  // Puede estar guardado aunque su caja no se hallara (p. ej. guardado sin polígono).
  const porClave = previa?.clave === mapa.predio.clave ? previa : await ficha(mapa.predio.clave);
  if (porClave && vigente(porClave) && porClave.geometria) return { ok: true, ficha: porClave, aviso: null };
  return traerYGuardar(quien, { ...mapa.predio, clave: mapa.predio.clave }, "consulta");
}

/** Buscar por clave, o "Actualizar desde IDECATQ" (forzar). */
export async function consultarClave(quien: Quien, texto: string, forzar: boolean): Promise<Resultado> {
  const clave = normalizarClave(texto);
  if (!clave) return { ok: false, error: "La clave catastral lleva 15 dígitos y empieza con el municipio (01 a 18)." };
  const previa = await ficha(clave);
  if (previa && !forzar && vigente(previa)) return { ok: true, ficha: previa, aviso: null };

  const impide = await impedimento();
  if (impide) return previa ? guardado(previa, impide) : { ok: false, error: impide };

  const exp = await consultarExpediente(clave);
  const limpio = exp.ok ? limpiarExpediente(exp.json) : null;
  if (!limpio) {
    await registrarFalla(quien, "expediente");
    // Con el punto guardado se puede, al menos, refrescar la capa del mapa.
    if (previa?.latitud && previa.longitud) {
      const mapa = await consultarMapa(previa.latitud, previa.longitud);
      if (mapa.ok && mapa.predio?.clave === clave) {
        await guardar(quien, { clave, geometria: mapa.predio.geometria, datos: mapa.predio.datos, expediente: "pendiente", privados: null, modo: forzar ? "actualizar" : "consulta" });
      }
      const f = (await ficha(clave)) ?? previa;
      return { ok: true, ficha: f, aviso: f.expediente === "pendiente" ? SIN_EXPEDIENTE : `${SIN_EXPEDIENTE} Lo demás es lo guardado del ${fechaCorta(f.consultado_en)}.` };
    }
    return { ok: false, error: `${SIN_FUENTE} Si persiste, revisa que la clave sea correcta.` };
  }

  // El polígono: con el centroide del expediente se pregunta al mapa.
  let geometria: Geometria | null = null;
  let datosCapa: Datos = {};
  const c = centroideDelExpediente(exp.ok ? exp.json : null);
  if (c) {
    const [lon, lat] = aLonLat(c[0], c[1]);
    const mapa = await consultarMapa(lat, lon);
    if (!mapa.ok) await registrarFalla(quien, "mapa");
    else if (mapa.predio?.clave === clave) {
      geometria = mapa.predio.geometria;
      datosCapa = mapa.predio.datos;
    }
  }
  const err = await guardar(quien, { clave, geometria, datos: { ...limpio.datos, ...datosCapa }, expediente: "completo", privados: limpio.privados,
    modo: forzar ? "actualizar" : "consulta" });
  if (err) return previa ? guardado(previa, err) : { ok: false, error: err };
  const f = await ficha(clave);
  return f ? { ok: true, ficha: f, aviso: f.geometria ? null : "No llegó el polígono de esa clave; la liga de Maps no está disponible." }
    : { ok: false, error: "No se pudo leer la ficha." };
}
