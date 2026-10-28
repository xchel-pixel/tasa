import { PantallaAdmin } from "@/components/pantalla-admin";
import { pesos } from "@/lib/formato";
import { exigirRol } from "@/lib/sesion";
import { crearClienteServidor, oExplota } from "@/lib/supabase/server";
import { FormularioNivel, type Nivel } from "./formularios";

export const metadata = { title: "Niveles — Tasa" };

/**
 * Los niveles de comisión de la organización: cada mes, el promedio de
 * los últimos meses de cada comisionista lo pone en un nivel. Cambiarlos
 * no toca lo ya calculado.
 */
export default async function Niveles() {
  await exigirRol("admin_org");
  const supabase = await crearClienteServidor();
  const resultado = await supabase
    .from("niveles")
    .select("id, nombre, umbral_minimo, porcentaje, es_forzado")
    .order("es_forzado")
    .order("umbral_minimo")
    .returns<Nivel[]>();
  const niveles = oExplota(resultado, "los niveles") ?? [];

  return (
    <PantallaAdmin titulo="Niveles" volver={{ href: "/admin/configuracion", texto: "Configuración" }}>
      <p className="mt-2 text-[0.9375rem] leading-6 text-secundario">
        Al aprobar cada cierre, el promedio mensual de cada comisionista lo pone en el nivel más alto que alcanza. Los
        cambios rigen desde el siguiente cierre; lo ya calculado no cambia.
      </p>
      <div className="mt-4 flex flex-col gap-2">
        {niveles.map((n) => (
          <details key={n.id} className="rounded-xl border border-linea px-4 py-3">
            <summary className="toque flex cursor-pointer items-center justify-between gap-3">
              <span className="font-semibold">{n.nombre}</span>
              <span className="text-[0.9375rem] text-secundario">
                {n.es_forzado ? "porcentaje fijo" : `desde ${pesos(Number(n.umbral_minimo))} · ${Number(n.porcentaje)}%`}
              </span>
            </summary>
            <div className="mt-3">
              <FormularioNivel nivel={n} />
            </div>
          </details>
        ))}
        <details className="rounded-xl border border-dashed border-borde-campo px-4 py-3">
          <summary className="toque cursor-pointer font-semibold text-acento">+ Agregar nivel</summary>
          <div className="mt-3">
            <FormularioNivel />
          </div>
        </details>
      </div>
    </PantallaAdmin>
  );
}
