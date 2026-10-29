import { Etiqueta } from "@/components/etiqueta";
import { PantallaAdmin } from "@/components/pantalla-admin";
import { exigirRol } from "@/lib/sesion";
import { crearClienteServidor, oExplota } from "@/lib/supabase/server";

export const metadata = { title: "Referidos — Tasa" };

type Fila = { persona_id: string; nombre: string; tipo: "comisionista" | "equipo"; referidos: number; con_trabajo_pagado: number };

/** Quién trajo a cuántos comisionistas y cuántos de ellos ya tienen un trabajo pagado. */
export default async function Referidos() {
  await exigirRol("admin_org", "finanzas");
  const supabase = await crearClienteServidor();
  const filas = (oExplota(await supabase.rpc("reporte_referidos"), "los referidos") ?? []) as Fila[];

  return (
    <PantallaAdmin titulo="Referidos">
      <p className="mt-2 text-[0.9375rem] leading-6 text-secundario">
        Comisionistas y equipo que han invitado comisionistas. Lo del equipo es seguimiento: no genera bono.
      </p>
      {filas.length === 0 ? (
        <p className="mt-4 rounded-xl bg-alterno px-4 py-3 text-secundario">Todavía nadie ha referido a un comisionista.</p>
      ) : (
        <ul className="mt-4 flex flex-col gap-3">
          {filas.map((f) => (
            <li key={`${f.tipo}-${f.persona_id}`} className="rounded-xl border border-linea px-4 py-4">
              <div className="flex items-start justify-between gap-3">
                <p className="font-semibold">{f.nombre}</p>
                <Etiqueta tono={f.tipo === "equipo" ? "neutro" : "proceso"}>{f.tipo === "equipo" ? "Equipo" : "Comisionista"}</Etiqueta>
              </div>
              <p className="mt-1 text-[0.9375rem] text-secundario">
                {Number(f.referidos)} {Number(f.referidos) === 1 ? "referido" : "referidos"} · {Number(f.con_trabajo_pagado)} con trabajo pagado
              </p>
            </li>
          ))}
        </ul>
      )}
    </PantallaAdmin>
  );
}
