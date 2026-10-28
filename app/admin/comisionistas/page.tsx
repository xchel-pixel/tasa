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
] as const;

/** Buscador y filtro van en la dirección (`?q=…&ver=…`): se pueden compartir y regresar. */
export default async function Comisionistas({ searchParams }: PageProps<"/admin/comisionistas">) {
  const staff = esStaff(await exigirRol(...ROLES_OPERACION));
  const { q, ver } = await searchParams;
  const texto = typeof q === "string" ? q.trim() : "";
  const filtro = FILTROS.find((f) => f.clave === ver)?.clave ?? "activos";

  const supabase = await crearClienteServidor();
  const todos = (oExplota(await supabase.rpc("resumen_comisionistas"), "los comisionistas") ?? []) as FilaComisionista[];

  const normal = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
  const filas = todos
    .filter((c) => (filtro === "todos" ? true : filtro === "activos" ? c.activo : !c.activo))
    .filter((c) => !texto || normal(`${c.nombre} ${c.correo}`).includes(normal(texto)));

  return (
    <PantallaAdmin titulo="Comisionistas">
      <Link
        href="/admin/comisionistas/nuevo"
        className="mt-4 flex min-h-12 items-center justify-center rounded-lg bg-primario px-4 py-3 font-semibold text-sobre-primario"
      >
        Dar de alta
      </Link>
      {staff ? (
        <Link href="/admin/comisionistas/importar" className="toque mt-2 block text-center text-[0.9375rem] font-semibold text-acento underline underline-offset-4">
          Importar varios desde una tabla
        </Link>
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

      <nav aria-label="Filtro" className="mt-3 flex gap-2">
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
                  {!c.activo ? <Etiqueta tono="error">Inactivo</Etiqueta> : null}
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
