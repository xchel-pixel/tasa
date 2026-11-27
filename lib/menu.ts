import type { ClaveHerramienta, Herramienta } from "@/lib/herramientas";
import type { Persona } from "@/lib/sesion";

/**
 * El menú principal (dic-2026): cinco secciones como máximo, por rol, iguales en el celular (abajo) y en la computadora
 * (arriba, con las pantallas de la sección debajo). Cada pantalla de siempre sigue en su ruta: la sección solo la agrupa
 * (`prefijos`), así que ninguna liga ni el humo se rompen.
 *
 *   comisionista   Inicio · Mis trabajos · Herramientas · Agenda · Mi cuenta
 *   admin_org      Hoy · Administración · Herramientas · Agenda · Ajustes
 *   finanzas y admin_marca   Hoy · Administración · Herramientas · Agenda
 *   equipo         Inicio · Mi panel · Herramientas · Agenda
 *
 * La Agenda solo sale si la persona la tiene en el catálogo (apagada, no se ve).
 */

export type IconoMenu = "inicio" | "hoy" | "trabajos" | "admin" | "herramientas" | "agenda" | "cuenta" | "ajustes";

/** Una pantalla dentro de una sección: tarjeta en su página y pestaña en la computadora. */
export type Pantalla = { href: string; titulo: string; detalle: string; grupo?: string };

export type Seccion = {
  id: "inicio" | "hoy" | "trabajos" | "administracion" | "panel" | "herramientas" | "agenda" | "cuenta" | "ajustes";
  texto: string;
  /** Lo que cabe abajo en el celular ("Admin"). */
  corto?: string;
  href: string;
  icono: IconoMenu;
  /** Rutas que cuentan como de esta sección (además de `href`). "=/" es solo la portada. */
  prefijos: string[];
  pantallas: Pantalla[];
};

const tiene = (h: Herramienta[], c: ClaveHerramienta) => h.some((x) => x.clave === c);

/** Las pantallas de "Mis trabajos" del comisionista. */
function misTrabajos(h: Herramienta[]): Pantalla[] {
  return [
    { href: "/solicitudes/nueva", titulo: "Solicitar", detalle: "Cotización o trámite para tu cliente" },
    { href: "/panel", titulo: "Seguimiento", detalle: "Tus trabajos, tu nivel y en qué va cada uno" },
    { href: "/estado-de-cuenta", titulo: "Comisiones", detalle: "Lo cobrado, lo por cobrar y tus cierres" },
    ...(tiene(h, "invitar") ? [{ href: "/invitar", titulo: "Referidos", detalle: "Tu liga para invitar aliados y lo que te dejan" }] : []),
  ];
}

/** Las pantallas de "Administración", por rol (las mismas que cada pantalla ya permite). */
function administracion(rol: Persona["rol"]): Pantalla[] {
  const staff = rol === "admin_org" || rol === "finanzas";
  const admin = rol === "admin_org";
  const p: (Pantalla | false)[] = [
    { href: "/admin/tramites", titulo: "Trámites", detalle: "Todos los trabajos y su estatus", grupo: "Operación" },
    { href: "/admin/solicitudes", titulo: "Por cotizar", detalle: "Solicitudes que esperan cotización", grupo: "Operación" },
    { href: "/admin/pagos", titulo: "Pagos por confirmar", detalle: "Lo que dicen que ya pagaron", grupo: "Operación" },
    staff && { href: "/admin/paquetes", titulo: "Paquetes", detalle: "Saldos y vencimientos de los paquetes", grupo: "Operación" },
    staff && { href: "/admin/cierres", titulo: "Panel de comisiones", detalle: "Cierre del mes y lo que se debe", grupo: "Comisionistas" },
    staff && { href: "/admin/comisiones", titulo: "Comisiones por pagar", detalle: "Lo que toca pagar y sus facturas", grupo: "Comisionistas" },
    { href: "/admin/comisionistas", titulo: "Comisionistas", detalle: "Fichas, niveles y estado de cuenta", grupo: "Comisionistas" },
    staff && { href: "/admin/referidos", titulo: "Referidos", detalle: "Quién invitó a quién y sus bonos", grupo: "Comisionistas" },
    staff && { href: "/admin/altas", titulo: "Solicitudes de alta", detalle: "Quién pidió entrar", grupo: "Comisionistas" },
    staff && { href: "/admin/estadisticas", titulo: "Estadísticas", detalle: "Uso de herramientas y salud de la fuente", grupo: "Control" },
    staff && { href: "/admin/reportes", titulo: "Reportes", detalle: "Cifras del mes para descargar", grupo: "Control" },
    { href: "/admin/alertas", titulo: "Alertas", detalle: "Lo abierto y lo ya resuelto", grupo: "Control" },
    admin && { href: "/admin/bitacora", titulo: "Bitácora", detalle: "Quién hizo qué y cuándo", grupo: "Control" },
    admin && { href: "/admin/accesos", titulo: "Accesos", detalle: "Estatus, sesiones y equipos de cada persona", grupo: "Control" },
  ];
  return p.filter((x): x is Pantalla => Boolean(x));
}

const AJUSTES: Pantalla[] = [
  { href: "/ajustes", titulo: "Ajustes", detalle: "Textos, conector, parámetros y folios" },
  { href: "/admin/configuracion", titulo: "Configuración", detalle: "Catálogos y herramientas de la organización" },
  { href: "/admin/niveles", titulo: "Niveles", detalle: "Niveles de comisión y sus porcentajes" },
  { href: "/admin/equipo", titulo: "Equipo", detalle: "Quién opera y con qué rol" },
];

function miCuenta(persona: Persona): Pantalla[] {
  return [
    { href: "/perfil", titulo: "Mis datos", detalle: "Tu perfil, tus datos fiscales y bancarios" },
    { href: "/paquetes", titulo: "Mis paquetes", detalle: "Tu crédito, su vigencia y tus movimientos" },
    { href: "/mi-uso", titulo: "Mi uso", detalle: "Tus cupos del mes y tus consultas" },
    { href: `/privacidad?org=${encodeURIComponent(persona.organizacion.slug)}`, titulo: "Privacidad", detalle: "Cómo cuidamos tus datos" },
  ];
}

const HERRAMIENTAS: Omit<Seccion, "pantallas"> = {
  id: "herramientas", texto: "Herramientas", href: "/herramientas", icono: "herramientas",
  prefijos: ["/herramientas", "/mapa-catastral", "/calculadora", "/tarjeta", "/para-tus-clientes"],
};
const AGENDA: Omit<Seccion, "pantallas"> = { id: "agenda", texto: "Agenda", href: "/agenda", icono: "agenda", prefijos: ["/agenda"] };

export function seccionesDe(persona: Persona, h: Herramienta[]): Seccion[] {
  const agenda = tiene(h, "agenda") ? [{ ...AGENDA, pantallas: [] }] : [];
  const herramientas = { ...HERRAMIENTAS, pantallas: [] };
  if (persona.rol === "comisionista") {
    return [
      { id: "inicio", texto: "Inicio", href: "/", icono: "inicio", prefijos: ["=/"], pantallas: [] },
      { id: "trabajos", texto: "Mis trabajos", href: "/mis-trabajos", icono: "trabajos",
        prefijos: ["/mis-trabajos", "/solicitudes", "/panel", "/estado-de-cuenta", "/trabajos", "/invitar"], pantallas: misTrabajos(h) },
      herramientas,
      ...agenda,
      { id: "cuenta", texto: "Mi cuenta", href: "/mi-cuenta", icono: "cuenta", prefijos: ["/mi-cuenta", "/perfil", "/paquetes", "/mi-uso", "/terminos"],
        pantallas: miCuenta(persona) },
    ];
  }
  if (persona.rol === "equipo") {
    return [
      { id: "inicio", texto: "Inicio", href: "/", icono: "inicio", prefijos: ["=/"], pantallas: [] },
      { id: "panel", texto: "Mi panel", href: "/panel", icono: "trabajos", prefijos: ["/panel", "/mis-tramites", "/trabajos", "/invitar"], pantallas: [] },
      herramientas,
      ...agenda,
    ];
  }
  return [
    { id: "hoy", texto: "Hoy", href: "/admin", icono: "hoy", prefijos: ["=/", "=/admin"], pantallas: [] },
    { id: "administracion", texto: "Administración", corto: "Admin", href: "/administracion", icono: "admin",
      prefijos: ["/administracion", "/admin/", "/mis-tramites", "/trabajos", "/invitar"], pantallas: administracion(persona.rol) },
    herramientas,
    ...agenda,
    ...(persona.rol === "admin_org"
      ? [{ id: "ajustes" as const, texto: "Ajustes", href: "/ajustes", icono: "ajustes" as const,
           prefijos: ["/ajustes", "/admin/configuracion", "/admin/niveles", "/admin/equipo", "/admin/catalogos", "/admin/testimonios"], pantallas: AJUSTES }]
      : []),
  ];
}

/** ¿La ruta es de esta sección? Gana el prefijo más largo (p. ej. /admin/niveles es de Ajustes, no de Administración). */
export function seccionActiva(secciones: Seccion[], ruta: string): Seccion["id"] | null {
  let mejor: { id: Seccion["id"]; largo: number } | null = null;
  for (const s of secciones) {
    for (const p of [s.href === "/" ? "=/" : s.href, ...s.prefijos]) {
      const exacto = p.startsWith("=");
      const base = exacto ? p.slice(1) : p;
      const coincide = exacto ? ruta === base : ruta === base || ruta.startsWith(base.endsWith("/") ? base : `${base}/`) || (base.endsWith("/") && ruta.startsWith(base));
      if (coincide && (!mejor || base.length > mejor.largo)) mejor = { id: s.id, largo: base.length };
    }
  }
  return mejor?.id ?? null;
}
