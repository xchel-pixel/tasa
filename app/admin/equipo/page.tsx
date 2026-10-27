import { Etiqueta } from "@/components/etiqueta";
import { PantallaAdmin } from "@/components/pantalla-admin";
import { exigirRol, NOMBRE_DEL_ROL, type Rol } from "@/lib/sesion";
import { crearClienteServidor, oExplota } from "@/lib/supabase/server";
import { AltaMiembro, CambiarActiva } from "./formularios";

export const metadata = { title: "Equipo — Tasa" };

type Fila = {
  id: string;
  rol: Rol;
  activa: boolean;
  persona_id: string;
  personas: { nombre: string; correo: string } | null;
  membresia_marcas: { marcas: { clave: string } | null }[];
};

/** Quién opera la organización (los comisionistas viven en Comisionistas). */
export default async function Equipo() {
  const yo = await exigirRol("admin_org");
  const supabase = await crearClienteServidor();
  const [miembros, marcas] = await Promise.all([
    supabase
      .from("membresias")
      .select("id, rol, activa, persona_id, personas(nombre, correo), membresia_marcas(marcas(clave))")
      .neq("rol", "comisionista")
      .order("rol")
      .returns<Fila[]>(),
    supabase.from("marcas").select("id, clave, nombre").eq("activa", true).order("clave")
      .returns<{ id: string; clave: string; nombre: string }[]>(),
  ]);

  return (
    <PantallaAdmin titulo="Equipo">
      <ul className="mt-4 flex flex-col gap-3">
        {(oExplota(miembros, "el equipo") ?? []).map((m) => (
          <li key={m.id} className="rounded-xl border border-linea px-4 py-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-semibold">{m.personas?.nombre}</p>
                <p className="text-[0.9375rem] text-secundario [overflow-wrap:anywhere]">{m.personas?.correo}</p>
                <p className="text-[0.9375rem]">
                  {NOMBRE_DEL_ROL[m.rol]}
                  {m.membresia_marcas.length > 0
                    ? ` · ${m.membresia_marcas.map((x) => x.marcas?.clave).join(", ")}`
                    : ""}
                </p>
              </div>
              {!m.activa ? <Etiqueta tono="error">Inactivo</Etiqueta> : null}
            </div>
            {m.persona_id !== yo.id ? <CambiarActiva membresiaId={m.id} activa={m.activa} /> : null}
          </li>
        ))}
      </ul>

      <section className="mt-10">
        <h2 className="text-[1.125rem] font-bold">Agregar al equipo</h2>
        <AltaMiembro marcas={oExplota(marcas, "las marcas") ?? []} />
      </section>
    </PantallaAdmin>
  );
}
