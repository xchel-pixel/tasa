import Link from "next/link";
import { Etiqueta } from "@/components/etiqueta";
import { PantallaAdmin } from "@/components/pantalla-admin";
import { exigirRol, NOMBRE_DEL_ROL, type Rol } from "@/lib/sesion";
import { crearClienteServidor } from "@/lib/supabase/server";
import { fechaHora } from "@/lib/uso";

export const metadata = { title: "Accesos — Tasa" };

type Equipos = { persona_id: string; equipos: number; maximo: number | null; cierres_mes: number };
type Fila = { persona_id: string; nombre: string; correo: string; rol: Rol; activa: boolean; ultimo_acceso: string | null; sesiones: number };

/** "2 de 3 equipos permitidos · 4 cierres por límite este mes"; sin equipos ni cierres, nada. */
function textoEquipos(e: Equipos | undefined): string {
  if (!e || (!e.equipos && !e.cierres_mes)) return "";
  const n = `${e.equipos} equipo${e.equipos === 1 ? "" : "s"}${e.maximo ? ` de ${e.maximo} permitidos` : ""}`;
  return ` · ${n}${e.cierres_mes ? ` · ${e.cierres_mes} cierre${e.cierres_mes === 1 ? "" : "s"} por límite este mes` : ""}`;
}

/** Accesos (0071): quién entra a la organización, su estatus y su último acceso. Solo admin_org. */
export default async function Accesos() {
  await exigirRol("admin_org");
  const supabase = await crearClienteServidor();
  const [{ data, error }, { data: inact }, { data: eq }] = await Promise.all([supabase.rpc("accesos_lista"), supabase.rpc("inactividad_org"),
    supabase.rpc("equipos_org")]);
  const equipos = new Map(((eq ?? []) as Equipos[]).map((e) => [e.persona_id, e]));
  if (error) throw new Error(`No se pudieron leer los accesos: ${error.message}`);
  const filas = (data ?? []) as Fila[];
  const actividad = new Map(((inact ?? []) as { persona_id: string; estado: string }[]).map((i) => [i.persona_id, i.estado]));

  return (
    <PantallaAdmin titulo="Accesos">
      <p className="mt-2 text-[0.9375rem] leading-6 text-secundario">
        Estatus, último acceso y sesiones abiertas de cada persona. Abre una para suspenderla, cerrar sus sesiones o ver su historial.
      </p>
      <ul className="mt-4 flex flex-col gap-2">
        {filas.map((f) => (
          <li key={f.persona_id}>
            <Link href={`/admin/accesos/${f.persona_id}`} className="flex items-start justify-between gap-3 rounded-xl border border-linea px-4 py-3">
              <span className="min-w-0">
                <span className="block font-semibold">{f.nombre}</span>
                <span className="block text-[0.875rem] text-secundario">
                  {NOMBRE_DEL_ROL[f.rol] ?? f.rol} · {f.ultimo_acceso ? `último acceso ${fechaHora(f.ultimo_acceso)}` : "nunca ha entrado"}
                  {textoEquipos(equipos.get(f.persona_id))}
                </span>
              </span>
              <span className="shrink-0">{!f.activa ? <Etiqueta tono="error">Suspendida</Etiqueta>
                : actividad.get(f.persona_id) === "inactiva" ? <Etiqueta tono="neutro">Inactiva</Etiqueta>
                : actividad.get(f.persona_id) === "por_vencer" ? <Etiqueta tono="proceso">Por inactivarse</Etiqueta>
                : <Etiqueta tono="exito">Activa</Etiqueta>}</span>
            </Link>
          </li>
        ))}
      </ul>
    </PantallaAdmin>
  );
}
