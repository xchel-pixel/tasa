import Link from "next/link";
import { redirect } from "next/navigation";
import { Encabezado } from "@/components/encabezado";
import { fechaCorta } from "@/lib/formato";
import { obtenerSesion } from "@/lib/sesion";
import { crearClienteServidor } from "@/lib/supabase/server";
import { FormularioTerminos } from "./formulario-terminos";

export const metadata = { title: "Términos — Tasa" };

/**
 * El comisionista llega aquí solo cuando le falta aceptar la versión
 * vigente (lo manda `exigirPersona`). Después puede volver a leerlos.
 * No usa `exigirPersona`, que lo regresaría aquí mismo.
 */
export default async function Terminos() {
  const sesion = await obtenerSesion();
  if (!sesion) redirect("/entrar");
  const persona = sesion.persona;
  if (!persona) redirect("/");

  const supabase = await crearClienteServidor();
  const [{ data: ajustes }, { data: aceptacion }] = await Promise.all([
    supabase.from("ajustes").select("terminos, terminos_version").eq("organizacion_id", persona.organizacion.id).maybeSingle(),
    supabase
      .from("aceptaciones_terminos")
      .select("version, aceptado_en")
      .eq("persona_id", persona.id)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  const texto = ajustes?.terminos?.trim();
  if (!texto) redirect("/");

  return (
    <>
      <Encabezado />
      <main className="flex flex-1 flex-col px-6 py-6">
        <div className="mx-auto w-full max-w-md">
          {!persona.debeAceptarTerminos ? (
            <Link href="/" className="toque text-[0.9375rem] font-semibold text-acento">
              ← Inicio
            </Link>
          ) : null}
          <h1 className="mt-2 text-[1.5rem] font-bold tracking-tight">Términos de {persona.organizacion.nombre}</h1>
          {persona.debeAceptarTerminos ? (
            <p className="mt-2 leading-7 text-secundario">
              {aceptacion
                ? "Los términos cambiaron desde la última vez que los aceptaste. Léelos y acéptalos para seguir."
                : "Antes de empezar, lee y acepta los términos."}
            </p>
          ) : aceptacion ? (
            <p className="mt-2 leading-7 text-secundario">Los aceptaste el {fechaCorta(aceptacion.aceptado_en)}.</p>
          ) : null}

          <div className="mt-4 rounded-lg border border-linea p-4 leading-7 whitespace-pre-line">{texto}</div>

          {persona.debeAceptarTerminos ? <FormularioTerminos version={ajustes!.terminos_version} /> : null}
        </div>
      </main>
    </>
  );
}
