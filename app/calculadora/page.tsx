import Link from "next/link";
import { redirect } from "next/navigation";
import { Encabezado } from "@/components/encabezado";
import { TODOS_LOS_ROLES, tengoHerramienta } from "@/lib/herramientas";
import { exigirRol } from "@/lib/sesion";
import datos from "@/lib/traslado/parametros-2026.json";
import { FormularioCalculadora } from "./formulario";

export const metadata = { title: "Calculadora de traslado — Tasa" };

/** Calculadora de gastos de traslado de dominio (Querétaro). Rápida para todos; Completa según el catálogo. */
export default async function Calculadora() {
  await exigirRol(...TODOS_LOS_ROLES);
  if (!(await tengoHerramienta("calculadora_traslado"))) redirect("/");
  const completa = await tengoHerramienta("calculadora_traslado_completa");
  const hoy = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City" }).format(new Date());
  const municipios = Object.keys(datos.istd).sort((a, b) => a.localeCompare(b, "es"));

  return (
    <>
      <Encabezado />
      <main className="flex flex-1 flex-col px-6 py-6">
        <div className="mx-auto w-full max-w-md">
          <div className="flex items-center justify-between gap-3">
            <h1 className="text-[1.5rem] font-bold tracking-tight">Calculadora de traslado</h1>
            <Link href="/calculadora/mis-calculos" className="toque shrink-0 text-[0.9375rem] font-semibold text-acento underline underline-offset-4">Mis cálculos</Link>
          </div>
          <p className="mt-1 text-[0.9375rem] leading-6 text-secundario">
            Gastos de escrituración en Querétaro para comprador, vendedor o ambos: ISTD, honorarios notariales, Registro Público y avalúo
            {completa ? "; en la completa, también ISR por enajenación y operaciones extemporáneas" : ""}.
          </p>
          <FormularioCalculadora municipios={municipios} completa={completa} hoy={hoy} />
        </div>
      </main>
    </>
  );
}
