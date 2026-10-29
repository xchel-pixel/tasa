import { Marca } from "@/components/marca";
import { crearClienteServidor } from "@/lib/supabase/server";
import FormularioCliente from "./formulario-cliente";

export const metadata = { title: "Solicitud — Tasa" };

type DatosLiga = {
  organizacion: string;
  con: string;
  aviso_version: number | null;
  servicios: { id: string; nombre: string }[];
};

/**
 * Se ve sin sesión: aquí un cliente pide una cotización o un trámite a nombre de quien le pasó la
 * liga. Del dueño solo se muestra su nombre para mostrar; nunca su correo ni su teléfono.
 * `anon` no lee ninguna tabla: todo pasa por funciones de la base.
 */
export default async function SolicitudDeCliente({ params }: { params: Promise<{ org: string; codigo: string }> }) {
  const { org, codigo } = await params;
  const supabase = await crearClienteServidor();
  const { data } = await supabase.rpc("datos_liga_cliente", { p_org: org, p_codigo: codigo });
  const datos = data as DatosLiga | null;

  return (
    <main className="flex flex-1 flex-col px-6 py-10">
      <div className="mx-auto w-full max-w-sm">
        <Marca alto={56} prioridad />
        {!datos ? (
          <>
            <h1 className="mt-6 text-[1.5rem] font-bold tracking-tight">Esta liga no es válida</h1>
            <p className="mt-2 leading-7 text-secundario">Pídele de nuevo la liga a quien te la mandó.</p>
          </>
        ) : (
          <>
            <h1 className="mt-6 text-[1.5rem] font-bold tracking-tight">Solicitud con {datos.con}</h1>
            <p className="mt-1 text-[0.9375rem] leading-6 text-secundario">
              Pide tu cotización o tu trámite de {datos.organizacion}. Te contactamos para darle seguimiento.
            </p>
            {datos.aviso_version && datos.servicios.length > 0 ? (
              <FormularioCliente
                org={org.toLowerCase()}
                codigo={codigo}
                con={datos.con}
                servicios={datos.servicios}
                avisoVersion={datos.aviso_version}
                ligaAviso={`/privacidad?org=${encodeURIComponent(org.toLowerCase())}`}
              />
            ) : (
              <p className="mt-8 rounded-lg border border-linea px-4 py-3 leading-7">
                Por ahora no se reciben solicitudes en línea. Contacta a quien te mandó la liga.
              </p>
            )}
          </>
        )}
      </div>
    </main>
  );
}
