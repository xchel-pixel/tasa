import Link from "next/link";
import { GRUPOS, tareasDeHoy, type Grupo } from "@/lib/hoy";
import type { Persona } from "@/lib/sesion";

/** "Hoy": todo lo pendiente de administración en una sola lista, por grupos. Cada renglón lleva a donde se resuelve. */
export async function ListaHoy({ persona }: { persona: Persona }) {
  const tareas = await tareasDeHoy(persona);
  if (!tareas.length) {
    return <p className="mt-4 rounded-xl bg-alterno px-4 py-4 text-[0.9375rem] leading-6">Todo al día: no hay nada esperando una acción.</p>;
  }
  return (
    <div className="mt-2 flex flex-col gap-5">
      {(Object.keys(GRUPOS) as Grupo[]).map((g) => {
        const lista = tareas.filter((t) => t.grupo === g);
        if (!lista.length) return null;
        return (
          <section key={g}>
            <h2 className="text-[0.8125rem] font-bold uppercase tracking-wide text-secundario">{GRUPOS[g].titulo}</h2>
            <p className="text-[0.8125rem] text-secundario">{GRUPOS[g].para}</p>
            <ul className="mt-2 flex flex-col gap-2">
              {lista.map((t) => (
                <li key={t.texto}>
                  <Link href={t.href} className={`flex items-center justify-between gap-3 rounded-xl border px-4 py-3 ${t.urgente ? "border-error bg-error-fondo" : "border-linea bg-alterno"}`}>
                    <span className="min-w-0">
                      <span className={`block font-semibold ${t.urgente ? "text-error" : ""}`}>{t.texto}</span>
                      {t.detalle ? <span className="block text-[0.875rem] leading-5 text-secundario">{t.detalle}</span> : null}
                    </span>
                    {t.cuenta !== undefined ? (
                      <span className="min-w-9 shrink-0 rounded-full bg-primario px-3 py-1 text-center text-[0.9375rem] font-bold text-sobre-primario">{t.cuenta}</span>
                    ) : null}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
