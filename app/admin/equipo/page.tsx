import { Etiqueta } from "@/components/etiqueta";
import { PantallaAdmin } from "@/components/pantalla-admin";
import { exigirRol, NOMBRE_DEL_ROL, type Rol } from "@/lib/sesion";
import { crearClienteServidor, oExplota } from "@/lib/supabase/server";
import { AltaMiembro, CambiarActiva, CambiarBonoReferido, NombreParaMostrar } from "./formularios";

export const metadata = { title: "Equipo — Tasa" };

type Fila = {
  id: string;
  rol: Rol;
  activa: boolean;
  bono_referido: boolean;
  persona_id: string;
  personas: { nombre: string; correo: string; nombre_para_mostrar: string | null } | null;
  membresia_marcas: { marcas: { clave: string } | null }[];
};

/** Quién opera la organización (los comisionistas viven en Comisionistas). */
export default async function Equipo() {
  const yo = await exigirRol("admin_org");
  const supabase = await crearClienteServidor();
  const [miembros, marcas, ajustes] = await Promise.all([
    supabase
      .from("membresias")
      .select("id, rol, activa, bono_referido, persona_id, personas(nombre, correo, nombre_para_mostrar), membresia_marcas(marcas(clave))")
      .neq("rol", "comisionista")
      .order("rol")
      .returns<Fila[]>(),
    supabase.from("marcas").select("id, clave, nombre").eq("activa", true).order("clave")
      .returns<{ id: string; clave: string; nombre: string }[]>(),
    supabase.from("ajustes").select("bono_referido_equipo").maybeSingle().returns<{ bono_referido_equipo: boolean } | null>(),
  ]);
  const bonoEquipo = Boolean(ajustes.data?.bono_referido_equipo);

  return (
    <PantallaAdmin titulo="Equipo">
      <ul className="mt-4 flex flex-col gap-3">
        {(oExplota(miembros, "el equipo") ?? []).map((m) => (
          <li key={m.id} className="rounded-xl border border-linea px-4 py-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-semibold">{m.personas?.nombre_para_mostrar || m.personas?.nombre}</p>
                {m.personas?.nombre_para_mostrar ? (
                  <p className="text-[0.9375rem] text-secundario">Nombre real: {m.personas.nombre}</p>
                ) : null}
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
            <NombreParaMostrar personaId={m.persona_id} actual={m.personas?.nombre_para_mostrar ?? null} />
            {bonoEquipo && ["equipo", "finanzas", "admin_marca"].includes(m.rol) ? (
              <CambiarBonoReferido membresiaId={m.id} activo={m.bono_referido} />
            ) : null}
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
