import Link from "next/link";
import { Etiqueta } from "@/components/etiqueta";
import { mesLargo } from "@/lib/formato";
import { pendientesDelPanel } from "@/lib/panel";
import { NOMBRE_DEL_ROL, type Persona } from "@/lib/sesion";

/**
 * El panel abre con lo que toca hacer hoy, en orden: pagos por
 * confirmar primero. Cada renglón dice cuántos hay y lleva a su bandeja.
 */
export async function InicioStaff({ persona }: { persona: Persona }) {
  const p = await pendientesDelPanel();

  const cierre = {
    sin_preparar: { texto: "Por preparar", tono: "proceso" as const },
    preparado: { texto: "Por aprobar", tono: "proceso" as const },
    aprobado: { texto: "Aprobado", tono: "exito" as const },
  }[p.cierre.estado];

  return (
    <>
      <h1 className="text-[1.5rem] font-bold tracking-tight">Hola, {persona.nombre.split(" ")[0]}</h1>
      <p className="mt-1 text-[0.9375rem] text-secundario">{NOMBRE_DEL_ROL[persona.rol]}</p>

      <ul className="mt-6 flex flex-col gap-3">
        <Renglon href="/admin/pagos" titulo="Pagos por confirmar" cuenta={p.pagos} />
        <Renglon href="/admin/solicitudes" titulo="Solicitudes por cotizar" cuenta={p.solicitudes} />
        <Renglon href="/admin/alertas" titulo="Alertas de Notion" cuenta={p.alertas} />
        <li>
          <Link href="/admin/cierres" className="flex items-center justify-between gap-3 rounded-xl border border-linea bg-alterno px-4 py-4">
            <span>
              <span className="block font-semibold">Cierre mensual</span>
              <span className="block text-[0.9375rem] capitalize text-secundario">{mesLargo(p.cierre.mes)}</span>
            </span>
            <Etiqueta tono={cierre.tono}>{cierre.texto}</Etiqueta>
          </Link>
        </li>
      </ul>

      {persona.rol === "super_admin" ? (
        <Link href="/ajustes" className="toque mt-6 text-[0.9375rem] font-semibold text-acento underline underline-offset-4">
          Ajustes
        </Link>
      ) : null}
    </>
  );
}

function Renglon({ href, titulo, cuenta }: { href: string; titulo: string; cuenta: number }) {
  return (
    <li>
      <Link href={href} className="flex items-center justify-between gap-3 rounded-xl border border-linea bg-alterno px-4 py-4">
        <span className="font-semibold">{titulo}</span>
        {cuenta > 0 ? (
          <span className="min-w-9 rounded-full bg-primario px-3 py-1 text-center text-[0.9375rem] font-bold text-sobre-primario">
            {cuenta}
          </span>
        ) : (
          <span className="text-[0.9375rem] text-secundario">Al día</span>
        )}
      </Link>
    </li>
  );
}
