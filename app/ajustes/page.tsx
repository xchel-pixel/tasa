import Link from "next/link";
import { Encabezado } from "@/components/encabezado";
import { exigirRol } from "@/lib/sesion";
import { crearClienteServidor, oExplota } from "@/lib/supabase/server";
import FormularioAjustes, { FilaOrigen } from "./formulario-ajustes";

export const metadata = { title: "Ajustes — Tasa" };

export default async function Ajustes() {
  await exigirRol("super_admin");
  const supabase = await crearClienteServidor();

  const [ajustes, origenes] = await Promise.all([
    supabase
      .from("ajustes")
      .select("contacto_soporte, dia_limite_pago_comision")
      .maybeSingle()
      .returns<{ contacto_soporte: string | null; dia_limite_pago_comision: number } | null>(),
    supabase
      .from("origenes_pago")
      .select("id, nombre, activo")
      .order("orden")
      .order("nombre")
      .returns<{ id: string; nombre: string; activo: boolean }[]>(),
  ]);
  const a = oExplota(ajustes, "los ajustes");

  return (
    <>
      <Encabezado />
      <main className="flex flex-1 flex-col px-6 py-8">
        <div className="mx-auto w-full max-w-md">
          <Link href="/" className="toque text-[0.9375rem] font-semibold text-acento">
            ← Inicio
          </Link>
          <h1 className="mt-2 text-[1.5rem] font-bold tracking-tight">Ajustes</h1>

          <FormularioAjustes contacto={a?.contacto_soporte ?? ""} diaLimite={a?.dia_limite_pago_comision ?? 10} />

          <section className="mt-10">
            <h2 className="text-[1.125rem] font-bold">Origen del dinero</h2>
            <p className="mt-1 text-[0.9375rem] leading-6 text-secundario">
              De dónde sale el pago de una comisión. Solo lo ve Administración; el comisionista nunca.
            </p>
            <div className="mt-3 flex flex-col gap-2">
              {(oExplota(origenes, "los orígenes") ?? []).map((o) => (
                <FilaOrigen key={o.id} id={o.id} nombre={o.nombre} activo={o.activo} />
              ))}
              <FilaOrigen />
            </div>
          </section>
        </div>
      </main>
    </>
  );
}
