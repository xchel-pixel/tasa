import Link from "next/link";
import { Encabezado } from "@/components/encabezado";
import { fechaCorta } from "@/lib/formato";
import { TODOS_LOS_ROLES } from "@/lib/herramientas";
import { exigirRol } from "@/lib/sesion";
import { crearClienteServidor } from "@/lib/supabase/server";

/** Pesos con centavos siempre (en la calculadora cada centavo cuenta). */
const pesos = (x: number) => x.toLocaleString("es-MX", { style: "currency", currency: "MXN", minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const metadata = { title: "Mis cálculos — Tasa" };

type Fila = { id: string; modo: string; referencia: string | null; municipio: string; lado: string; creado_en: string; resultado: { totC: number; totV: number } };

/** Los cálculos de traslado de quien entra, de los últimos 90 días (después se borran solos). */
export default async function MisCalculos() {
  await exigirRol(...TODOS_LOS_ROLES);
  const supabase = await crearClienteServidor();
  const { data } = await supabase
    .from("calculos_traslado")
    .select("id, modo, referencia, municipio, lado, creado_en, resultado->totC, resultado->totV")
    .order("creado_en", { ascending: false })
    .limit(100);
  const filas = ((data ?? []) as unknown as (Omit<Fila, "resultado"> & { totC: number; totV: number })[]);
  const lado = { C: "Comprador", V: "Vendedor", AMBOS: "Ambos" } as Record<string, string>;

  return (
    <>
      <Encabezado />
      <main className="flex flex-1 flex-col px-6 py-6">
        <div className="mx-auto w-full max-w-md">
          <Link href="/calculadora" className="toque text-[0.9375rem] font-semibold text-acento">← Calculadora</Link>
          <h1 className="mt-2 text-[1.5rem] font-bold tracking-tight">Mis cálculos</h1>
          <p className="mt-1 text-[0.9375rem] leading-6 text-secundario">Se guardan 90 días y después se borran solos.</p>
          {filas.length === 0 ? (
            <p className="mt-4 rounded-xl bg-alterno px-4 py-3 text-secundario">Todavía no tienes cálculos.</p>
          ) : (
            <ul className="mt-4 flex flex-col gap-2">
              {filas.map((f) => (
                <li key={f.id}>
                  <Link href={`/calculadora/${f.id}`} className="flex items-center justify-between gap-3 rounded-xl border border-linea bg-alterno px-4 py-3">
                    <span className="min-w-0">
                      <span className="block truncate font-semibold">{f.referencia ?? f.municipio}</span>
                      <span className="block text-[0.875rem] text-secundario">{[f.referencia ? f.municipio : null, lado[f.lado], f.modo === "completa" ? "completa" : "rápida", fechaCorta(f.creado_en)].filter(Boolean).join(" · ")}</span>
                    </span>
                    <span className="shrink-0 text-right font-bold tabular-nums">{pesos(Number(f.totC ?? 0) + Number(f.totV ?? 0))}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </main>
    </>
  );
}
