import Link from "next/link";
import { redirect } from "next/navigation";
import { Encabezado } from "@/components/encabezado";
import { VolverPortada } from "@/components/volver-portada";
import { TODOS_LOS_ROLES, tengoHerramienta } from "@/lib/herramientas";
import { exigirRol } from "@/lib/sesion";
import datos from "@/lib/traslado/parametros-2026.json";
import { FormularioCalculadora } from "./formulario";
import { miCupo, textoCupo } from "@/lib/cupos";

export const metadata = { title: "Calculadora de traslado — Tasa" };

/** Calculadora de gastos de traslado de dominio (Querétaro). Rápida para todos; Completa según el catálogo. */
export default async function Calculadora({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await exigirRol(...TODOS_LOS_ROLES);
  if (!(await tengoHerramienta("calculadora_traslado"))) redirect("/");
  const completa = await tengoHerramienta("calculadora_traslado_completa");
  // Cupo del mes (0057): Rápida y Completa por separado; equipo y administración, sin límite.
  const [cupoR, cupoC] = await Promise.all([miCupo("calculadora_traslado"), completa ? miCupo("calculadora_traslado_completa") : Promise.resolve(null)]);
  const cupos = {
    rapida: { texto: textoCupo(cupoR), agotado: cupoR.disponibles === 0, extras: cupoR.extras },
    completa: cupoC ? { texto: textoCupo(cupoC), agotado: cupoC.disponibles === 0, extras: cupoC.extras } : null,
  };
  const hoy = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City" }).format(new Date());
  const municipios = Object.keys(datos.istd).sort((a, b) => a.localeCompare(b, "es"));
  // Desde el Mapa catastral (0059): ?clave=&municipio=&valor_catastral=.
  const q = await searchParams;
  const inicial: Record<string, string> = {};
  if (q.municipio && municipios.includes(q.municipio)) inicial.municipio = q.municipio;
  if (q.clave) inicial.clave_catastral = q.clave.replace(/[^d-]/g, "").slice(0, 40);
  if (q.valor_catastral && /^d{1,12}(.d{1,2})?$/.test(q.valor_catastral)) inicial.valor_catastral = q.valor_catastral;

  return (
    <>
      <Encabezado />
      <main className="flex flex-1 flex-col px-6 py-6">
        <div className="mx-auto w-full max-w-md">
          <VolverPortada />
          <div className="mt-2 flex items-center justify-between gap-3">
            <h1 className="text-[1.5rem] font-bold tracking-tight">Calculadora de traslado</h1>
            <Link href="/calculadora/mis-calculos" className="toque shrink-0 text-[0.9375rem] font-semibold text-acento underline underline-offset-4">Mis cálculos</Link>
          </div>
          <p className="mt-1 text-[0.9375rem] leading-6 text-secundario">
            Gastos de escrituración en Querétaro para comprador, vendedor o ambos: ISTD, honorarios notariales, Registro Público y avalúo
            {completa ? "; en la completa, también ISR por enajenación y operaciones extemporáneas" : ""}.
          </p>
          {cupos.rapida.extras || cupos.completa?.extras ? (
            <p className="mt-3 rounded-xl bg-exito-fondo px-4 py-3 text-[0.9375rem] leading-6 text-exito">
              Se te liberaron {cupos.rapida.extras + (cupos.completa?.extras ?? 0)} cálculos más este mes.
            </p>
          ) : null}
          <FormularioCalculadora municipios={municipios} completa={completa} hoy={hoy} cupos={cupos} inicial={inicial} />
        </div>
      </main>
    </>
  );
}
