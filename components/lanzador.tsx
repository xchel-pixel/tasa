import Link from "next/link";
import { misHerramientas, type ClaveHerramienta } from "@/lib/herramientas";
import type { Persona } from "@/lib/sesion";

/**
 * La cuadrícula de herramientas de la portada. Lo activo sale del catálogo (0053), por rol y nivel;
 * "Nueva solicitud" es del comisionista. Lo que viene después se ve apagado con "Próximamente".
 */

const RUTA: Partial<Record<ClaveHerramienta, string>> = {
  mi_tarjeta: "/tarjeta",
  calculadora_traslado: "/calculadora",
};

const DETALLE: Partial<Record<ClaveHerramienta, string>> = {
  mi_tarjeta: "Tu tarjeta digital para compartir",
  calculadora_traslado: "Gastos de escrituración en Querétaro",
};

const PROXIMAMENTE = [
  { titulo: "Consulta catastral", detalle: "Ficha del predio por clave" },
  { titulo: "Estimación rápida", detalle: "Valor aproximado en minutos" },
  { titulo: "OV express", detalle: "Opinión de valor revisada" },
];

export async function Lanzador({ persona }: { persona: Persona }) {
  const activas = (await misHerramientas())
    .filter((h) => RUTA[h.clave])
    .map((h) => ({ href: RUTA[h.clave]!, titulo: h.nombre, detalle: DETALLE[h.clave] ?? "" }));
  const mosaicos = [
    ...(persona.rol === "comisionista" ? [{ href: "/solicitudes/nueva", titulo: "Nueva solicitud", detalle: "Cotización o trámite para tu cliente" }] : []),
    ...activas,
  ];

  return (
    <section aria-label="Herramientas" className="mt-5">
      <ul className="grid grid-cols-2 gap-3">
        {mosaicos.map((m, i) => (
          <li key={m.href}>
            <Link href={m.href}
              className={`flex h-full min-h-24 flex-col justify-between rounded-xl px-4 py-3 ${
                i === 0 && persona.rol === "comisionista" ? "bg-primario text-sobre-primario" : "border border-linea bg-alterno"}`}>
              <span className="font-bold leading-tight">{m.titulo}</span>
              <span className={`mt-2 text-[0.8125rem] leading-5 ${i === 0 && persona.rol === "comisionista" ? "opacity-90" : "text-secundario"}`}>{m.detalle}</span>
            </Link>
          </li>
        ))}
        {PROXIMAMENTE.map((p) => (
          <li key={p.titulo}
            className="flex min-h-24 flex-col justify-between rounded-xl border border-dashed border-linea px-4 py-3 text-secundario">
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
