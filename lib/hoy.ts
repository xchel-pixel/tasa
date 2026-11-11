import { comisionesPorPagar, type PorPagar } from "@/lib/comisiones";
import { mesTitulo, pesos } from "@/lib/formato";
import { pendientesDelPanel } from "@/lib/panel";
import { esStaff, type Persona } from "@/lib/sesion";
import { crearClienteServidor } from "@/lib/supabase/server";

/**
 * "Hoy" (fase 1 de la reorganización): TODO lo que espera una acción de administración, en una sola lista. La usan la
 * página Hoy (/admin) y la franja de la portada: antes eran dos listas que no coincidían. Lo que está en cero no sale.
 * admin_marca ve lo de sus marcas (el RLS filtra) y nada del dinero de comisiones, paquetes ni actividad.
 */

export type Grupo = "confirmar" | "decidir" | "vigilar";

export type Tarea = { grupo: Grupo; texto: string; detalle?: string; cuenta?: number; href: string; urgente?: boolean };

export const GRUPOS: Record<Grupo, { titulo: string; para: string }> = {
  confirmar: { titulo: "Por confirmar", para: "Dinero que alguien dice que ya pagó: revisa que llegó." },
  decidir: { titulo: "Por decidir", para: "Algo espera tu respuesta para avanzar." },
  vigilar: { titulo: "Para vigilar", para: "No es urgente, pero conviene revisarlo." },
};

const TIPOS_CUPO = ["cupo_agotado"];
const TIPOS_FUENTE = ["catastro"];
const TIPOS_CREDITO = ["credito_no_aplicado"];
const TIPOS_SIN_PAGINA = ["notion_sin_pagina"];
const PREFIJO_SIN_PAGINA = "Comisionista sin página de Notion: ";

export async function tareasDeHoy(persona: Persona): Promise<Tarea[]> {
  const staff = esStaff(persona);
  const supabase = await crearClienteServidor();
  const [p, porPagar, paquetes, alertas, conector, actividad, estimados] = await Promise.all([
    pendientesDelPanel(),
    staff ? comisionesPorPagar() : Promise.resolve([] as PorPagar[]),
    staff ? supabase.from("compras_paquete").select("id", { count: "exact", head: true }).eq("estado", "por_pagar") : Promise.resolve({ count: 0 }),
    supabase.from("alertas").select("tipo, mensaje").is("resuelta_en", null).returns<{ tipo: string; mensaje: string | null }[]>(),
    supabase.from("conectores").select("estado, ultimo_error").eq("activo", true).maybeSingle<{ estado: string; ultimo_error: string | null }>(),
    staff ? supabase.rpc("inactividad_org") : Promise.resolve({ data: [] }),
    staff
      ? supabase.from("solicitudes").select("id", { count: "exact", head: true }).eq("estado", "tramite").eq("honorario_tipo", "estimado").is("honorario_final_en", null)
      : Promise.resolve({ count: 0 }),
  ]);

  const tipos = (alertas.data ?? []).map((a) => a.tipo);
  const cuenta = (lista: string[]) => tipos.filter((t) => lista.includes(t)).length;
  const otras = tipos.filter((t) => ![...TIPOS_CUPO, ...TIPOS_FUENTE, ...TIPOS_CREDITO, ...TIPOS_SIN_PAGINA].includes(t)).length;
  // "Comisionista sin página de Notion: Nombre. …" (0084): los nombres, para verlos sin abrir Alertas.
  const sinPagina = (alertas.data ?? []).filter((a) => TIPOS_SIN_PAGINA.includes(a.tipo))
    .map((a) => (a.mensaje ?? "").split(PREFIJO_SIN_PAGINA)[1]?.split(". ")[0]).filter((n): n is string => !!n);
  const act = (actividad.data ?? []) as { estado: string }[];
  const porInactivarse = act.filter((a) => a.estado === "por_vencer").length;
  const inactivas = act.filter((a) => a.estado === "inactiva").length;
  const vencidas = porPagar.filter((x) => x.vencido);
  const sinFactura = porPagar.filter((x) => x.esperando_factura).length;

  const t: Tarea[] = [
    { grupo: "confirmar", texto: "Pagos de clientes por confirmar", cuenta: p.pagos, href: "/admin/pagos" },
    ...(staff ? [{ grupo: "confirmar" as const, texto: "Pagos de paquetes por confirmar", cuenta: paquetes.count ?? 0, href: "/admin/paquetes" }] : []),
    { grupo: "decidir", texto: "Solicitudes por cotizar", cuenta: p.solicitudes, href: "/admin/solicitudes",
      detalle: p.deLiga > 0 ? `${p.deLiga === 1 ? "1 llegó" : `${p.deLiga} llegaron`} por liga de cliente` : undefined },
    ...(staff ? [{ grupo: "decidir" as const, texto: "Solicitudes de alta", cuenta: p.altas, href: "/admin/altas" }] : []),
    { grupo: "decidir", texto: "Piden más cupo", cuenta: cuenta(TIPOS_CUPO), href: "/admin/alertas" },
    { grupo: "decidir", texto: "Créditos no aplicados", cuenta: cuenta(TIPOS_CREDITO), href: "/admin/alertas", detalle: "Pidieron pagar con crédito y no se pudo" },
    ...(persona.rol === "admin_org" ? [{ grupo: "decidir" as const, texto: "Testimonios por aprobar", cuenta: p.testimonios, href: "/admin/testimonios" }] : []),
    ...(staff && p.cierre.estado !== "aprobado"
      ? [{ grupo: "decidir" as const, texto: p.cierre.estado === "preparado" ? "Cierre por aprobar" : "Cierre por preparar",
          detalle: mesTitulo(p.cierre.mes), href: `/admin/cierres/${p.cierre.mes.slice(0, 7)}` }]
      : []),
    ...(vencidas.length
      ? [{ grupo: "decidir" as const, texto: "Comisiones vencidas", cuenta: vencidas.length, urgente: true, href: "/admin/comisiones",
          detalle: `${pesos(vencidas.reduce((s, x) => s + x.saldo, 0))} pasaron su día límite` }]
      : []),
    ...(sinFactura ? [{ grupo: "vigilar" as const, texto: "Comisiones que esperan factura", cuenta: sinFactura, href: "/admin/comisiones" }] : []),
    ...(conector.data?.estado === "error"
      ? [{ grupo: "vigilar" as const, texto: "El conector no está sincronizando", urgente: true, detalle: conector.data.ultimo_error ?? undefined,
          href: persona.rol === "admin_org" ? "/ajustes" : "/admin/alertas" }]
      : []),
    { grupo: "vigilar", texto: "Comisionistas sin página de Notion", cuenta: cuenta(TIPOS_SIN_PAGINA), urgente: true, href: "/admin/alertas",
      detalle: sinPagina.length ? sinPagina.join(", ") : "Lígalos en su ficha: mientras, Tasa no toca su relación en Notion" },
    { grupo: "vigilar", texto: "Fallas de la fuente catastral", cuenta: cuenta(TIPOS_FUENTE), href: "/admin/alertas" },
    ...(staff ? [
      { grupo: "vigilar" as const, texto: "Comisionistas por inactivarse", cuenta: porInactivarse, href: "/admin/estadisticas", detalle: "Sin trabajo cobrado en casi 6 meses" },
      { grupo: "vigilar" as const, texto: "Comisionistas inactivos", cuenta: inactivas, href: "/admin/estadisticas" },
      { grupo: "vigilar" as const, texto: "Estimados sin honorario final", cuenta: estimados.count ?? 0, href: "/admin/tramites?estimado=1" },
    ] : []),
    { grupo: "vigilar", texto: "Otras alertas", cuenta: otras, href: "/admin/alertas" },
  ];
  return t.filter((x) => x.cuenta === undefined || x.cuenta > 0);
}
