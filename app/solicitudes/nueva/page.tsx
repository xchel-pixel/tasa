import Link from "next/link";
import { Encabezado } from "@/components/encabezado";
import { exigirRol } from "@/lib/sesion";
import { crearClienteServidor, oExplota } from "@/lib/supabase/server";
import FormularioSolicitud from "./formulario-solicitud";

export const metadata = { title: "Nueva solicitud — Tasa" };

/**
 * Desde la calculadora de traslado llega con ?servicio=hacendario|comercial&municipio=…&clave=…&notas=… para
 * dejar el formulario casi lleno; el cliente se captura aquí.
 */
export default async function NuevaSolicitud({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const q = await searchParams;
  await exigirRol("comisionista");
  const supabase = await crearClienteServidor();
  const servicios =
    oExplota(
      await supabase
        .from("servicios")
        .select("id, nombre")
        .eq("activo", true)
        .order("orden")
        .returns<{ id: string; nombre: string }[]>(),
      "los servicios"
    ) ?? [];

  return (
    <>
      <Encabezado />
      <main className="flex flex-1 flex-col px-6 py-6">
        <div className="mx-auto w-full max-w-md">
          <Link href="/" className="toque text-[0.9375rem] font-semibold text-acento">
            ← Mis trabajos
          </Link>
          <h1 className="mt-2 text-[1.5rem] font-bold tracking-tight">Nueva solicitud</h1>
          <p className="mt-1 text-[0.9375rem] leading-6 text-secundario">
            Administración revisa los datos y te manda la cotización. Los montos los pone ella.
          </p>
          <FormularioSolicitud servicios={servicios} inicial={{
            servicio_id: q.servicio ? servicios.find((s) => s.nombre.toLowerCase().includes(q.servicio === "comercial" ? "comercial" : "hacendario"))?.id : undefined,
            municipio: q.municipio?.slice(0, 80),
            clave: q.clave?.slice(0, 40),
            descripcion: q.notas?.slice(0, 600),
          }} />
        </div>
      </main>
    </>
  );
}
