import Link from "next/link";
import { AvisoCsf } from "@/components/aviso-csf";
import { TarjetaInvitar } from "@/components/tarjeta-invitar";
import { urlDelSitio } from "@/lib/altas";
import { Encabezado } from "@/components/encabezado";
import { fechaCorta } from "@/lib/formato";
import { exigirRol } from "@/lib/sesion";
import { crearClienteServidor, oExplota } from "@/lib/supabase/server";
import { ClabeCobro } from "./clabe-cobro";

export const metadata = { title: "Mis datos — Tasa" };

type Yo = { rfc: string | null; curp: string | null; csf_ruta: string | null; csf_subida_en: string | null; codigo_referido: string; clabe_cobro: string | null };

/** Lo que el comisionista ve de sí mismo y su constancia (la sube o la reemplaza aquí). */
export default async function MisDatos() {
  const persona = await exigirRol("comisionista");
  const supabase = await crearClienteServidor();
  const yo = oExplota(
    await supabase
      .from("comisionistas")
      .select("rfc, curp, csf_ruta, csf_subida_en, codigo_referido, clabe_cobro")
      .eq("persona_id", persona.id)
      .maybeSingle()
      .returns<Yo | null>(),
    "tus datos"
  );

  const fila = (titulo: string, valor: string) => (
    <div className="flex justify-between gap-4 border-b border-linea py-2 text-[0.9375rem]">
      <dt className="text-secundario">{titulo}</dt>
      <dd className="text-right font-semibold break-all">{valor}</dd>
    </div>
  );

  return (
    <>
      <Encabezado />
      <main className="flex flex-1 flex-col px-6 py-6">
        <div className="mx-auto w-full max-w-md">
          <Link href="/" className="toque text-[0.9375rem] font-semibold text-acento">← Inicio</Link>
          <h1 className="mt-2 text-[1.5rem] font-bold tracking-tight">Mis datos</h1>

          <dl className="mt-4">
            {fila("Nombre", persona.nombre)}
            {fila("Correo", persona.correo)}
            {fila("RFC", yo?.rfc ?? "—")}
            {yo?.curp ? fila("CURP", yo.curp) : null}
            {fila("Constancia (CSF)", yo?.csf_ruta ? `Subida${yo.csf_subida_en ? ` el ${fechaCorta(yo.csf_subida_en)}` : ""}` : "Pendiente")}
          </dl>
          <p className="mt-2 text-[0.9375rem] leading-6 text-secundario">
            Para corregir tu nombre, RFC o CURP, escríbele a Administración.
          </p>

          <ClabeCobro actual={yo?.clabe_cobro ?? null} />

          {yo ? <TarjetaInvitar liga={`${await urlDelSitio()}/alta/${persona.organizacion.slug}?ref=${yo.codigo_referido}`} /> : null}

          <AvisoCsf carpeta={`${persona.organizacion.id}/${persona.id}`} reemplazar={Boolean(yo?.csf_ruta)} />

          <p className="mt-8">
            <Link href={`/privacidad?org=${persona.organizacion.slug}`} className="toque text-[0.9375rem] font-semibold text-acento underline underline-offset-4">
              Aviso de privacidad
            </Link>
          </p>
        </div>
      </main>
    </>
  );
}
