import { PantallaAdmin } from "@/components/pantalla-admin";
import { pesos } from "@/lib/formato";
import { exigirRol } from "@/lib/sesion";
import { crearClienteServidor, oExplota } from "@/lib/supabase/server";
import { FormularioNivel, FormularioTratos, type Nivel } from "./formularios";

export const metadata = { title: "Niveles — Tasa" };

/**
 * Los niveles de comisión de la organización: cada mes, el promedio de
 * los últimos meses de cada comisionista lo pone en un nivel. Cambiarlos
 * no toca lo ya calculado.
 */
export default async function Niveles() {
  const persona = await exigirRol("admin_org");
  const supabase = await crearClienteServidor();
  const { data: ajustes } = await supabase
    .from("ajustes")
    .select("bienvenida_nivel_id, bienvenida_meses, arranque_nivel_id, arranque_meses")
    .eq("organizacion_id", persona.organizacion.id)
    .maybeSingle();
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

      <section className="mt-8">
        <h2 className="text-[1.125rem] font-bold">Trato inicial</h2>
        <p className="mt-1 text-[0.9375rem] leading-6 text-secundario">
          Un piso durante los primeros meses, desde el mes del alta. <strong>Tasa de bienvenida</strong>: para quien ya
          trabajaba con ustedes; se marca en el alta y al terminar baja un nivel por cierre hasta su nivel real.{" "}
          <strong>Arranque</strong>: para todos los demás; al terminar sigue la escalera normal. En los dos, si su
          promedio da más, cobra más desde ese cierre.
        </p>
        <div className="mt-3">
          <FormularioTratos
            niveles={niveles}
            valores={{
              bienvenida_nivel_id: ajustes?.bienvenida_nivel_id ?? null,
              bienvenida_meses: ajustes?.bienvenida_meses ?? 3,
              arranque_nivel_id: ajustes?.arranque_nivel_id ?? null,
              arranque_meses: ajustes?.arranque_meses ?? 2,
            }}
          />
        </div>
      </section>
    </PantallaAdmin>
  );
}
