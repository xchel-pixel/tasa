import Link from "next/link";
import { Etiqueta } from "@/components/etiqueta";
import { PantallaAdmin } from "@/components/pantalla-admin";
import { fechaCorta } from "@/lib/formato";
import { exigirRol, ROLES_OPERACION } from "@/lib/sesion";
import { crearClienteServidor, oExplota } from "@/lib/supabase/server";

export const metadata = { title: "Solicitudes por cotizar — Tasa" };

type Fila = {
  id: string;
  tipo: "cotizacion" | "tramite_directo";
  estado: "solicitada" | "vencida";
  cliente_nombre: string;
  creado_en: string;
  servicios: { nombre: string } | null;
  comisionistas: { personas: { nombre: string } | null } | null;
};

/** Lo que espera precio: solicitudes nuevas y cotizaciones vencidas que se pueden reemitir. */
export default async function SolicitudesPorCotizar() {
  await exigirRol(...ROLES_OPERACION);
  const supabase = await crearClienteServidor();
  const filas =
    oExplota(
      await supabase
        .from("solicitudes")
        .select("id, tipo, estado, cliente_nombre, creado_en, servicios(nombre), comisionistas(personas(nombre))")
        .in("estado", ["solicitada", "vencida"])
        .order("creado_en")
        .returns<Fila[]>(),
      "las solicitudes"
    ) ?? [];

  const nuevas = filas.filter((f) => f.estado === "solicitada");
  const vencidas = filas.filter((f) => f.estado === "vencida");

  return (
    <PantallaAdmin titulo="Solicitudes por cotizar">
      {nuevas.length === 0 ? (
        <p className="mt-4 rounded-xl bg-alterno px-4 py-3 text-secundario">No hay solicitudes nuevas.</p>
      ) : (
        <Lista filas={nuevas} />
      )}
      {vencidas.length > 0 ? (
        <>
          <h2 className="mt-8 text-[1.125rem] font-bold">Cotizaciones vencidas</h2>
          <p className="mt-1 text-[0.9375rem] text-secundario">Se pueden volver a cotizar.</p>
          <Lista filas={vencidas} />
        </>
      ) : null}
    </PantallaAdmin>
  );
}

function Lista({ filas }: { filas: Fila[] }) {
  return (
    <ul className="mt-4 flex flex-col gap-3">
      {filas.map((f) => (
        <li key={f.id}>
          <Link href={`/admin/solicitudes/${f.id}`} className="block rounded-xl border border-linea bg-alterno px-4 py-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-semibold">{f.cliente_nombre}</p>
                <p className="text-[0.9375rem] text-secundario">
                  {f.servicios?.nombre} · {f.comisionistas?.personas?.nombre}
                </p>
                <p className="text-[0.9375rem] text-secundario">{fechaCorta(f.creado_en)}</p>
              </div>
              <Etiqueta tono={f.tipo === "tramite_directo" ? "proceso" : "neutro"}>
                {f.tipo === "tramite_directo" ? "Trámite directo" : "Cotización"}
              </Etiqueta>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
