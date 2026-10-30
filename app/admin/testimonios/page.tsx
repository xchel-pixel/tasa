import { PantallaAdmin } from "@/components/pantalla-admin";
import { fechaCorta } from "@/lib/formato";
import { exigirRol } from "@/lib/sesion";
import { crearClienteServidor, oExplota } from "@/lib/supabase/server";
import { DecidirTestimonio } from "./decidir";

export const metadata = { title: "Testimonios — Tasa" };

type Fila = {
  id: string;
  cliente: string;
  texto: string;
  creado_en: string;
  comisionistas: { personas: { nombre: string } | null } | null;
};

/** Testimonios que los comisionistas capturaron para su tarjeta: se publican cuando admin_org los aprueba. */
export default async function Testimonios() {
  await exigirRol("admin_org");
  const supabase = await crearClienteServidor();
  const filas =
    oExplota(
      await supabase
        .from("testimonios")
        .select("id, cliente, texto, creado_en, comisionistas(personas!comisionistas_persona_id_fkey(nombre))")
        .eq("estado", "pendiente")
        .order("creado_en")
        .returns<Fila[]>(),
      "los testimonios"
    ) ?? [];

  return (
    <PantallaAdmin titulo="Testimonios">
      <p className="mt-1 text-[0.9375rem] leading-6 text-secundario">
        Se publican en la tarjeta del comisionista (Socio Plus o más) cuando los apruebas.
      </p>
      {filas.length === 0 ? (
        <p className="mt-4 rounded-xl bg-alterno px-4 py-3 text-secundario">No hay testimonios por aprobar.</p>
      ) : (
        <ul className="mt-4 flex flex-col gap-3">
          {filas.map((t) => (
            <li key={t.id} className="rounded-xl border border-linea px-4 py-3 text-[0.9375rem]">
              <p className="font-semibold">{t.comisionistas?.personas?.nombre}</p>
              <p className="mt-1 leading-6">“{t.texto}” — {t.cliente}</p>
              <p className="text-secundario">{fechaCorta(t.creado_en)}</p>
              <DecidirTestimonio testimonioId={t.id} />
            </li>
          ))}
        </ul>
      )}
    </PantallaAdmin>
  );
}
