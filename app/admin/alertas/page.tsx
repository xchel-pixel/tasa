import Link from "next/link";
import { Etiqueta } from "@/components/etiqueta";
import { PantallaAdmin } from "@/components/pantalla-admin";
import { fechaCorta } from "@/lib/formato";
import { exigirRol, ROLES_OPERACION } from "@/lib/sesion";
import { crearClienteServidor, oExplota } from "@/lib/supabase/server";
import ResolverAlerta from "./resolver-alerta";

export const metadata = { title: "Alertas — Tasa" };

type Fila = {
  id: string;
  tipo: "cancelado_externo" | "externo_borrado" | "liga_inactiva" | "conector";
  codigo: string | null;
  mensaje: string;
  creada_en: string;
  solicitudes: { id: string; cliente_nombre: string; folio: string | null; pagado_en: string | null } | null;
};

const FALLA: Record<string, string> = {
  propiedad_no_encontrada: "Falta una propiedad o columna",
  credencial_invalida: "Credencial inválida",
  inaccesible: "No se puede leer la base",
  limite: "Límite de llamadas",
  otro: "Falla del conector",
};

/**
 * Lo que el sistema externo dijo y Tasa no hace solo:
 *   · un trabajo cancelado afuera: cancelar en Tasa decide si se borra la
 *     comisión (mes abierto) o entra un cargo (mes cerrado); por eso lo
 *     confirma admin_org;
 *   · una falla del conector: se cierra sola cuando el siguiente sync sale bien.
 */
export default async function Alertas() {
  const persona = await exigirRol(...ROLES_OPERACION);
  const supabase = await crearClienteServidor();
  const alertas =
    oExplota(
      await supabase
        .from("alertas")
        .select("id, tipo, codigo, mensaje, creada_en, solicitudes(id, cliente_nombre, folio, pagado_en)")
        .is("resuelta_en", null)
        .order("creada_en")
        .returns<Fila[]>(),
      "las alertas"
    ) ?? [];

  return (
    <PantallaAdmin titulo="Alertas">
      {alertas.length === 0 ? (
        <p className="mt-4 rounded-xl bg-alterno px-4 py-3 text-secundario">No hay alertas abiertas.</p>
      ) : (
        <ul className="mt-4 flex flex-col gap-4">
          {alertas.map((a) => (
            <li key={a.id} className="rounded-xl border border-linea px-4 py-4">
              {a.tipo === "conector" ? (
                <div className="mb-2"><Etiqueta tono="error">{FALLA[a.codigo ?? "otro"] ?? FALLA.otro}</Etiqueta></div>
              ) : null}
              <p className="font-semibold">{a.mensaje}</p>
              <p className="text-[0.9375rem] text-secundario">{fechaCorta(a.creada_en)}</p>
              {a.solicitudes ? (
                <Link href={a.tipo === "liga_inactiva" ? `/admin/solicitudes/${a.solicitudes.id}` : `/trabajos/${a.solicitudes.id}`}
                  className="toque text-[0.9375rem] font-semibold text-acento underline underline-offset-4">
                  {a.tipo === "liga_inactiva" ? "Ver solicitud" : "Ver trabajo"}
                </Link>
              ) : null}
              {a.solicitudes?.pagado_en ? (
                <p className="rounded-lg bg-proceso-fondo px-3 py-2 text-[0.9375rem] text-proceso">
                  Este trabajo ya está pagado: si su mes ya cerró, cancelar crea un cargo al comisionista.
                </p>
              ) : null}
              {a.tipo === "conector" ? (
                <p className="mt-2 text-[0.9375rem] leading-6 text-secundario">
                  Revisa el conector en{" "}
                  {persona.rol === "admin_org" ? (
                    <Link href="/ajustes" className="font-semibold text-acento underline underline-offset-4">Ajustes</Link>
                  ) : (
                    "Ajustes"
                  )}
                  . Se cierra sola cuando la siguiente sincronización sale bien.
                </p>
              ) : persona.rol === "admin_org" && a.solicitudes ? (
                <ResolverAlerta alertaId={a.id} solicitudId={a.solicitudes.id} />
              ) : (
                <p className="mt-2 text-[0.9375rem] text-secundario">La resuelve Administración.</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </PantallaAdmin>
  );
}
