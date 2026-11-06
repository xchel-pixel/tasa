import { redirect } from "next/navigation";
import { Encabezado } from "@/components/encabezado";
import { PanelComisionista } from "@/components/panel-comisionista";
import { SeccionesDeInicio } from "@/components/secciones-de-inicio";
import { VolverPortada } from "@/components/volver-portada";
import { exigirRol } from "@/lib/sesion";

export const metadata = { title: "Panel — Tasa" };

/** El panel de cada quien: el comisionista, sus comisiones y trabajos; el equipo, los trámites de su liga. Administración tiene /admin. */
export default async function Panel() {
  const persona = await exigirRol("comisionista", "equipo", "admin_org", "finanzas", "admin_marca");
  // Administración tiene su propio panel (/admin), en su tarjeta de la portada.
  if (persona.rol !== "comisionista" && persona.rol !== "equipo") redirect("/");
  return (
    <>
      <Encabezado />
      <main className="flex flex-1 flex-col px-6 py-6">
        <div className="mx-auto w-full max-w-md">
          <VolverPortada />
          {persona.rol === "comisionista" ? (
            <PanelComisionista persona={persona} />
          ) : (
            <>
              <h1 className="mt-2 text-[1.5rem] font-bold tracking-tight">Mi panel</h1>
              <SeccionesDeInicio persona={persona} opera={false} />
            </>
          )}
        </div>
      </main>
    </>
  );
}
