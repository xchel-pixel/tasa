import Link from "next/link";
import { notFound } from "next/navigation";
import { Encabezado } from "@/components/encabezado";
import { TODOS_LOS_ROLES } from "@/lib/herramientas";
import { exigirRol } from "@/lib/sesion";
import type { Concepto } from "@/lib/traslado/calculo";
import { LEYENDA } from "@/lib/traslado/pdf";
import { leerCalculo } from "@/lib/traslado/servidor";
import { borrarCalculo } from "../acciones";

/** Pesos con centavos siempre (en la calculadora cada centavo cuenta). */
const pesos = (x: number) => x.toLocaleString("es-MX", { style: "currency", currency: "MXN", minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const metadata = { title: "Resultado del cálculo — Tasa" };

/** Un cálculo guardado (de quien lo hizo, 90 días): totales, conceptos, avisos, sugerencias, PDF y solicitar el avalúo. */
export default async function ResultadoCalculo({ params }: { params: Promise<{ id: string }> }) {
  const persona = await exigirRol(...TODOS_LOS_ROLES);
  const { id } = await params;
  const c = await leerCalculo(id);
  if (!c) notFound();
  const r = c.resultado;
  const sinHtml = (s: string) => s.replace(/<[^>]+>/g, "");
  const avisos = [
    // El INPC solo cuenta con ISR por enajenación o extemporáneo.
    ...(r.avisos ?? []).filter((a) => !a.includes("INPC") || c.entrada.extemporaneo || c.entrada.vendedor?.isr),
    ...(r.SC.concat(r.SV).some((s) => s.includes("referido")) ? ["El notario pedirá un avalúo referido (ver sugerencias)."] : []),
  ];
  const notasSolicitud = [
    `Desde la calculadora de traslado: ${r.lado === "C" ? "comprador" : r.lado === "V" ? "vendedor" : "comprador y vendedor"}`,
    r.vo ? `valor de operación ${pesos(r.vo)}` : null,
    r.va ? `avalúo ${pesos(r.va)}` : null,
    `firma estimada ${r.fecha}`,
  ].filter(Boolean).join(" · ");
  const liga = (servicio: string) =>
    `/solicitudes/nueva?${new URLSearchParams({ servicio, municipio: r.municipio, clave: c.entrada.clave_catastral ?? "", notas: notasSolicitud })}`;

  return (
    <>
      <Encabezado />
      <main className="flex flex-1 flex-col px-6 py-6">
        <div className="mx-auto w-full max-w-md">
          <Link href="/calculadora" className="toque text-[0.9375rem] font-semibold text-acento">← Calcular otro</Link>
          <h1 className="mt-2 text-[1.5rem] font-bold tracking-tight">Gastos de traslado</h1>
          <p className="text-[0.9375rem] text-secundario">
            {[c.referencia, `${r.municipio}, Qro.`, `firma ${r.fecha.split("-").reverse().join("/")}`, c.modo === "completa" ? "completa" : "rápida"].filter(Boolean).join(" · ")}
          </p>

          <div className={`mt-4 grid gap-2 ${r.lado === "AMBOS" ? "grid-cols-3" : "grid-cols-1"}`}>
            {r.lado !== "V" ? <Total titulo="Comprador" monto={r.totC} /> : null}
            {r.lado !== "C" ? <Total titulo="Vendedor" monto={r.totV} /> : null}
            {r.lado === "AMBOS" ? <Total titulo="Operación" monto={r.totC + r.totV} /> : null}
          </div>

          {r.lado !== "V" ? <Tabla titulo="Comprador" filas={r.C} total={r.totC} /> : null}
          {r.lado !== "C" ? <Tabla titulo="Vendedor" filas={r.V} total={r.totV} /> : null}

          {avisos.length || r.notas.length ? (
            <section className="mt-6 rounded-xl bg-proceso-fondo px-4 py-3 text-proceso">
              <h2 className="font-semibold">Avisos</h2>
              <ul className="mt-1 flex flex-col gap-1 text-[0.9375rem] leading-6">
                {[...avisos, ...r.notas].map((a) => <li key={a}>• {a}</li>)}
              </ul>
            </section>
          ) : null}

          {r.SC.length || r.SV.length ? (
            <section className="mt-6 rounded-xl bg-alterno px-4 py-3">
              <h2 className="font-semibold">Sugerencias</h2>
              <p className="text-[0.8125rem] leading-5 text-secundario">Informativas. Los valores referidos los firma un tasador autorizado y deben reflejar el valor real.</p>
              {[["Comprador", r.lado !== "V" ? r.SC : []], ["Vendedor", r.lado !== "C" ? r.SV : []]].map(([quien, lista]) =>
                (lista as string[]).length ? (
                  <div key={quien as string} className="mt-2">
                    <p className="text-[0.8125rem] font-bold uppercase tracking-wide text-secundario">{quien as string}</p>
                    <ul className="mt-1 flex flex-col gap-2 text-[0.9375rem] leading-6">
                      {(lista as string[]).map((s) => <li key={s}>• {sinHtml(s)}</li>)}
                    </ul>
                  </div>
                ) : null
              )}
            </section>
          ) : null}

          <div className="mt-6 grid grid-cols-2 gap-2">
            <a href={`/calculadora/${c.id}/pdf`} className="flex min-h-12 items-center justify-center rounded-lg bg-primario px-3 text-center font-semibold text-sobre-primario">PDF (resumen)</a>
            <a href={`/calculadora/${c.id}/pdf?detalle=1`} className="flex min-h-12 items-center justify-center rounded-lg border border-primario px-3 text-center font-semibold text-primario">PDF con detalle</a>
          </div>

          {persona.rol === "comisionista" ? (
            <section className="mt-6 rounded-xl border border-linea px-4 py-4">
              <h2 className="font-bold">¿Necesitas el avalúo hacendario? Solicítalo</h2>
              <p className="mt-1 text-[0.9375rem] leading-6 text-secundario">Abrimos tu solicitud con estos datos; solo agregas al cliente. Va a tu nombre, con tu comisión.</p>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <Link href={liga("hacendario")} className="flex min-h-12 items-center justify-center rounded-lg bg-primario px-3 text-center font-semibold text-sobre-primario">Avalúo hacendario</Link>
                <Link href={liga("comercial")} className="flex min-h-12 items-center justify-center rounded-lg border border-primario px-3 text-center font-semibold text-primario">Avalúo comercial</Link>
              </div>
            </section>
          ) : null}

          <p className="mt-6 text-[0.8125rem] leading-5 text-secundario">{LEYENDA}</p>
          <form action={borrarCalculo} className="mt-3">
            <input type="hidden" name="id" value={c.id} />
            <button type="submit" className="toque text-[0.9375rem] font-semibold text-secundario underline underline-offset-4">Borrar este cálculo</button>
          </form>
        </div>
      </main>
    </>
  );
}

function Total({ titulo, monto }: { titulo: string; monto: number }) {
  return (
    <div className="rounded-xl bg-tinte px-3 py-3">
      <p className="text-[0.8125rem] text-secundario">{titulo}</p>
      <p className="text-[1.125rem] font-bold text-primario">{pesos(monto)}</p>
    </div>
  );
}

function Tabla({ titulo, filas, total }: { titulo: string; filas: Concepto[]; total: number }) {
  return (
    <section className="mt-6">
      <h2 className="font-bold">{titulo}</h2>
      <table className="mt-2 w-full text-[0.9375rem]">
        <tbody>
          {filas.flatMap(([g, k, v], i) => {
            const filasHtml = [];
            if (i === 0 || filas[i - 1][0] !== g) {
              filasHtml.push(<tr key={`g-${g}`}><td colSpan={2} className="pt-3 text-[0.75rem] font-bold uppercase tracking-wide text-secundario">{g}</td></tr>);
            }
            filasHtml.push(
              <tr key={k} className="border-b border-linea">
                <td className="py-1.5 pr-3">{k}</td>
                <td className="py-1.5 text-right tabular-nums">{pesos(v)}</td>
              </tr>
            );
            return filasHtml;
          })}
          <tr>
            <td className="pt-2 font-bold">Total</td>
            <td className="pt-2 text-right font-bold tabular-nums">{pesos(total)}</td>
          </tr>
        </tbody>
      </table>
    </section>
  );
}
