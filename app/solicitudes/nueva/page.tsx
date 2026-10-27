import Link from "next/link";
import { Encabezado } from "@/components/encabezado";
import { exigirRol } from "@/lib/sesion";
import { crearClienteServidor, oExplota } from "@/lib/supabase/server";
import FormularioSolicitud from "./formulario-solicitud";

export const metadata = { title: "Nueva solicitud — Tasa" };

export default async function NuevaSolicitud() {
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
          <FormularioSolicitud servicios={servicios} />
        </div>
      </main>
    </>
  );
}
