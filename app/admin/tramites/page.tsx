import Link from "next/link";
import { ListaTramites } from "@/components/lista-tramites";
import { PantallaAdmin } from "@/components/pantalla-admin";
import { exigirRol, ROLES_OPERACION } from "@/lib/sesion";
import { enCurso, GRUPOS, grupoDe, leerTramites, ordenar, pendienteDeFolio, saldoDe, type Tramite } from "@/lib/tramites";

export const metadata = { title: "Trámites — Tasa" };

const POR_PAGINA = 20;
const DIAS_ENTREGADOS = 30;
const CAMPO = "mt-1 w-full rounded-lg border border-borde-campo bg-fondo px-3 py-2 text-[1rem]";

type Filtros = {
  estatus: string;
  marca: string;
  servicio: string;
  origen: string;
  dueno: string;
  folio: boolean;
  cobro: boolean;
  quiere: boolean;
  /** Estimados sin honorario final. */
  estimado: boolean;
  q: string;
  todos: boolean;
  pagina: number;
};

const texto = (v: string | string[] | undefined) => (typeof v === "string" ? v.trim() : "");
const sinAcentos = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

function leerFiltros(p: Record<string, string | string[] | undefined>): Filtros {
  // Las ligas del inicio llegan como ?ver=sin_folio / ?ver=por_cobrar.
  const ver = texto(p.ver);
  return {
    estatus: texto(p.estatus),
    marca: texto(p.marca),
    servicio: texto(p.servicio),
    origen: texto(p.origen),
    dueno: texto(p.dueno),
    folio: texto(p.folio) === "1" || ver === "sin_folio",
    cobro: texto(p.cobro) === "1" || ver === "por_cobrar",
    quiere: texto(p.quiere) === "1",
    estimado: texto(p.estimado) === "1" || ver === "estimados",
    q: texto(p.q).slice(0, 80),
    todos: texto(p.todos) === "1",
    pagina: Math.max(1, Number(texto(p.pagina)) || 1),
  };
}

/** La dirección con estos filtros (sin los vacíos). */
function ligaCon(f: Filtros, cambios: Partial<Filtros>): string {
  const g = { ...f, pagina: 1, ...cambios };
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(g)) {
    if (v === true) p.set(k, "1");
    else if (typeof v === "string" && v) p.set(k, v);
    else if (k === "pagina" && typeof v === "number" && v > 1) p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `/admin/tramites?${s}` : "/admin/tramites";
}

function aplicar(tramites: Tramite[], f: Filtros): Tramite[] {
  const hace = new Date(Date.now() - DIAS_ENTREGADOS * 86_400_000).toISOString().slice(0, 10);
  const q = sinAcentos(f.q);
  // Folio pendiente y por cobrar buscan en todo (un entregado puede deber); si no, por omisión solo lo en curso.
  const todoEstatus = f.estatus === "todos" || (!f.estatus && (f.folio || f.cobro || f.estimado));
  return tramites.filter((t) => {
    const grupo = grupoDe(t);
    if (!f.estatus && !todoEstatus && !enCurso(t)) return false;
    if (f.estatus && f.estatus !== "todos" && grupo !== f.estatus) return false;
    // Pagado sin haberse entregado no tiene fecha de entrega: cuenta desde el pago.
    const entregado = t.fecha_entrega ?? t.pagado_en;
    if (grupo === "entregados" && !f.todos && entregado && entregado < hace) return false;
    if (f.marca && t.marca_id !== f.marca) return false;
    if (f.servicio && t.servicio_id !== f.servicio) return false;
    if (f.origen && t.origen !== f.origen) return false;
    if (f.dueno && (f.dueno === "organizacion" ? t.dueno_id !== null : t.dueno_id !== f.dueno)) return false;
    if (f.folio && !pendienteDeFolio(t)) return false;
    if (f.cobro && saldoDe(t) <= 0) return false;
    if (f.quiere && !(t.quiere_tramite && t.estado === "solicitada")) return false;
    if (f.estimado && !t.estimado_pendiente) return false;
    if (q && ![t.folio, t.cliente_nombre, t.dueno, t.inmueble_clave_catastral].some((v) => v && sinAcentos(v).includes(q))) return false;
    return true;
  });
}

/** Opciones únicas (id → nombre) de lo que hay, ordenadas por nombre. */
function opciones(tramites: Tramite[], de: (t: Tramite) => [string | null, string | null]) {
  const m = new Map<string, string>();
  for (const t of tramites) {
    const [id, nombre] = de(t);
    if (id && nombre) m.set(id, nombre);
  }
  return [...m].sort((a, b) => a[1].localeCompare(b[1], "es"));
}

/**
 * Todos los trámites, con el mismo diseño de tarjetas del comisionista. Por omisión, solo lo en
 * curso; entregados y cancelados detrás de filtro, y los entregados de hace más de 30 días solo
 * con "Ver todos". admin_marca ve lo de sus marcas (el RLS filtra). El equipo no entra aquí:
 * tiene "Mis trámites".
 */
export default async function Tramites({ searchParams }: PageProps<"/admin/tramites">) {
  const persona = await exigirRol(...ROLES_OPERACION);
  const f = leerFiltros(await searchParams);
  const todos = await leerTramites({ conNombres: true });

  const filtrados = aplicar(todos, f);
  const orden = GRUPOS.map((g) => g.clave as string);
  filtrados.sort((a, b) => orden.indexOf(grupoDe(a)) - orden.indexOf(grupoDe(b)) || ordenar(a, b));
  const paginas = Math.max(1, Math.ceil(filtrados.length / POR_PAGINA));
  const pagina = Math.min(f.pagina, paginas);
  const enPagina = filtrados.slice((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA);
  const cuentas: Record<string, number> = {};
  for (const t of filtrados) cuentas[grupoDe(t)] = (cuentas[grupoDe(t)] ?? 0) + 1;

  const indicadores = [
    { texto: "Por cotizar", cuenta: todos.filter((t) => t.estado === "solicitada").length, href: ligaCon(VACIO, { estatus: "por_cotizar" }) },
    { texto: "Quieren el trámite", cuenta: todos.filter((t) => t.quiere_tramite && t.estado === "solicitada").length, href: ligaCon(VACIO, { estatus: "por_cotizar", quiere: true }) },
    { texto: "Pendientes de folio", cuenta: todos.filter(pendienteDeFolio).length, href: ligaCon(VACIO, { folio: true }) },
    { texto: "En elaboración", cuenta: todos.filter((t) => grupoDe(t) === "en_elaboracion").length, href: ligaCon(VACIO, { estatus: "en_elaboracion" }) },
    { texto: "Por cobrar", cuenta: todos.filter((t) => saldoDe(t) > 0).length, href: ligaCon(VACIO, { cobro: true }) },
  ];
  const hayFiltros = Boolean(f.estatus || f.marca || f.servicio || f.origen || f.dueno || f.folio || f.cobro || f.quiere || f.estimado || f.q || f.todos);

  return (
    <PantallaAdmin titulo="Trámites">
      <ul className="mt-4 grid grid-cols-2 gap-2">
        {indicadores.map((i) => (
          <li key={i.texto} className={i.texto === "Por cobrar" ? "col-span-2" : ""}>
            <Link href={i.href} className="flex min-h-12 items-center justify-between gap-2 rounded-xl border border-linea bg-alterno px-3 py-2">
              <span className="text-[0.9375rem] leading-5">{i.texto}</span>
              <span className="text-[1.125rem] font-bold text-primario">{i.cuenta}</span>
            </Link>
          </li>
        ))}
      </ul>

      <form action="/admin/tramites" className="mt-4">
        <label htmlFor="q" className="sr-only">Buscar</label>
        <div className="flex gap-2">
          <input id="q" name="q" type="search" defaultValue={f.q} placeholder="Folio, cliente, comisionista o clave"
            className="min-w-0 flex-1 rounded-lg border border-borde-campo bg-fondo px-3 py-2 text-[1rem]" />
          <button type="submit" className="min-h-11 rounded-lg bg-primario px-4 font-semibold text-sobre-primario">Buscar</button>
        </div>

        <details open={hayFiltros && !f.q} className="mt-3 rounded-xl border border-linea">
          <summary className="toque flex min-h-12 cursor-pointer list-none items-center justify-between px-4 font-semibold [&::-webkit-details-marker]:hidden">
            Filtros{hayFiltros ? " (activos)" : ""} <span aria-hidden="true" className="text-secundario">▾</span>
          </summary>
          <div className="grid grid-cols-1 gap-3 px-4 pb-4">
            <Selector nombre="estatus" etiqueta="Estatus" valor={f.estatus} vacio="En curso"
              opciones={[...GRUPOS.map((g) => [g.clave, g.titulo] as [string, string]), ["todos", "Todos los estatus"]]} />
            <Selector nombre="marca" etiqueta="Marca" valor={f.marca} vacio="Todas" opciones={opciones(todos, (t) => [t.marca_id, t.marca])} />
            <Selector nombre="servicio" etiqueta="Servicio" valor={f.servicio} vacio="Todos" opciones={opciones(todos, (t) => [t.servicio_id, t.servicio])} />
            <Selector nombre="origen" etiqueta="Origen" valor={f.origen} vacio="Todos"
              opciones={[["comisionista", "Comisionista"], ["liga", "Liga de cliente"], ["equipo", "Equipo"]]} />
            <Selector nombre="dueno" etiqueta="Dueño" valor={f.dueno} vacio="Todos"
              opciones={[...opciones(todos, (t) => [t.dueno_id, t.dueno]), ["organizacion", "La organización"]]} />
            <Casilla nombre="folio" texto="Pendiente de folio" marcada={f.folio} />
            <Casilla nombre="cobro" texto="Con saldo por cobrar" marcada={f.cobro} />
            <Casilla nombre="estimado" texto="Estimado sin honorario final" marcada={f.estimado} />
            <Casilla nombre="todos" texto={`Ver todos (incluye entregados de hace más de ${DIAS_ENTREGADOS} días)`} marcada={f.todos} />
            {f.quiere ? <input type="hidden" name="quiere" value="1" /> : null}
            <div className="grid grid-cols-2 gap-2">
              <button type="submit" className="min-h-12 rounded-lg bg-primario px-3 font-semibold text-sobre-primario">Filtrar</button>
              <Link href="/admin/tramites" className="flex min-h-12 items-center justify-center rounded-lg border border-primario px-3 font-semibold text-primario">
                Quitar filtros
              </Link>
            </div>
          </div>
        </details>
      </form>

      <p className="mt-4 text-[0.9375rem] text-secundario">
        {filtrados.length === 1 ? "1 trámite" : `${filtrados.length} trámites`}
        {f.quiere ? " · quieren el trámite" : ""}
        {f.estimado ? " · estimados sin honorario final" : ""}
        {!f.estatus && !f.folio && !f.cobro && !f.estimado ? " en curso" : ""}
      </p>
      <ListaTramites tramites={enPagina} usuario={persona.id} seccion="tramites" conDueno cuentas={cuentas}
        vacio={hayFiltros ? "Nada con estos filtros." : "No hay trámites en curso."} />

      {paginas > 1 ? (
        <nav aria-label="Páginas" className="mt-6 flex items-center justify-between gap-3">
          {pagina > 1 ? <Link href={ligaCon(f, { pagina: pagina - 1 })} className="toque font-semibold text-acento">← Anterior</Link> : <span />}
          <span className="text-[0.9375rem] text-secundario">Página {pagina} de {paginas}</span>
          {pagina < paginas ? <Link href={ligaCon(f, { pagina: pagina + 1 })} className="toque font-semibold text-acento">Siguiente →</Link> : <span />}
        </nav>
      ) : null}
    </PantallaAdmin>
  );
}

const VACIO: Filtros = { estatus: "", marca: "", servicio: "", origen: "", dueno: "", folio: false, cobro: false, quiere: false, estimado: false, q: "", todos: false, pagina: 1 };

function Selector({ nombre, etiqueta, valor, vacio, opciones }: {
  nombre: string; etiqueta: string; valor: string; vacio: string; opciones: [string, string][];
}) {
  return (
    <div>
      <label htmlFor={nombre} className="block text-[0.9375rem] font-semibold">{etiqueta}</label>
      <select id={nombre} name={nombre} defaultValue={valor} className={CAMPO}>
        <option value="">{vacio}</option>
        {opciones.map(([id, nombre]) => <option key={id} value={id}>{nombre}</option>)}
      </select>
    </div>
  );
}

function Casilla({ nombre, texto, marcada }: { nombre: string; texto: string; marcada: boolean }) {
  return (
    <label className="toque flex items-start gap-3 leading-6">
      <input type="checkbox" name={nombre} value="1" defaultChecked={marcada} className="mt-1 size-5 shrink-0" />
      <span>{texto}</span>
    </label>
  );
}
