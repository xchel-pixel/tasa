import { fechaCorta } from "@/lib/formato";
import { crearClienteServidor, oExplota } from "@/lib/supabase/server";

/**
 * Reporte de uso de herramientas en un mes (0057): usos por herramienta y por comisionista, extras
 * liberados y cuántos cálculos terminaron en solicitud de avalúo (conversión). Sirve igual para las
 * herramientas que vengan: todo sale de usos_herramienta y extras_herramienta.
 */
export async function UsoHerramientas({ mes, siguiente }: { mes: string; siguiente: string }) {
  const supabase = await crearClienteServidor();
  const [usos, extras, nombres, dxf] = await Promise.all([
    supabase.from("usos_herramienta").select("herramienta, solicitud_id, personas(nombre)")
      .gte("creado_en", `${mes}T00:00:00-06:00`).lt("creado_en", `${siguiente}T00:00:00-06:00`)
      .returns<{ herramienta: string; solicitud_id: string | null; personas: { nombre: string } | null }[]>(),
    supabase.from("extras_herramienta").select("herramienta, cantidad, motivo, personas!extras_herramienta_persona_id_fkey(nombre)").eq("mes", mes)
      .returns<{ herramienta: string; cantidad: number; motivo: string; personas: { nombre: string } | null }[]>(),
    supabase.from("herramientas").select("clave, nombre").returns<{ clave: string; nombre: string }[]>(),
    // DXF del mapa catastral (0065): cada predio nuevo que alguien bajó, con el saldo que le quedó.
    supabase.from("dxf_descargas").select("id, clave, saldo_despues, veces, creado_en, personas(nombre)")
      .gte("creado_en", `${mes}T00:00:00-06:00`).lt("creado_en", `${siguiente}T00:00:00-06:00`).order("creado_en", { ascending: false })
      .returns<{ id: number; clave: string; saldo_despues: number | null; veces: number; creado_en: string; personas: { nombre: string } | null }[]>(),
  ]);
  const listaDxf = oExplota(dxf, "los DXF") ?? [];
  const nombre = new Map((oExplota(nombres, "las herramientas") ?? []).map((h) => [h.clave, h.nombre]));
  const lista = oExplota(usos, "el uso de herramientas") ?? [];
  const listaExtras = oExplota(extras, "los extras") ?? [];

  const porHerramienta = new Map<string, { usos: number; convertidos: number }>();
  const porPersona = new Map<string, Map<string, number>>();
  for (const u of lista) {
    const h = porHerramienta.get(u.herramienta) ?? { usos: 0, convertidos: 0 };
    h.usos += 1;
    if (u.solicitud_id) h.convertidos += 1;
    porHerramienta.set(u.herramienta, h);
    const quien = u.personas?.nombre ?? "—";
    const m = porPersona.get(quien) ?? new Map<string, number>();
    m.set(u.herramienta, (m.get(u.herramienta) ?? 0) + 1);
    porPersona.set(quien, m);
  }

  return (
    <>
      <h2 className="mt-8 text-[1.125rem] font-bold">Uso de herramientas</h2>
      {lista.length === 0 && listaExtras.length === 0 && listaDxf.length === 0 ? (
        <p className="mt-2 text-[0.9375rem] text-secundario">Nadie usó herramientas con cupo este mes.</p>
      ) : null}
      {porHerramienta.size ? (
        <section className="mt-4 rounded-xl border border-linea px-4 py-3">
          <h3 className="font-semibold">Por herramienta</h3>
          <ul className="mt-2 flex flex-col gap-1 text-[0.9375rem]">
            {[...porHerramienta].map(([h, d]) => (
              <li key={h} className="flex justify-between gap-3">
                <span className="text-secundario">{nombre.get(h) ?? h}</span>
                <span className="font-semibold">{d.usos} · {d.convertidos} en solicitud de avalúo ({Math.round((d.convertidos / d.usos) * 100)} %)</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {porPersona.size ? (
        <section className="mt-4 rounded-xl border border-linea px-4 py-3">
          <h3 className="font-semibold">Por persona</h3>
          <ul className="mt-2 flex flex-col gap-1 text-[0.9375rem]">
            {[...porPersona].sort((a, b) => a[0].localeCompare(b[0], "es")).map(([quien, m]) => (
              <li key={quien} className="flex justify-between gap-3">
                <span className="text-secundario">{quien}</span>
                <span className="text-right font-semibold">{[...m].map(([h, n]) => `${nombre.get(h) ?? h}: ${n}`).join(" · ")}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {listaExtras.length ? (
        <section className="mt-4 rounded-xl border border-linea px-4 py-3">
          <h3 className="font-semibold">Extras liberados</h3>
          <ul className="mt-2 flex flex-col gap-1 text-[0.9375rem]">
            {listaExtras.map((e, i) => (
              <li key={i}>
                <span className="font-semibold">{e.personas?.nombre ?? "—"}</span> · {nombre.get(e.herramienta) ?? e.herramienta}: {e.cantidad}
                <span className="block text-secundario">{e.motivo}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {listaDxf.length ? (
        <section className="mt-4 rounded-xl border border-linea px-4 py-3">
          <h3 className="font-semibold">DXF del mapa catastral ({listaDxf.length})</h3>
          <ul className="mt-2 flex flex-col gap-1 text-[0.9375rem]">
            {listaDxf.map((d) => (
              <li key={d.id} className="flex justify-between gap-3">
                <span className="text-secundario">
                  <span className="font-semibold text-texto">{d.personas?.nombre ?? "—"}</span> · <span className="font-mono">{d.clave}</span> · {fechaCorta(d.creado_en)}
                  {d.veces > 1 ? ` · ${d.veces} veces` : ""}
                </span>
                <span className="shrink-0 font-semibold">{d.saldo_despues === null ? "sin límite" : `quedan ${d.saldo_despues}`}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}
