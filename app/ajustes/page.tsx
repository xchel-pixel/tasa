import Link from "next/link";
import { Encabezado } from "@/components/encabezado";
import { exigirRol } from "@/lib/sesion";
import { crearClienteServidor, oExplota } from "@/lib/supabase/server";
import FormularioAjustes from "./formulario-ajustes";

export const metadata = { title: "Ajustes — Tasa" };

export default async function Ajustes() {
  await exigirRol("super_admin");
  const supabase = await crearClienteServidor();

  const ajustes = oExplota(
    await supabase
      .from("ajustes")
      .select("contacto_soporte")
      .maybeSingle()
      .returns<{ contacto_soporte: string | null } | null>(),
    "los ajustes"
  );

  return (
    <>
      <Encabezado />
      <main className="flex flex-1 flex-col px-6 py-8">
        <div className="mx-auto w-full max-w-md">
          <Link href="/" className="toque text-[0.9375rem] font-semibold text-acento">
            ← Inicio
          </Link>
          <h1 className="mt-2 text-[1.5rem] font-bold tracking-tight">Ajustes</h1>

          <FormularioAjustes contacto={ajustes?.contacto_soporte ?? ""} />
        </div>
      </main>
    </>
  );
}
