import Link from "next/link";
import { ListaTramites } from "@/components/lista-tramites";
import { PantallaAdmin } from "@/components/pantalla-admin";
import { exigirRol } from "@/lib/sesion";
import { leerTramites, pendienteDeFolio, saldoDe, type Tramite } from "@/lib/tramites";

export const metadata = { title: "Mis trámites — Tasa" };

const VISTAS = {
  todos: { texto: "Todos", filtro: () => true },
  por_cotizar: { texto: "Por cotizar", filtro: (t: Tramite) => t.estado === "solicitada" },
  sin_folio: { texto: "Pendientes de folio", filtro: pendienteDeFolio },
  por_cobrar: { texto: "Por cobrar", filtro: (t: Tramite) => saldoDe(t) > 0 },
} as const;

/**
 * Lo que llegó por la liga de cliente de esta persona del equipo o del staff, con el mismo
 * seguimiento que ve el comisionista (estatus, folio de Notion, historial en la ficha). Es de
 * seguimiento: no hay comisión.
 */
export default async function MisTramites({ searchParams }: PageProps<"/mis-tramites">) {
  const persona = await exigirRol("admin_org", "finanzas", "admin_marca", "equipo");
  const { ver } = await searchParams;
  const vista = typeof ver === "string" && ver in VISTAS ? (ver as keyof typeof VISTAS) : "todos";
  const tramites = (await leerTramites({ ligaDe: persona.id })).filter(VISTAS[vista].filtro);

  return (
    <PantallaAdmin titulo="Mis trámites">
      <p className="mt-1 text-[0.9375rem] leading-6 text-secundario">
        Lo que pidieron tus clientes por tu liga. Solo seguimiento, sin comisión.
      </p>
      <nav aria-label="Ver" className="mt-4 flex flex-wrap gap-2">
        {Object.entries(VISTAS).map(([clave, v]) => (
          <Link key={clave} href={clave === "todos" ? "/mis-tramites" : `/mis-tramites?ver=${clave}`}
            aria-current={clave === vista ? "page" : undefined}
            className={`toque rounded-full border px-3 py-1 text-[0.9375rem] font-semibold ${
              clave === vista ? "border-primario bg-primario text-sobre-primario" : "border-linea text-primario"}`}>
            {v.texto}
          </Link>
        ))}
      </nav>
      <ListaTramites tramites={tramites} usuario={persona.id} seccion="mis-tramites"
        vacio={vista === "todos" ? "Todavía no llega nada por tu liga de cliente." : "Nada en esta vista."} />
    </PantallaAdmin>
  );
}
