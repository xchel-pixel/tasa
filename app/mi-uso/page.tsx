import Link from "next/link";
import { Encabezado } from "@/components/encabezado";
import { PedirMas } from "@/components/formularios-cupo";
import { PedirMasDxf } from "@/components/formularios-dxf";
import { VolverPortada } from "@/components/volver-portada";
import { miCupo, textoCupo, type HerramientaConCupo } from "@/lib/cupos";
import { miDxf, textoDxf } from "@/lib/dxf-saldo";
import { misHerramientas } from "@/lib/herramientas";
import { exigirRol } from "@/lib/sesion";
import { crearClienteServidor } from "@/lib/supabase/server";
import { fechaHora, NOMBRE_HERRAMIENTA, type EventoUso } from "@/lib/uso";

export const metadata = { title: "Mi uso — Tasa" };

const TIPO: Record<string, string> = { consulta: "Consulta", pdf: "PDF", dxf: "DXF" };

/** "Mi uso" del comisionista (0070): sus cupos del mes, lo consumido y su historial de consultas (solo clave y fecha). */
export default async function MiUso() {
  await exigirRol("comisionista");
  const supabase = await crearClienteServidor();
  const claves = new Set((await misHerramientas()).map((h) => h.clave));
  const conCupo = (["mapa_catastral", "mapa_catastral_pdf", "calculadora_traslado", "calculadora_traslado_completa"] as HerramientaConCupo[])
    .filter((h) => claves.has(h));
  const [cupos, dxf, eventos] = await Promise.all([
    Promise.all(conCupo.map(async (h) => [h, await miCupo(h)] as const)),
    miDxf(),
    // RLS: solo los suyos.
    supabase.from("eventos_uso").select("id, evento, clave, creado_en").eq("humo", false).in("evento", ["consulta", "pdf", "dxf"]).not("clave", "is", null)
      .order("creado_en", { ascending: false }).limit(100)
      .returns<Pick<EventoUso, "id" | "evento" | "clave" | "creado_en">[]>(),
  ]);
  const historial = eventos.data ?? [];

  return (
    <>
      <Encabezado />
      <main className="flex flex-1 flex-col px-6 py-6">
        <div className="mx-auto w-full max-w-md">
          <VolverPortada />
          <h1 className="mt-2 text-[1.5rem] font-bold tracking-tight">Mi uso</h1>
          <p className="mt-1 text-[0.9375rem] leading-6 text-secundario">Tus cupos de este mes y lo que has consultado. El cupo se reinicia el día 1.</p>

          <section className="mt-5 rounded-xl border border-linea px-4 py-3">
            <h2 className="font-semibold">Este mes</h2>
            {cupos.length ? (
              <ul className="mt-2 flex flex-col gap-3 text-[0.9375rem]">
                {cupos.map(([h, c]) => (
                  <li key={h}>
                    <div className="flex justify-between gap-3">
                      <span className="text-secundario">{NOMBRE_HERRAMIENTA[h] ?? h}</span>
                      <span className="text-right font-semibold">{c.usados} usado{c.usados === 1 ? "" : "s"}</span>
                    </div>
                    <p className="text-[0.875rem] text-secundario">{textoCupo(c)}</p>
                    {c.disponibles === 0 ? <PedirMas herramienta={h} /> : null}
                  </li>
                ))}
              </ul>
            ) : <p className="mt-1 text-[0.9375rem] text-secundario">No tienes herramientas con cupo.</p>}
            {dxf.autorizado ? (
              <div className="mt-3 border-t border-linea pt-3 text-[0.9375rem]">
                <div className="flex justify-between gap-3">
                  <span className="text-secundario">DXF del mapa</span>
                  <span className="font-semibold">{textoDxf(dxf)}</span>
                </div>
                <p className="text-[0.875rem] text-secundario">El saldo no vence. Bajar otra vez el mismo predio no gasta.</p>
                {!dxf.sin_limite && (dxf.saldo ?? 0) <= 0 ? <PedirMasDxf /> : null}
              </div>
            ) : null}
          </section>

          <section className="mt-4 rounded-xl border border-linea px-4 py-3">
            <h2 className="font-semibold">Mis consultas</h2>
            {historial.length ? (
              <ul className="mt-2 flex flex-col gap-2 text-[0.9375rem]">
                {historial.map((e) => (
                  <li key={e.id} className="flex flex-col">
                    <Link href={`/mapa-catastral?clave=${e.clave}`} className="toque font-mono text-acento underline underline-offset-4">{e.clave}</Link>
                    <span className="text-[0.875rem] text-secundario">{TIPO[e.evento] ?? e.evento} · {fechaHora(e.creado_en)}</span>
                  </li>
                ))}
              </ul>
            ) : <p className="mt-1 text-[0.9375rem] text-secundario">Todavía no consultas predios.</p>}
          </section>
        </div>
      </main>
    </>
  );
}
