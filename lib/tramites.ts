import type { EstadoPago, EstatusPublico } from "@/lib/estatus";
import { crearClienteServidor, oExplota } from "@/lib/supabase/server";

/**
 * Los trámites como los ve cualquiera que les da seguimiento: el comisionista los suyos, el
 * equipo lo de su liga y el staff todos. Mismo dato y mismo componente para todos: lo que
 * cambia es qué filas trae, y eso lo decide el RLS (más `ligaDe` para "Mis trámites" del staff,
 * que por RLS ve todo).
 */

export type Origen = "comisionista" | "liga" | "equipo";

export type Tramite = {
  id: string;
  folio: string | null;
  estado: "solicitada" | "cotizada" | "vencida" | "tramite" | "cancelada";
  estatus_publico: EstatusPublico;
  cliente_nombre: string;
  inmueble_clave_catastral: string | null;
  monto_total: number;
  creado_en: string;
  /** Día en que pasó a "Entregado" (de Tasa o de Notion); nulo si no se ha entregado. */
  fecha_entrega: string | null;
  /** Día en que quedó pagado. */
  pagado_en: string | null;
  servicio_id: string;
  servicio: string;
  marca_id: string | null;
  marca: string | null;
  quiere_tramite: boolean;
  /** Comisionista desde su cuenta, liga de comisionista o liga de equipo/admin (sin comisión). */
  origen: Origen;
  /** Quien la trajo: el comisionista o el dueño de la liga; nulo si quedó de la organización. */
  dueno_id: string | null;
  dueno: string | null;
  confirmado: number;
  por_confirmar: number;
};

type Fila = {
  id: string;
  folio: string | null;
  estado: Tramite["estado"];
  estatus_publico: EstatusPublico;
  cliente_nombre: string;
  inmueble_clave_catastral: string | null;
  monto_total: string | number;
  creado_en: string;
  fecha_entrega: string | null;
  pagado_en: string | null;
  servicio_id: string;
  marca_id: string | null;
  origen: string;
  quiere_tramite: boolean;
  comisionista_id: string | null;
  liga_de: string | null;
  liga_sin_dueno: boolean;
  servicios: { nombre: string } | null;
  marcas: { nombre: string } | null;
  pagos: { monto: string | number; estado: EstadoPago }[];
  comisionistas?: { personas: { nombre: string } | null } | null;
  liga?: { nombre: string } | null;
};

const BASE =
  "id, folio, estado, estatus_publico, cliente_nombre, inmueble_clave_catastral, monto_total, creado_en, fecha_entrega, pagado_en, " +
  "servicio_id, marca_id, origen, quiere_tramite, comisionista_id, liga_de, liga_sin_dueno, " +
  "servicios(nombre), marcas(nombre), pagos(monto, estado)";
// Los nombres de quién la trajo solo los pide quien opera: el comisionista no lee personas ajenas.
const CON_NOMBRES =
  BASE + ", comisionistas(personas!comisionistas_persona_id_fkey(nombre)), liga:personas!solicitudes_liga_de_fkey(nombre)";

const sumar = (pagos: Fila["pagos"], estado: EstadoPago) =>
  pagos.filter((p) => p.estado === estado).reduce((t, p) => t + Number(p.monto), 0);

function aTramite(f: Fila): Tramite {
  const deLiga = f.origen === "liga_cliente";
  const dueno_id = deLiga ? (f.liga_sin_dueno ? null : f.liga_de) : f.comisionista_id;
  return {
    id: f.id,
    folio: f.folio,
    estado: f.estado,
    estatus_publico: f.estatus_publico,
    cliente_nombre: f.cliente_nombre,
    inmueble_clave_catastral: f.inmueble_clave_catastral,
    monto_total: Number(f.monto_total),
    creado_en: f.creado_en,
    fecha_entrega: f.fecha_entrega,
    pagado_en: f.pagado_en,
    servicio_id: f.servicio_id,
    servicio: f.servicios?.nombre ?? "",
    marca_id: f.marca_id,
    marca: f.marcas?.nombre ?? null,
    quiere_tramite: f.quiere_tramite,
    origen: !deLiga ? "comisionista" : f.comisionista_id ? "liga" : "equipo",
    dueno_id,
    dueno: deLiga ? (f.liga_sin_dueno ? null : f.liga?.nombre ?? null) : f.comisionistas?.personas?.nombre ?? null,
    confirmado: sumar(f.pagos, "confirmado"),
    por_confirmar: sumar(f.pagos, "reportado"),
  };
}

/**
 * Sin `ligaDe`, todo lo que el RLS deja ver (el comisionista: lo suyo; el staff: todo). Con
 * `ligaDe`, solo lo atribuido a la liga de esa persona ("Mis trámites" del equipo y del staff).
 */
export async function leerTramites({ ligaDe, conNombres = false }: { ligaDe?: string; conNombres?: boolean } = {}): Promise<Tramite[]> {
  const supabase = await crearClienteServidor();
  let consulta = supabase.from("solicitudes").select(conNombres ? CON_NOMBRES : BASE);
  if (ligaDe) consulta = consulta.eq("liga_de", ligaDe).eq("liga_sin_dueno", false);
  const filas = oExplota(
    await consulta.order("creado_en", { ascending: false }).limit(3000).returns<Fila[]>(),
    "los trámites"
  );
  return (filas ?? []).map(aTramite);
}

/** Lo que falta por cobrar al cliente (cero si no hay trabajo o ya se cubrió). */
export const saldoDe = (t: Tramite) =>
  t.estado === "tramite" && t.estatus_publico !== "pagado" ? Math.max(0, t.monto_total - t.confirmado) : 0;

export const pendienteDeFolio = (t: Tramite) => t.estado === "tramite" && !t.folio && t.estatus_publico !== "cancelada";

/**
 * Los grupos en que se muestran, en este orden. "Pagado" va con entregados: el trabajo ya no
 * se mueve para nadie (igual que antes en la vista del comisionista).
 */
export const GRUPOS = [
  { clave: "por_cotizar", titulo: "Por cotizar", estatus: ["solicitada"], cerrado: false },
  { clave: "cotizados", titulo: "Cotizados", estatus: ["cotizada"], cerrado: false },
  { clave: "aceptados", titulo: "Aceptados", estatus: ["aceptada", "visita_agendada"], cerrado: false },
  { clave: "en_elaboracion", titulo: "En elaboración", estatus: ["en_elaboracion"], cerrado: false },
  { clave: "en_revision", titulo: "En revisión", estatus: ["en_revision"], cerrado: false },
  { clave: "entregados", titulo: "Entregados", estatus: ["entregado", "pagado"], cerrado: true },
  { clave: "cancelados", titulo: "Cancelados", estatus: ["cancelada", "vencida"], cerrado: true },
] as const satisfies readonly { clave: string; titulo: string; estatus: readonly EstatusPublico[]; cerrado: boolean }[];

export type ClaveGrupo = (typeof GRUPOS)[number]["clave"];

export const grupoDe = (t: Tramite): ClaveGrupo =>
  GRUPOS.find((g) => (g.estatus as readonly string[]).includes(t.estatus_publico))?.clave ?? "por_cotizar";

export const enCurso = (t: Tramite) => !GRUPOS.find((g) => g.clave === grupoDe(t))!.cerrado;

/** Orden dentro de un grupo: primero quien ya pidió el trámite, luego lo más reciente. */
export const ordenar = (a: Tramite, b: Tramite) =>
  Number(b.quiere_tramite) - Number(a.quiere_tramite) || b.creado_en.localeCompare(a.creado_en);
