import Link from "next/link";
import { misHerramientas, type ClaveHerramienta } from "@/lib/herramientas";
import type { Persona } from "@/lib/sesion";

/**
 * La cuadrícula de la portada: cada tarjeta abre su propia pantalla. Primero lo de su rol (el
 * comisionista, "Nueva solicitud" y su panel; administración, sus pantallas de operación), después las
 * herramientas activas del catálogo (0053/0056) y al final lo que viene, apagado con "Próximamente".
 */

const RUTA: Partial<Record<ClaveHerramienta, string>> = {
  mi_tarjeta: "/tarjeta",
  para_tus_clientes: "/para-tus-clientes",
  invitar: "/invitar",
  calculadora_traslado: "/calculadora",
  mapa_catastral: "/mapa-catastral",
};

const DETALLE: Partial<Record<ClaveHerramienta, string>> = {
  mi_tarjeta: "Tu tarjeta digital para compartir",
  para_tus_clientes: "Tu liga y QR para que te pidan cotización",
  invitar: "Tu liga para invitar a otros aliados",
  calculadora_traslado: "Gastos de escrituración en Querétaro",
  mapa_catastral: "Pica un terreno y ve su clave y su ficha",
};

const PROXIMAMENTE = [
  { titulo: "Estimación rápida", detalle: "Valor aproximado en minutos" },
  { titulo: "OV express", detalle: "Opinión de valor revisada" },
];

type Mosaico = { href: string; titulo: string; detalle: string };

function delRol(persona: Persona): Mosaico[] {
  if (persona.rol === "comisionista") {
    return [
      { href: "/solicitudes/nueva", titulo: "Nueva solicitud", detalle: "Cotización o trámite para tu cliente" },
      { href: "/panel", titulo: "Panel de comisiones", detalle: "Tus trabajos, tu nivel y tus referidos" },
      { href: "/mi-uso", titulo: "Mi uso", detalle: "Tus cupos del mes y tus consultas" },
    ];
  }
  if (persona.rol === "equipo") return [{ href: "/panel", titulo: "Mi panel", detalle: "Los trámites de tu liga" }];
  const staff = persona.rol === "admin_org" || persona.rol === "finanzas";
  return [
    { href: "/admin", titulo: "Panel de administración", detalle: "Pagos, solicitudes, alertas y comisiones" },
    { href: "/admin/tramites", titulo: "Trámites", detalle: "Todos los trabajos" },
    { href: "/admin/comisionistas", titulo: "Comisionistas", detalle: "Fichas, niveles y estado de cuenta" },
    ...(staff ? [{ href: "/admin/cierres", titulo: "Cierres", detalle: "Cierre mensual de comisiones" }] : []),
    ...(staff ? [{ href: "/admin/estadisticas", titulo: "Estadísticas", detalle: "Uso de herramientas, embudo y salud de la fuente" }] : []),
    ...(persona.rol === "admin_org" ? [{ href: "/admin/configuracion", titulo: "Catálogos y ajustes", detalle: "Configuración de la organización" }] : []),
    ...(persona.rol === "admin_org" ? [{ href: "/admin/accesos", titulo: "Accesos", detalle: "Estatus, sesiones e historial de cada persona" }] : []),
  ];
}

export async function Lanzador({ persona }: { persona: Persona }) {
  const herramientas = (await misHerramientas())
    .filter((h) => RUTA[h.clave])
    .map((h) => ({ href: RUTA[h.clave]!, titulo: h.nombre, detalle: DETALLE[h.clave] ?? "" }));
  const mosaicos = [...delRol(persona), ...herramientas];
  const principal = persona.rol === "comisionista" ? "/solicitudes/nueva" : "/admin";

  return (
    <section aria-label="Herramientas" className="mt-5">
      <ul className="grid grid-cols-2 gap-3 md:grid-cols-3">
        {mosaicos.map((m) => (
          <li key={m.href}>
            <Link href={m.href}
              className={`flex h-full min-h-24 flex-col justify-between rounded-xl px-4 py-3 ${
                m.href === principal ? "bg-primario text-sobre-primario" : "border border-linea bg-alterno"}`}>
              <span className="font-bold leading-tight">{m.titulo}</span>
              <span className={`mt-2 text-[0.8125rem] leading-5 ${m.href === principal ? "opacity-90" : "text-secundario"}`}>{m.detalle}</span>
            </Link>
          </li>
        ))}
        {PROXIMAMENTE.map((p) => (
          <li key={p.titulo} className="flex min-h-24 flex-col justify-between rounded-xl border border-dashed border-linea px-4 py-3 text-secundario">
            <span className="font-bold leading-tight">{p.titulo}</span>
            <span className="mt-2 text-[0.8125rem] leading-5">
              {p.detalle}
              <span className="mt-1 block w-fit rounded-full bg-alterno px-2 py-0.5 text-[0.75rem] font-semibold">Próximamente</span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
