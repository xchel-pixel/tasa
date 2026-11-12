"use server";

import { revalidatePath } from "next/cache";
import { detectarBusqueda, enQueretaro, nombreSubdireccion, SUBDIRECCIONES, type TipoDeBusqueda } from "@/lib/catastro/busqueda";
import { buscarFolioReal } from "@/lib/catastro/idecatq";
import { expandirLigaCorta } from "@/lib/catastro/ligas";
import { consultarClave, consultarPunto, SIN_FUENTE, type Quien, type Resultado } from "@/lib/catastro/servicio";
import { TODOS_LOS_ROLES, tengoHerramienta } from "@/lib/herramientas";
import { exigirRol } from "@/lib/sesion";
import { crearClienteServidor, verComoId } from "@/lib/supabase/server";

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

/** El resultado de la caja de búsqueda: el de la consulta, más el punto buscado (para el pin) y si faltó el folio. */
export type ResultadoBusqueda = Resultado & { punto?: { lat: number; lon: number }; folioNoEncontrado?: boolean };

/** El registro de la búsqueda (0088): solo el tipo, nunca lo escrito. Nunca detiene la búsqueda. */
async function registrar(tipo: TipoDeBusqueda, origen: "fuente" | "guardado" | null, resultado: "ok" | "sin_predio" | "falla",
  subdireccion: string | null = null) {
  if (await verComoId()) return;
  const supabase = await crearClienteServidor();
  const { error } = await supabase.rpc("catastro_registrar_busqueda", { p_tipo: tipo, p_origen: origen, p_resultado: resultado,
    p_referencia: subdireccion });
  if (error) console.warn(`Registro de búsqueda: ${error.message}`);
}

const resultadoDe = (r: Resultado): "ok" | "sin_predio" => (r.ok ? "ok" : "sin_predio");

async function enPunto(q: Quien, tipo: TipoDeBusqueda, lat: number, lon: number): Promise<ResultadoBusqueda> {
  const punto = { lat, lon };
  if (!enQueretaro(lat, lon)) {
    await registrar(tipo, null, "sin_predio");
    return { ok: false, error: "Ese punto está fuera de Querétaro.", punto };
  }
  const r = await consultarPunto(q, lat, lon);
  await registrar(tipo, null, resultadoDe(r));
  return { ...r, punto };
}

/** Folio real: primero lo guardado en Tasa; si no, la fuente (sin cupo del mes, con el tope del día). Solo se usa la clave. */
async function porFolio(q: Quien, folio: string, subdireccion: string): Promise<ResultadoBusqueda> {
  const supabase = await crearClienteServidor();
  const { data: guardada } = await supabase.rpc("catastro_folio_guardado", { p_folio: folio });
  if (typeof guardada === "string" && guardada) {
    await registrar("folio", "guardado", "ok", subdireccion);
    return consultarClave(q, guardada, false);
  }
  if (await verComoId()) return { ok: false, error: "Modo solo lectura: en \"ver como\" no se consulta nada fuera de Tasa." };
  const { data: impide, error } = await supabase.rpc("catastro_pedir_busqueda_folio");
  if (error) return { ok: false, error: error.message };
  if (impide) return { ok: false, error: String(impide) };
  const r = await buscarFolioReal(folio, subdireccion);
  await registrar("folio", "fuente", !r.ok ? "falla" : r.clave ? "ok" : "sin_predio", subdireccion);
  if (!r.ok) return { ok: false, error: `${SIN_FUENTE} Intenta en unos minutos.` };
  if (!r.clave) {
    return { ok: false, folioNoEncontrado: true,
      error: `El folio ${folio} no está en la subdirección ${nombreSubdireccion(subdireccion)}. Búscalo en otra subdirección, o por clave, domicilio o en el mapa.` };
  }
  return consultarClave(q, r.clave, false);
}

/** La caja única: reconoce el tipo y busca. El domicilio lo resuelve la pantalla (sugerencias); aquí no llega. */
export async function buscarEnMapa(texto: string, subdireccion: string): Promise<ResultadoBusqueda> {
  const q = await quien();
  if (!q) return NO;
  const b = detectarBusqueda(String(texto ?? "").slice(0, 2000));
  const sub = SUBDIRECCIONES.some((s) => s.clave === subdireccion) ? subdireccion : "14";
  let r: ResultadoBusqueda;
  switch (b.tipo) {
    case "vacio":
      return { ok: false, error: "Escribe una clave catastral, un domicilio, coordenadas, una liga de Google Maps o un folio real." };
    case "clave_invalida":
      return { ok: false, error: "No reconozco eso. La clave catastral lleva 15 dígitos y empieza con el municipio (01 a 18); un folio real, solo dígitos." };
    case "liga_sin_punto":
      return { ok: false, error: "Esa liga de Google Maps no trae una ubicación. En Maps, toca el lugar y comparte esa liga." };
    case "domicilio":
      return { ok: false, error: "Elige una de las sugerencias del domicilio." };
    case "clave":
      r = await consultarClave(q, b.clave, false);
      await registrar("clave", null, resultadoDe(r));
      break;
    case "coordenadas":
      r = await enPunto(q, "coordenadas", b.lat, b.lon);
      break;
    case "liga_google":
      r = await enPunto(q, "liga_google", b.lat, b.lon);
      break;
    case "liga_corta": {
      const p = await expandirLigaCorta(b.url);
      if (!p) {
        await registrar("liga_google", null, "falla");
        return { ok: false, error: "No se pudo abrir esa liga de Google Maps. Copia las coordenadas del lugar o busca el domicilio." };
      }
      r = await enPunto(q, "liga_google", p.lat, p.lon);
      break;
    }
    case "folio":
      r = await porFolio(q, b.folio, sub);
      break;
  }
  revalidatePath("/mapa-catastral");
  return r;
}

/** Elegir una sugerencia de domicilio: solo se registra que hubo una búsqueda de domicilio (sin el texto). */
export async function registrarBusquedaDomicilio(): Promise<void> {
  const q = await quien();
  if (q) await registrar("domicilio", null, "ok");
}
