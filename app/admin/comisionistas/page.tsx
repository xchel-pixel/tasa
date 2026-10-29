import Link from "next/link";
import { Etiqueta } from "@/components/etiqueta";
import { PantallaAdmin } from "@/components/pantalla-admin";
import { fechaCorta, pesos } from "@/lib/formato";
import { esStaff, exigirRol, ROLES_OPERACION } from "@/lib/sesion";
import { crearClienteServidor, oExplota } from "@/lib/supabase/server";

export const metadata = { title: "Comisionistas — Tasa" };

export type FilaComisionista = {
  persona_id: string;
  nombre: string;
  correo: string;
  activo: boolean;
  nivel: string;
  porcentaje: string | number;
  provisional: boolean;
  trabajos_activos: number;
  comision_mes: string | number;
  saldo_por_pagar: string | number;
  ultimo_acceso: string | null;
};

const FILTROS = [
  { clave: "activos", texto: "Activos" },
  { clave: "inactivos", texto: "Inactivos" },
  { clave: "todos", texto: "Todos" },
  { clave: "sin_csf", texto: "Sin CSF" },
] as const;

/** Buscador y filtro van en la dirección (`?q=…&ver=…`): se pueden compartir y regresar. */
export default async function Comisionistas({ searchParams }: PageProps<"/admin/comisionistas">) {
  const persona = await exigirRol(...ROLES_OPERACION);
  const staff = esStaff(persona);
  const { q, ver } = await searchParams;
  const texto = typeof q === "string" ? q.trim() : "";
  const filtro = FILTROS.find((f) => f.clave === ver)?.clave ?? "activos";

  const supabase = await crearClienteServidor();
  const [resumen, constancias] = await Promise.all([
    supabase.rpc("resumen_comisionistas"),
    supabase.from("comisionistas").select("persona_id, csf_ruta").returns<{ persona_id: string; csf_ruta: string | null }[]>(),
  ]);
  const todos = (oExplota(resumen, "los comisionistas") ?? []) as FilaComisionista[];
  const sinCsf = new Set((oExplota(constancias, "las constancias") ?? []).filter((c) => !c.csf_ruta).map((c) => c.persona_id));

  const normal = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
  const filas = todos
    .filter((c) =>
      filtro === "todos" ? true : filtro === "sin_csf" ? sinCsf.has(c.persona_id) : filtro === "activos" ? c.activo : !c.activo
    )
    .filter((c) => !texto || normal(`${c.nombre} ${c.correo}`).includes(normal(texto)));

  return (
    <PantallaAdmin titulo="Comisionistas">
      {/* Las altas nacen de una solicitud; la directa y la importación son solo de admin_org. */}
      {staff ? (
        <Link
          href="/admin/altas"
          className="mt-4 flex min-h-12 items-center justify-center rounded-lg bg-primario px-4 py-3 font-semibold text-sobre-primario"
        >
          Solicitudes de alta
        </Link>
      ) : null}
      {persona.rol === "admin_org" ? (
        <div className="mt-2 flex justify-center gap-5 text-[0.9375rem] font-semibold">
          <Link href="/admin/comisionistas/nuevo" className="toque text-acento underline underline-offset-4">Alta directa</Link>
          <Link href="/admin/comisionistas/importar" className="toque text-acento underline underline-offset-4">Importar desde una tabla</Link>
        </div>
      ) : null}

      <form className="mt-4" role="search">
        {filtro !== "activos" ? <input type="hidden" name="ver" value={filtro} /> : null}
        <label htmlFor="q" className="sr-only">Buscar</label>
        <input
          id="q"
          name="q"
          type="search"
          defaultValue={texto}
          placeholder="Buscar por nombre o correo"
          className="w-full rounded-lg border border-borde-campo bg-fondo px-4 py-3 text-[1.0625rem] focus:border-acento"
        />
      </form>

      <nav aria-label="Filtro" className="mt-3 flex flex-wrap gap-2">
        {FILTROS.map((f) => (
          <Link
            key={f.clave}
            href={`/admin/comisionistas?ver=${f.clave}${texto ? `&q=${encodeURIComponent(texto)}` : ""}`}
            aria-current={f.clave === filtro ? "page" : undefined}
            className={`toque rounded-full border px-4 text-[0.9375rem] font-semibold ${
              f.clave === filtro ? "border-primario bg-primario text-sobre-primario" : "border-linea bg-fondo text-primario"
            }`}
          >
            {f.texto}
          </Link>
        ))}
      </nav>

      {filas.length === 0 ? (
        <p className="mt-4 rounded-xl bg-alterno px-4 py-3 text-secundario">
          {texto ? "Nadie coincide con la búsqueda." : "No hay comisionistas en esta lista."}
        </p>
      ) : (
        <ul className="mt-4 flex flex-col gap-3">
          {filas.map((c) => (
            <li key={c.persona_id}>
              <Link href={`/admin/comisionistas/${c.persona_id}`} className="block rounded-xl border border-linea px-4 py-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold">{c.nombre}</p>
                    <p className="text-[0.9375rem] text-secundario">
                      {c.nivel} · {Number(c.porcentaje)}%{c.provisional ? " (provisional)" : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    {!c.activo ? <Etiqueta tono="error">Inactivo</Etiqueta> : null}
                    {sinCsf.has(c.persona_id) ? <Etiqueta tono="proceso">Sin CSF</Etiqueta> : null}
                  </div>
                </div>
                <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-[0.9375rem]">
                  <Dato etiqueta="Trabajos activos" valor={String(c.trabajos_activos)} />
                  <Dato etiqueta="Comisión del mes" valor={pesos(Number(c.comision_mes))} />
                  <Dato etiqueta="Saldo por pagar" valor={pesos(Number(c.saldo_por_pagar))} fuerte={Number(c.saldo_por_pagar) > 0} />
                  <Dato etiqueta="Último acceso" valor={c.ultimo_acceso ? fechaCorta(c.ultimo_acceso) : "Nunca"} />
                </dl>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </PantallaAdmin>
  );
}

function Dato({ etiqueta, valor, fuerte = false }: { etiqueta: string; valor: string; fuerte?: boolean }) {
  return (
    <div>
      <dt className="text-secundario">{etiqueta}</dt>
      <dd className={`font-semibold ${fuerte ? "text-acento" : ""}`}>{valor}</dd>
    </div>
  );
}
