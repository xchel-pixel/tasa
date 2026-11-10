import { PantallaAdmin } from "@/components/pantalla-admin";
import { haceDiasMx, hoyMx } from "@/lib/estadisticas";
import { exigirRol } from "@/lib/sesion";
import { crearClienteServidor, oExplota } from "@/lib/supabase/server";
import { fechaHora } from "@/lib/uso";

export const metadata = { title: "Bitácora — Tasa" };

const ENTRADA = "mt-1 w-full rounded-lg border border-borde-campo bg-fondo px-3 py-2 text-[1rem] focus:border-acento";
const esFecha = (s: string | undefined) => Boolean(s && s.length === 10 && !Number.isNaN(Date.parse(`${s}T12:00:00Z`)));

type Fila = {
  id: number; creado_en: string; tabla: string; accion: "INSERT" | "UPDATE" | "DELETE"; motivo: string | null; quien: string | null; afectado: string | null;
  cambios: { campo: string; antes: string | null; despues: string | null }[];
};

const ACCION = { INSERT: "Alta", UPDATE: "Cambio", DELETE: "Baja" } as const;

/** La bitácora de la organización (0073): quién cambió qué, cuándo y por qué. Solo admin_org. */
export default async function Bitacora({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await exigirRol("admin_org");
  const q = await searchParams;
  const hoy = hoyMx();
  const hace30 = haceDiasMx(30);
  const desde = esFecha(q.desde) ? q.desde! : hace30;
  const hasta = esFecha(q.hasta) ? q.hasta! : hoy;
  const persona = q.persona && q.persona.length === 36 ? q.persona : null;
  const tabla = q.tabla && q.tabla.length <= 60 ? q.tabla : null;
  const supabase = await crearClienteServidor();
  const [datos, gente] = await Promise.all([
    supabase.rpc("bitacora_org", { p_desde: desde, p_hasta: hasta < desde ? desde : hasta, p_persona: persona, p_tabla: tabla }),
    supabase.from("membresias").select("persona_id, personas(nombre)").returns<{ persona_id: string; personas: { nombre: string } | null }[]>(),
  ]);
  if (datos.error) throw new Error(`No se pudo leer la bitácora: ${datos.error.message}`);
  const { filas, tablas } = datos.data as { filas: Fila[]; tablas: string[] };
  const personas = (oExplota(gente, "las personas") ?? []).map((g) => ({ id: g.persona_id, nombre: g.personas?.nombre ?? "—" }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));

  return (
    <PantallaAdmin titulo="Bitácora" ancha>
      <form method="get" className="mt-3 grid grid-cols-2 gap-3 rounded-xl border border-linea px-4 py-3 md:grid-cols-4">
        <label className="block text-[0.875rem] font-semibold">Desde<input type="date" name="desde" defaultValue={desde} className={ENTRADA} /></label>
        <label className="block text-[0.875rem] font-semibold">Hasta<input type="date" name="hasta" defaultValue={hasta} className={ENTRADA} /></label>
        <label className="block text-[0.875rem] font-semibold">Persona
          <select name="persona" defaultValue={persona ?? ""} className={ENTRADA}>
            <option value="">Todas</option>
            {personas.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
          </select>
        </label>
        <label className="block text-[0.875rem] font-semibold">Tabla
          <select name="tabla" defaultValue={tabla ?? ""} className={ENTRADA}>
            <option value="">Todas</option>
            {tablas.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
        <button type="submit" className="col-span-2 min-h-11 rounded-lg bg-primario px-4 font-semibold text-sobre-primario md:col-span-4">Ver</button>
      </form>
      <p className="mt-2 text-[0.875rem] text-secundario">
        {filas.length === 300 ? "Se muestran los 300 cambios más recientes; acota el periodo para ver más." : `${filas.length} cambio${filas.length === 1 ? "" : "s"}.`}
        {" "}Persona filtra a quien hizo el cambio o a quien afectó.
      </p>

      <ul className="mt-3 flex flex-col gap-2">
        {filas.map((f) => (
          <li key={f.id} className="rounded-xl border border-linea px-4 py-3 text-[0.9375rem]">
            <p className="font-semibold">{ACCION[f.accion]} · {f.tabla}{f.afectado ? ` · ${f.afectado}` : ""}</p>
            <p className="text-[0.875rem] text-secundario">{fechaHora(f.creado_en)} · {f.quien ?? "el sistema"}{f.motivo ? ` · ${f.motivo}` : ""}</p>
            {f.cambios.length ? (
              <details className="mt-1">
                <summary className="cursor-pointer text-[0.875rem] font-semibold text-acento">
                  {f.cambios.length} campo{f.cambios.length === 1 ? "" : "s"}: {f.cambios.slice(0, 4).map((c) => c.campo).join(", ")}{f.cambios.length > 4 ? "…" : ""}
                </summary>
                <dl className="mt-1 flex flex-col gap-1 text-[0.875rem]">
                  {f.cambios.map((c) => (
                    <div key={c.campo} className="[overflow-wrap:anywhere]">
                      <dt className="font-semibold">{c.campo}</dt>
                      <dd className="text-secundario">{c.antes ?? "—"} → {c.despues ?? "—"}</dd>
                    </div>
                  ))}
                </dl>
              </details>
            ) : null}
          </li>
        ))}
      </ul>
    </PantallaAdmin>
  );
}
