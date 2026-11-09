import Link from "next/link";
import { Etiqueta } from "@/components/etiqueta";
import { PantallaAdmin } from "@/components/pantalla-admin";
import { exigirRol, NOMBRE_DEL_ROL, type Rol } from "@/lib/sesion";
import { crearClienteServidor } from "@/lib/supabase/server";
import { fechaHora } from "@/lib/uso";

export const metadata = { title: "Accesos — Tasa" };

type Fila = { persona_id: string; nombre: string; correo: string; rol: Rol; activa: boolean; ultimo_acceso: string | null; sesiones: number };

/** Accesos (0071): quién entra a la organización, su estatus y su último acceso. Solo admin_org. */
export default async function Accesos() {
  await exigirRol("admin_org");
  const supabase = await crearClienteServidor();
  const { data, error } = await supabase.rpc("accesos_lista");
  if (error) throw new Error(`No se pudieron leer los accesos: ${error.message}`);
  const filas = (data ?? []) as Fila[];

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
                  {f.sesiones ? ` · ${f.sesiones} sesión${f.sesiones === 1 ? "" : "es"} abierta${f.sesiones === 1 ? "" : "s"}` : ""}
                </span>
              </span>
              <span className="shrink-0">{f.activa ? <Etiqueta tono="exito">Activa</Etiqueta> : <Etiqueta tono="error">Suspendida</Etiqueta>}</span>
            </Link>
          </li>
        ))}
      </ul>
    </PantallaAdmin>
  );
}
