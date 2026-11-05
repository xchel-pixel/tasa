import Link from "next/link";
import { AvisoCsf } from "@/components/aviso-csf";
import { BloqueNivel } from "@/components/bloque-nivel";
import { ListaTramites } from "@/components/lista-tramites";
import { MisReferidos } from "@/components/mis-referidos";
import { CompartirTarjeta } from "@/components/compartir-tarjeta";
import { TarjetaClientes } from "@/components/tarjeta-clientes";
import { TarjetaInvitar } from "@/components/tarjeta-invitar";
import { urlDelSitio } from "@/lib/altas";
import { fechaCorta, pesos } from "@/lib/formato";
import { tengoHerramienta } from "@/lib/herramientas";
import type { Persona } from "@/lib/sesion";
import { crearClienteServidor } from "@/lib/supabase/server";
import { miNivel } from "@/lib/trabajos";
import { leerTramites } from "@/lib/tramites";

/**
 * Lo primero que ve el comisionista: cuánto lleva este mes y cómo van
 * sus trabajos, agrupados por estatus (lo que llegó por su liga de
 * cliente, junto con lo demás). Entregados y cancelados, cerrados.
 */
export async function InicioComisionista({ persona }: { persona: Persona }) {
  // "Mi tarjeta" es una herramienta del catálogo (0053): si la organización la apaga, no se ofrece.
  const conTarjeta = await tengoHerramienta("mi_tarjeta");
  const supabase = await crearClienteServidor();
  const [trabajos, nivel, { data: yo }, { data: tarjeta }, { data: porEntregar }] = await Promise.all([
    leerTramites(),
    miNivel(persona.id, persona.organizacion.id),
    supabase.from("comisionistas").select("csf_ruta, codigo_referido, slug").eq("persona_id", persona.id).maybeSingle()
      .returns<{ csf_ruta: string | null; codigo_referido: string; slug: string } | null>(),
    supabase.from("tarjetas").select("estado").eq("comisionista_id", persona.id).maybeSingle().returns<{ estado: string } | null>(),
    // Pagos que le hicieron a él y todavía no entrega a la cuenta.
    supabase.from("pagos").select("id, monto, entregar_antes, solicitud_id, solicitudes(cliente_nombre)")
      .eq("recibio_asesor", true).eq("estado", "reportado").is("entregado_en", null).eq("reportado_por", persona.id)
      .order("entregar_antes")
      .returns<{ id: string; monto: string | number; entregar_antes: string; solicitud_id: string; solicitudes: { cliente_nombre: string } | null }[]>(),
  ]);
  const hoyMx = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City" }).format(new Date());
  const sitio = await urlDelSitio();

  return (
    <>
      <h1 className="text-[1.5rem] font-bold tracking-tight">
        Hola, {persona.nombre.split(" ")[0]}
      </h1>

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

      {yo && !yo.csf_ruta ? <AvisoCsf carpeta={`${persona.organizacion.id}/${persona.id}`} /> : null}

      <div className="mt-6">
        <BloqueNivel nivel={nivel} />
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <Link
          href="/solicitudes/nueva"
          className="flex min-h-12 items-center justify-center rounded-lg bg-primario px-3 py-3 text-center text-[1rem] font-semibold text-sobre-primario"
        >
          Nueva solicitud
        </Link>
        <Link
          href="/estado-de-cuenta"
          className="flex min-h-12 items-center justify-center rounded-lg border border-primario px-3 py-3 text-center text-[1rem] font-semibold text-primario"
        >
          Estado de cuenta
        </Link>
      </div>

      <p className="mt-3 flex justify-center gap-6">
        <Link href="/perfil" className="toque text-[0.9375rem] font-semibold text-acento underline underline-offset-4">Mis datos</Link>
        {conTarjeta ? <Link href="/tarjeta" className="toque text-[0.9375rem] font-semibold text-acento underline underline-offset-4">Mi tarjeta</Link> : null}
      </p>

      <section className="mt-8">
        <h2 className="text-[1.125rem] font-bold">Mis trabajos</h2>
        <ListaTramites tramites={trabajos} usuario={persona.id} seccion="mis-trabajos" vacio="Todavía no tienes trabajos." />
      </section>

      <MisReferidos usuario={persona.id} />

      {yo && conTarjeta ? <CompartirTarjeta liga={`${sitio}/t/${persona.organizacion.slug}/${yo.slug}`} publicada={tarjeta?.estado === "publicada"} /> : null}

      {yo ? <TarjetaClientes liga={`${sitio}/s/${persona.organizacion.slug}/${yo.codigo_referido}`} /> : null}
      {yo ? <TarjetaInvitar liga={`${sitio}/alta/${persona.organizacion.slug}?ref=${yo.codigo_referido}`} /> : null}
    </>
  );
}
