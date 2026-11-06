import Link from "next/link";
import { BloqueNivel } from "@/components/bloque-nivel";
import { ListaTramites } from "@/components/lista-tramites";
import { MisReferidos } from "@/components/mis-referidos";
import { fechaCorta, pesos } from "@/lib/formato";
import type { Persona } from "@/lib/sesion";
import { crearClienteServidor } from "@/lib/supabase/server";
import { miNivel } from "@/lib/trabajos";
import { leerTramites } from "@/lib/tramites";

/**
 * "Panel de comisiones" (su propia pantalla desde 0056): cuánto lleva este mes, sus pagos por entregar y
 * cómo van sus trabajos, agrupados por estatus (lo que llegó por su liga de cliente, junto con lo demás), y sus
 * referidos. Entregados y cancelados, cerrados.
 */
export async function PanelComisionista({ persona }: { persona: Persona }) {
  const supabase = await crearClienteServidor();
  const [trabajos, nivel, { data: porEntregar }] = await Promise.all([
    leerTramites(),
    miNivel(persona.id, persona.organizacion.id),
    // Pagos que le hicieron a él y todavía no entrega a la cuenta.
    supabase.from("pagos").select("id, monto, entregar_antes, solicitud_id, solicitudes(cliente_nombre)")
      .eq("recibio_asesor", true).eq("estado", "reportado").is("entregado_en", null).eq("reportado_por", persona.id)
      .order("entregar_antes")
      .returns<{ id: string; monto: string | number; entregar_antes: string; solicitud_id: string; solicitudes: { cliente_nombre: string } | null }[]>(),
  ]);
  const hoyMx = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City" }).format(new Date());

  return (
    <>
      <h1 className="mt-2 text-[1.5rem] font-bold tracking-tight">Panel de comisiones</h1>

      {(porEntregar ?? []).length > 0 ? (
        <div className="mt-4 rounded-xl bg-proceso-fondo px-4 py-3 text-proceso">
          <p className="font-semibold">Pagos por entregar a la cuenta</p>
          <ul className="mt-1 flex flex-col gap-1 text-[0.9375rem] leading-6">
            {porEntregar!.map((p) => (
              <li key={p.id}>
                <Link href={`/trabajos/${p.solicitud_id}`} className="font-semibold underline underline-offset-4">
                  {pesos(Number(p.monto))} de {p.solicitudes?.cliente_nombre ?? "tu cliente"}
                </Link>
                {p.entregar_antes < hoyMx ? ` · venció el ${fechaCorta(p.entregar_antes)}` : ` · a más tardar el ${fechaCorta(p.entregar_antes)}`}
              </li>
            ))}
          </ul>
          <p className="mt-1 text-[0.9375rem] leading-6">Al depositarlo, márcalo como entregado en el trabajo con su comprobante.</p>
        </div>
      ) : null}


      <div className="mt-6">
        <BloqueNivel nivel={nivel} />
      </div>

      <p className="mt-3 text-center">
        <Link href="/estado-de-cuenta" className="toque text-[0.9375rem] font-semibold text-acento underline underline-offset-4">Ver mi estado de cuenta</Link>
      </p>

      <section className="mt-8">
        <h2 className="text-[1.125rem] font-bold">Mis trabajos</h2>
        <ListaTramites tramites={trabajos} usuario={persona.id} seccion="mis-trabajos" vacio="Todavía no tienes trabajos." />
      </section>

      <MisReferidos usuario={persona.id} />


    </>
  );
}
