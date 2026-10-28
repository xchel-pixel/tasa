import Link from "next/link";
import { notFound } from "next/navigation";
import { Marca } from "@/components/marca";
import { urlDelSitio } from "@/lib/altas";
import { crearClienteServidor } from "@/lib/supabase/server";

export const metadata = { title: "Aviso de privacidad — Tasa" };

type Aviso = { organizacion: string; slug: string; texto: string; version: number; actualizado_en: string | null };

/** "2026-10-28T…" → "28 de octubre de 2026", en hora de México. */
const fechaLarga = (iso: string) =>
  new Date(iso).toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric", timeZone: "America/Mexico_City" });

/**
 * El aviso de privacidad que publica cada organización en Ajustes. Se
 * ve sin sesión. Sin `?org=`, el de la organización principal.
 *
 * El texto puede traer [ENLACE] (la dirección de esta página) y [FECHA]
 * (cuándo se publicó esta versión): los llena Tasa.
 */
export default async function Privacidad({ searchParams }: { searchParams: Promise<{ org?: string }> }) {
  const { org } = await searchParams;
  const supabase = await crearClienteServidor();
  const { data } = await supabase.rpc("aviso_privacidad_publico", org ? { p_slug: org } : {});
  const aviso = data as Aviso | null;
  if (!aviso) notFound();

  const enlace = `${await urlDelSitio()}/privacidad${org ? `?org=${encodeURIComponent(aviso.slug)}` : ""}`;
  const texto = aviso.texto
    .replaceAll("[ENLACE]", enlace)
    .replaceAll("[FECHA]", aviso.actualizado_en ? fechaLarga(aviso.actualizado_en) : "");

  return (
    <main className="flex flex-1 flex-col px-6 py-10">
      <div className="mx-auto w-full max-w-md">
        <Marca alto={48} />
        <h1 className="mt-6 text-[1.5rem] font-bold tracking-tight">Aviso de privacidad</h1>
        <div className="mt-4 leading-7 whitespace-pre-line">{texto}</div>
        <p className="mt-10">
          <Link href="/" className="toque text-[0.9375rem] font-semibold text-acento underline underline-offset-4">
            Ir a Tasa
          </Link>
        </p>
      </div>
    </main>
  );
}
