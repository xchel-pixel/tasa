import Link from "next/link";
import { AvisoCsf } from "@/components/aviso-csf";
import { BloqueNivel } from "@/components/bloque-nivel";
import { ListaTramites } from "@/components/lista-tramites";
import { MisReferidos } from "@/components/mis-referidos";
import { TarjetaClientes } from "@/components/tarjeta-clientes";
import { TarjetaInvitar } from "@/components/tarjeta-invitar";
import { urlDelSitio } from "@/lib/altas";
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
  const supabase = await crearClienteServidor();
  const [trabajos, nivel, { data: yo }] = await Promise.all([
    leerTramites(),
    miNivel(persona.id, persona.organizacion.id),
    supabase.from("comisionistas").select("csf_ruta, codigo_referido").eq("persona_id", persona.id).maybeSingle()
      .returns<{ csf_ruta: string | null; codigo_referido: string } | null>(),
  ]);
  const sitio = await urlDelSitio();

  return (
    <>
      <h1 className="text-[1.5rem] font-bold tracking-tight">
        Hola, {persona.nombre.split(" ")[0]}
      </h1>

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

      <p className="mt-3 text-center">
        <Link href="/perfil" className="toque text-[0.9375rem] font-semibold text-acento underline underline-offset-4">Mis datos</Link>
      </p>

      <section className="mt-8">
        <h2 className="text-[1.125rem] font-bold">Mis trabajos</h2>
        <ListaTramites tramites={trabajos} usuario={persona.id} seccion="mis-trabajos" vacio="Todavía no tienes trabajos." />
      </section>

      <MisReferidos usuario={persona.id} />

      {yo ? <TarjetaClientes liga={`${sitio}/s/${persona.organizacion.slug}/${yo.codigo_referido}`} /> : null}
      {yo ? <TarjetaInvitar liga={`${sitio}/alta/${persona.organizacion.slug}?ref=${yo.codigo_referido}`} /> : null}
    </>
  );
}
