import Link from "next/link";
import { ListaHoy } from "@/components/lista-hoy";
import { SeccionesDeInicio } from "@/components/secciones-de-inicio";
import { esStaff, type Persona } from "@/lib/sesion";

/**
 * El panel abre con lo que toca hacer hoy, en orden: pagos por
 * confirmar primero. Cada renglón dice cuántos hay y lleva a su bandeja.
 * admin_marca ve lo de sus marcas (el RLS filtra) y nada del dinero de
 * comisiones, que mezcla marcas.
 */
export async function InicioStaff({ persona }: { persona: Persona }) {
  const staff = esStaff(persona);
  return (
    <>
      <ListaHoy persona={persona} />
      <p className="mt-4 text-[0.9375rem]">
        <Link href="/admin/alertas" className="toque font-semibold text-acento underline underline-offset-4">Ver todas las alertas</Link>
        <span className="text-secundario"> · también las ya resueltas</span>
      </p>

      <SeccionesDeInicio persona={persona} opera />

      <nav aria-label="Más" className="mt-6 flex flex-wrap gap-x-6 gap-y-2">
        <Enlace href="/admin/tramites">Trámites</Enlace>
        <Enlace href="/admin/comisionistas">Comisionistas</Enlace>
        {staff ? <Enlace href="/admin/referidos">Referidos</Enlace> : null}
        {staff ? <Enlace href="/admin/reportes">Reportes</Enlace> : null}
        {staff ? <Enlace href="/admin/estadisticas">Estadísticas</Enlace> : null}
        {staff ? <Enlace href="/admin/paquetes">Paquetes</Enlace> : null}
        {persona.rol === "admin_org" ? <Enlace href="/admin/configuracion">Configuración</Enlace> : null}
        {persona.rol === "admin_org" ? <Enlace href="/admin/catalogos">Catálogos</Enlace> : null}
        {staff ? <Enlace href="/admin/equipo">Equipo</Enlace> : null}
        {persona.rol === "admin_org" ? <Enlace href="/admin/accesos">Accesos</Enlace> : null}
        {persona.rol === "admin_org" ? <Enlace href="/admin/bitacora">Bitácora</Enlace> : null}
        {persona.rol === "admin_org" ? <Enlace href="/ajustes">Ajustes</Enlace> : null}
        {persona.superPlataforma ? <Enlace href="/plataforma">Plataforma</Enlace> : null}
      </nav>
    </>
  );
}

function Enlace({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="toque text-[0.9375rem] font-semibold text-acento underline underline-offset-4">
      {children}
    </Link>
  );
}
