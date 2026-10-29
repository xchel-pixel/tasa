import { notFound } from "next/navigation";
import { PantallaAdmin } from "@/components/pantalla-admin";
import { exigirRol, ROLES_OPERACION } from "@/lib/sesion";
import { quienLaTrajo, type Procedencia } from "@/lib/liga-clientes";
import { crearClienteServidor, oExplota } from "@/lib/supabase/server";
import FormularioPrecio, { type ConvenioParaCotizar, type Ligable } from "./formulario-precio";

export const metadata = { title: "Cotizar — Tasa" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Solicitud = {
  id: string;
  tipo: "cotizacion" | "tramite_directo";
  estado: string;
  marca_id: string | null;
  inmueble_direccion: string;
  inmueble_municipio: string | null;
  inmueble_clave_catastral: string | null;
  inmueble_descripcion: string | null;
  cliente_nombre: string;
  cliente_telefono: string | null;
  cliente_correo: string | null;
  servicios: { nombre: string } | null;
  servicio_id: string;
  organizacion_id: string;
  quiere_tramite: boolean;
} & Procedencia;

export default async function Cotizar({ params }: PageProps<"/admin/solicitudes/[id]">) {
  await exigirRol(...ROLES_OPERACION);
  const { id } = await params;
  if (!UUID.test(id)) notFound();

  const supabase = await crearClienteServidor();
  const [sol, marcas, cuentas] = await Promise.all([
    supabase
      .from("solicitudes")
      .select(
        `id, tipo, estado, marca_id, inmueble_direccion, inmueble_municipio, inmueble_clave_catastral,
         inmueble_descripcion, cliente_nombre, cliente_telefono, cliente_correo,
         organizacion_id, origen, liga_sin_dueno, quiere_tramite, servicio_id,
         servicios(nombre), comisionistas(personas!comisionistas_persona_id_fkey(nombre)),
         liga:personas!solicitudes_liga_de_fkey(nombre)`
      )
      .eq("id", id)
      .maybeSingle()
      .returns<Solicitud | null>(),
    supabase.from("marcas").select("id, nombre, cuenta_sugerida_id").eq("activa", true).order("clave")
      .returns<{ id: string; nombre: string; cuenta_sugerida_id: string | null }[]>(),
    supabase.from("cuentas_receptoras").select("id, alias, banco, marca_id").eq("activa", true).order("alias")
      .returns<{ id: string; alias: string; banco: string | null; marca_id: string }[]>(),
  ]);

  const s = oExplota(sol, "la solicitud");
  if (!s) notFound();

  const datos: [string, string | null | undefined][] = [
    [s.comisionistas ? "Comisionista" : "Liga de cliente de", quienLaTrajo(s)],
    ["Servicio", s.servicios?.nombre],
    ["Dirección", [s.inmueble_direccion, s.inmueble_municipio].filter(Boolean).join(", ")],
    ["Clave catastral", s.inmueble_clave_catastral],
    ["Descripción", s.inmueble_descripcion],
    ["Cliente", s.cliente_nombre],
    ["Teléfono", s.cliente_telefono],
    ["Correo", s.cliente_correo],
  ];

  const cotizable = s.estado === "solicitada" || s.estado === "vencida";
  const [convenios, ligables] = cotizable ? await paraCotizar(supabase, s) : [[], []];
  const adjuntos = s.origen === "liga_cliente" ? await adjuntosDelCliente(supabase, s.organizacion_id, s.id) : [];

  return (
    <PantallaAdmin
      titulo={s.tipo === "tramite_directo" ? "Poner precio al trámite" : "Emitir cotización"}
      volver={{ href: "/admin/solicitudes", texto: "Solicitudes" }}
    >
      {s.quiere_tramite ? (
        <p className="mt-4 rounded-xl bg-exito-fondo px-4 py-3 font-semibold text-exito">
          El cliente quiere el trámite. Se vuelve trabajo (y va a Notion) cuando acepte la cotización.
        </p>
      ) : null}
      <dl className="mt-4 flex flex-col gap-2 rounded-xl bg-alterno px-4 py-3 text-[0.9375rem]">
        {datos.filter(([, v]) => v).map(([k, v]) => (
          <div key={k}>
            <dt className="text-secundario">{k}</dt>
            <dd className="font-semibold">{v}</dd>
          </div>
        ))}
      </dl>

      {adjuntos.length > 0 ? (
        <section className="mt-4">
          <h2 className="font-bold">Documentos del cliente</h2>
          <ul className="mt-2 flex flex-col gap-2">
            {adjuntos.map((a) => (
              <li key={a.url}>
                <a href={a.url} target="_blank" rel="noopener" className="font-semibold text-acento underline underline-offset-4">
                  {a.nombre}
                </a>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {cotizable ? (
        <FormularioPrecio
          solicitudId={s.id}
          tipo={s.tipo}
          marcaInicial={s.marca_id}
          marcas={oExplota(marcas, "las marcas") ?? []}
          cuentas={oExplota(cuentas, "las cuentas") ?? []}
          convenios={convenios}
          ligables={ligables}
        />
      ) : (
        <p className="mt-6 rounded-xl bg-tinte px-4 py-3">Esta solicitud ya no espera precio.</p>
      )}
    </PantallaAdmin>
  );
}

/**
 * Lo que subió el cliente por la liga (bucket privado `clientes`), con URL firmada por 10 minutos.
 * La ruta es <organización>/<solicitud>/<token>/<archivo>.
 */
async function adjuntosDelCliente(
  supabase: Awaited<ReturnType<typeof crearClienteServidor>>,
  org: string,
  id: string
): Promise<{ nombre: string; url: string }[]> {
  const storage = supabase.storage.from("clientes");
  const { data: carpetas } = await storage.list(`${org}/${id}`);
  const rutas: string[] = [];
  for (const c of carpetas ?? []) {
    const { data: archivos } = await storage.list(`${org}/${id}/${c.name}`);
    for (const a of archivos ?? []) rutas.push(`${org}/${id}/${c.name}/${a.name}`);
  }
  if (rutas.length === 0) return [];
  const { data } = await storage.createSignedUrls(rutas, 600);
  return (data ?? []).flatMap((d) =>
    d.signedUrl && d.path ? [{ nombre: d.path.split("/").pop()!.replace(/^d+-/, ""), url: d.signedUrl }] : []
  );
}

type FilaConvenio = {
  id: string;
  nombre: string;
  comision_regla: "normal" | "ninguna" | "fija";
  comision_pct: string | number | null;
  vigente_desde: string | null;
  vigente_hasta: string | null;
  convenio_precios: { servicio_id: string; marca_id: string | null; honorario_tipo: "fijo" | "sin_costo" | "estimado"; monto: string | number; monto_minimo: string | number | null; nota: string | null }[];
};

/**
 * Lo que necesita el formulario además de marcas y cuentas: los convenios vigentes hoy con sus
 * precios para este servicio, y los trabajos recientes a los que se puede ligar un "sin costo"
 * (primero los del mismo cliente).
 */
async function paraCotizar(
  supabase: Awaited<ReturnType<typeof crearClienteServidor>>,
  s: Solicitud
): Promise<[ConvenioParaCotizar[], Ligable[]]> {
  const hoy = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City" }).format(new Date());
  const hace90 = new Date(Date.now() - 90 * 86_400_000).toISOString();
  const [conv, trabajos] = await Promise.all([
    supabase
      .from("convenios")
      .select("id, nombre, comision_regla, comision_pct, vigente_desde, vigente_hasta, convenio_precios(servicio_id, marca_id, honorario_tipo, monto, monto_minimo, nota)")
      .eq("activo", true)
      .order("nombre")
      .returns<FilaConvenio[]>(),
    supabase
      .from("solicitudes")
      .select("id, folio, cliente_nombre, servicios(nombre)")
      .in("estado", ["cotizada", "tramite"])
      .neq("id", s.id)
      .gte("creado_en", hace90)
      .order("creado_en", { ascending: false })
      .limit(60)
      .returns<{ id: string; folio: string | null; cliente_nombre: string; servicios: { nombre: string } | null }[]>(),
  ]);
  const convenios = (oExplota(conv, "los convenios") ?? [])
    .filter((c) => (!c.vigente_desde || c.vigente_desde <= hoy) && (!c.vigente_hasta || c.vigente_hasta >= hoy))
    .map((c) => ({
      id: c.id,
      nombre: c.nombre,
      comision:
        c.comision_regla === "ninguna"
          ? "No genera comisión."
          : c.comision_regla === "fija"
            ? `Comisión fija del ${Number(c.comision_pct)}%.`
            : "Comisión normal.",
      precios: c.convenio_precios
        .filter((p) => p.servicio_id === s.servicio_id)
        .map((p) => ({
          marca_id: p.marca_id,
          tipo: p.honorario_tipo,
          monto: Number(p.monto),
          minimo: p.monto_minimo === null ? null : Number(p.monto_minimo),
          nota: p.nota,
        })),
    }));
  const mismoCliente = (n: string) => n.trim().toLowerCase() === s.cliente_nombre.trim().toLowerCase();
  const ligables = (oExplota(trabajos, "los trabajos para ligar") ?? [])
    .sort((a, b) => Number(mismoCliente(b.cliente_nombre)) - Number(mismoCliente(a.cliente_nombre)))
    .map((x) => ({ id: x.id, texto: [x.folio ?? "Sin folio", x.cliente_nombre, x.servicios?.nombre].filter(Boolean).join(" · ") }));
  return [convenios, ligables];
}
