import Link from "next/link";
import { PantallaAdmin } from "@/components/pantalla-admin";
import { fechaCorta } from "@/lib/formato";
import { exigirRol } from "@/lib/sesion";
import { crearClienteServidor, oExplota } from "@/lib/supabase/server";
import ResolverAlerta from "./resolver-alerta";

export const metadata = { title: "Alertas — Tasa" };

type Fila = {
  id: string;
  tipo: "cancelado_en_notion";
  mensaje: string;
  creada_en: string;
  solicitudes: { id: string; cliente_nombre: string; folio: string | null; pagado_en: string | null } | null;
};

/**
 * Lo que Notion dijo y Tasa no hace solo. Hoy: trabajos cancelados en
 * Notion. Cancelar en Tasa decide si se borra la comisión (mes abierto)
 * o entra un cargo (mes cerrado); por eso lo confirma super_admin.
 */
export default async function Alertas() {
  const persona = await exigirRol("super_admin", "finanzas");
  const supabase = await crearClienteServidor();
  const alertas =
    oExplota(
      await supabase
        .from("alertas")
        .select("id, tipo, mensaje, creada_en, solicitudes(id, cliente_nombre, folio, pagado_en)")
        .is("resuelta_en", null)
        .order("creada_en")
        .returns<Fila[]>(),
      "las alertas"
    ) ?? [];

  return (
    <PantallaAdmin titulo="Alertas de Notion">
      {alertas.length === 0 ? (
        <p className="mt-4 rounded-xl bg-alterno px-4 py-3 text-secundario">No hay alertas abiertas.</p>
      ) : (
        <ul className="mt-4 flex flex-col gap-4">
          {alertas.map((a) => (
            <li key={a.id} className="rounded-xl border border-linea px-4 py-4">
              <p className="font-semibold">{a.mensaje}</p>
              <p className="text-[0.9375rem] text-secundario">{fechaCorta(a.creada_en)}</p>
              {a.solicitudes ? (
                <Link href={`/trabajos/${a.solicitudes.id}`} className="toque text-[0.9375rem] font-semibold text-acento underline underline-offset-4">
                  Ver trabajo
                </Link>
              ) : null}
              {a.solicitudes?.pagado_en ? (
                <p className="rounded-lg bg-proceso-fondo px-3 py-2 text-[0.9375rem] text-proceso">
                  Este trabajo ya está pagado: si su mes ya cerró, cancelar crea un cargo al comisionista.
                </p>
              ) : null}
              {persona.rol === "super_admin" && a.solicitudes ? (
                <ResolverAlerta alertaId={a.id} solicitudId={a.solicitudes.id} />
              ) : (
                <p className="mt-2 text-[0.9375rem] text-secundario">La resuelve el super_admin.</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </PantallaAdmin>
  );
}
