import Link from "next/link";
import { Etiqueta } from "@/components/etiqueta";
import { PantallaAdmin } from "@/components/pantalla-admin";
import { fechaCorta } from "@/lib/formato";
import { exigirRol } from "@/lib/sesion";
import { crearClienteServidor, oExplota } from "@/lib/supabase/server";
import { ESTADOS, type EstadoAltaSolicitud } from "./estados";

export const metadata = { title: "Solicitudes de alta — Tasa" };

type Fila = {
  id: string;
  nombre: string;
  correo: string;
  estado: EstadoAltaSolicitud;
  creada_en: string;
  posible_duplicado: boolean;
  rfc_por_revisar: boolean;
  capturada_por: string | null;
  csf_ruta: string | null;
  csf_borrada_en: string | null;
};

/** Finanzas la ve y captura; solo admin_org aprueba o rechaza. */
export default async function SolicitudesDeAlta({ searchParams }: { searchParams: Promise<{ ver?: string }> }) {
  const persona = await exigirRol("admin_org", "finanzas");
  const { ver } = await searchParams;
  const todas = ver === "todas";
  const supabase = await crearClienteServidor();
  let consulta = supabase
    .from("solicitudes_alta")
    .select("id, nombre, correo, estado, creada_en, posible_duplicado, rfc_por_revisar, capturada_por, csf_ruta, csf_borrada_en")
    .neq("estado", "subiendo")
    .order("creada_en", { ascending: false })
    .limit(200);
  if (!todas) consulta = consulta.eq("estado", "pendiente");
  const filas = oExplota(await consulta.returns<Fila[]>(), "las solicitudes de alta") ?? [];

  return (
    <PantallaAdmin titulo="Solicitudes de alta">
      <p className="mt-2 text-[0.9375rem] leading-6 text-secundario">
        Liga para pedir el alta: <strong>/alta/{persona.organizacion.slug}</strong>.
        {persona.rol === "admin_org" ? " Tú apruebas o rechazas." : " Administración aprueba o rechaza."}
      </p>
      <Link
        href="/admin/altas/nueva"
        className="mt-4 flex min-h-12 items-center justify-center rounded-lg bg-primario px-4 py-3 font-semibold text-sobre-primario"
      >
        Capturar una solicitud
      </Link>

      <nav className="mt-6 flex gap-4 text-[0.9375rem] font-semibold">
        <Link href="/admin/altas" className={todas ? "text-acento underline underline-offset-4" : "text-primario"}>Pendientes</Link>
        <Link href="/admin/altas?ver=todas" className={todas ? "text-primario" : "text-acento underline underline-offset-4"}>Todas</Link>
      </nav>

      {filas.length === 0 ? (
        <p className="mt-4 text-secundario">{todas ? "Todavía no hay solicitudes." : "No hay solicitudes pendientes."}</p>
      ) : (
        <ul className="mt-4 flex flex-col gap-3">
          {filas.map((f) => (
            <li key={f.id}>
              <Link href={`/admin/altas/${f.id}`} className="block rounded-xl border border-linea px-4 py-4">
                <div className="flex items-start justify-between gap-3">
                  <span className="font-semibold">{f.nombre}</span>
                  <Etiqueta tono={ESTADOS[f.estado].tono}>{ESTADOS[f.estado].texto}</Etiqueta>
                </div>
                <p className="mt-1 text-[0.9375rem] text-secundario">
                  {f.correo} · {fechaCorta(f.creada_en)}{f.capturada_por ? " · capturada" : ""}
                </p>
                {f.posible_duplicado || f.rfc_por_revisar || (!f.csf_ruta && !f.csf_borrada_en) ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {f.posible_duplicado ? <Etiqueta tono="error">Posible duplicado</Etiqueta> : null}
                    {f.rfc_por_revisar ? <Etiqueta tono="error">RFC por revisar</Etiqueta> : null}
                    {!f.csf_ruta && !f.csf_borrada_en ? <Etiqueta tono="proceso">CSF pendiente</Etiqueta> : null}
                  </div>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </PantallaAdmin>
  );
}
