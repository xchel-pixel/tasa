import { PantallaAdmin } from "@/components/pantalla-admin";
import { filtrosDe, HERRAMIENTAS_FILTRO, parametros, queryDe, tablaActividad, tablas, type ActividadComisionista, type Estadisticas, type Tabla } from "@/lib/estadisticas";
import { exigirRol } from "@/lib/sesion";
import { crearClienteServidor, oExplota } from "@/lib/supabase/server";
import { NOMBRE_HERRAMIENTA } from "@/lib/uso";

export const metadata = { title: "Estadísticas — Tasa" };

const ENTRADA = "mt-1 w-full rounded-lg border border-borde-campo bg-fondo px-3 py-2 text-[1rem] focus:border-acento";

function VerTabla({ t, csv, vacio }: { t: Tabla; csv: string; vacio: string }) {
  return (
    <section className="mt-6">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-[1.125rem] font-bold">{t.titulo}</h2>
        <a href={csv} className="toque shrink-0 text-[0.875rem] font-semibold text-acento underline underline-offset-4">Exportar CSV</a>
      </div>
      {t.filas.length ? (
        <div className="mt-2 overflow-x-auto rounded-xl border border-linea">
          <table className="w-full min-w-max border-collapse text-left text-[0.875rem] leading-5">
            <thead className="bg-alterno">
              <tr>{t.columnas.map((c) => <th key={c} className="px-3 py-2 font-semibold">{c}</th>)}</tr>
            </thead>
            <tbody>
              {t.filas.map((f, i) => (
                <tr key={i} className="border-t border-linea">
                  {f.map((v, j) => <td key={j} className={`px-3 py-2 ${j === 0 ? "font-semibold" : ""}`}>{v}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <p className="mt-2 text-[0.9375rem] text-secundario">{vacio}</p>}
    </section>
  );
}

/** Estadísticas (0073): admin_org y finanzas, solo lectura. Sin lo de humo. */
export default async function EstadisticasPagina({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await exigirRol("admin_org", "finanzas");
  const f = filtrosDe(await searchParams);
  const supabase = await crearClienteServidor();
  const [datos, gente, niveles, actividad] = await Promise.all([
    supabase.rpc("estadisticas", parametros(f)),
    supabase.from("membresias").select("persona_id, rol, personas(nombre)").in("rol", ["comisionista", "equipo"])
      .returns<{ persona_id: string; rol: string; personas: { nombre: string } | null }[]>(),
    supabase.from("niveles").select("id, nombre").order("orden").returns<{ id: string; nombre: string }[]>(),
    supabase.rpc("inactividad_org"),
  ]);
  if (datos.error) throw new Error(`No se pudieron calcular las estadísticas: ${datos.error.message}`);
  const t = tablas(datos.data as Estadisticas);
  const personas = (oExplota(gente, "las personas") ?? []).map((g) => ({ id: g.persona_id, nombre: g.personas?.nombre ?? "—" }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
  const ligaCsv = (tabla: string) => `/admin/estadisticas/csv?${queryDe(f, { tabla })}`;

  return (
    <PantallaAdmin titulo="Estadísticas" ancha>
      <form method="get" className="mt-3 grid grid-cols-2 gap-3 rounded-xl border border-linea px-4 py-3 md:grid-cols-5">
        <label className="block text-[0.875rem] font-semibold">Desde<input type="date" name="desde" defaultValue={f.desde} className={ENTRADA} /></label>
        <label className="block text-[0.875rem] font-semibold">Hasta<input type="date" name="hasta" defaultValue={f.hasta} className={ENTRADA} /></label>
        <label className="block text-[0.875rem] font-semibold">Persona
          <select name="persona" defaultValue={f.persona ?? ""} className={ENTRADA}>
            <option value="">Todas</option>
            {personas.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
          </select>
        </label>
        <label className="block text-[0.875rem] font-semibold">Nivel
          <select name="nivel" defaultValue={f.nivel ?? ""} className={ENTRADA}>
            <option value="">Todos</option>
            {(oExplota(niveles, "los niveles") ?? []).map((n) => <option key={n.id} value={n.id}>{n.nombre}</option>)}
          </select>
        </label>
        <label className="col-span-2 block text-[0.875rem] font-semibold md:col-span-1">Herramienta
          <select name="herramienta" defaultValue={f.herramienta ?? ""} className={ENTRADA}>
            <option value="">Todas</option>
            {HERRAMIENTAS_FILTRO.map((h) => <option key={h} value={h}>{NOMBRE_HERRAMIENTA[h]}</option>)}
          </select>
        </label>
        <button type="submit" className="col-span-2 min-h-11 rounded-lg bg-primario px-4 font-semibold text-sobre-primario md:col-span-5">Ver</button>
      </form>
      <p className="mt-2 text-[0.875rem] leading-6 text-secundario">
        Sin las corridas de prueba (humo). El uso contra cupo se compara cuando el periodo es un solo mes. Las consultas se registran desde el 9 nov 2026.
      </p>

      <VerTabla t={t.uso} csv={ligaCsv("uso")} vacio="Sin uso en el periodo." />
      <VerTabla t={t.personas} csv={ligaCsv("personas")} vacio="Nadie usó herramientas con cupo en el periodo." />
      <VerTabla t={t.embudo} csv={ligaCsv("embudo")} vacio="Sin consultas ni solicitudes desde el mapa o la calculadora." />
      <VerTabla t={t.zonas} csv={ligaCsv("zonas")} vacio="Sin consultas del mapa en el periodo." />
      <VerTabla t={t.salud} csv={ligaCsv("salud")} vacio="Sin consultas a la fuente en el periodo." />
      <VerTabla t={tablaActividad((actividad.data ?? []) as ActividadComisionista[])} csv={ligaCsv("actividad")} vacio="Sin comisionistas activos." />
    </PantallaAdmin>
  );
}
