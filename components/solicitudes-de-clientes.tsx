import { fechaCorta } from "@/lib/formato";
import { crearClienteServidor } from "@/lib/supabase/server";

type Fila = {
  id: string;
  cliente_nombre: string;
  cliente_telefono: string | null;
  cliente_correo: string | null;
  servicio: string;
  tramite: boolean;
  estado: string;
  creado_en: string;
};

/**
 * "Tu cliente <nombre> pidió <servicio>": lo que llegó por su liga de clientes en los últimos 30
 * días, con el teléfono para darle seguimiento (el cliente no tiene cuenta). Sin nada, no se muestra.
 */
export async function SolicitudesDeClientes() {
  const supabase = await crearClienteServidor();
  const { data } = await supabase.rpc("mis_solicitudes_de_liga");
  const filas = (data ?? []) as Fila[];
  if (filas.length === 0) return null;

  return (
    <section className="mt-6">
      <h2 className="text-[1.125rem] font-bold">Solicitudes de tus clientes</h2>
      <ul className="mt-3 flex flex-col gap-3">
        {filas.map((f) => (
          <li key={f.id} className="rounded-xl border border-linea px-4 py-3">
            <p className="font-semibold">
              Tu cliente {f.cliente_nombre} pidió {f.servicio}
            </p>
            <p className="text-[0.9375rem] text-secundario">
              {f.tramite ? "Quiere el trámite" : "Solo cotización"} · {fechaCorta(f.creado_en)}
              {f.estado === "cancelada" ? " · Cancelada" : f.estado === "solicitada" ? " · Por cotizar" : ""}
            </p>
            {f.cliente_telefono ? (
              <p className="mt-1 text-[0.9375rem]">
                <a href={`tel:${f.cliente_telefono}`} className="font-semibold text-acento underline underline-offset-4">
                  {f.cliente_telefono}
                </a>
                {f.cliente_correo ? <span className="text-secundario"> · {f.cliente_correo}</span> : null}
              </p>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
