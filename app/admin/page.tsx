import { Encabezado } from "@/components/encabezado";
import { InicioStaff } from "@/components/inicio-staff";
import { VolverPortada } from "@/components/volver-portada";
import { exigirRol, ROLES_OPERACION } from "@/lib/sesion";

export const metadata = { title: "Panel de administración — Tasa" };

/** Lo que antes era el inicio de administración: lo que toca hacer hoy, cierre, comisiones y trámites. */
export default async function PanelAdministracion() {
  const persona = await exigirRol(...ROLES_OPERACION);
  return (
    <>
      <Encabezado />
      <main className="flex flex-1 flex-col px-6 py-6">
        <div className="mx-auto w-full max-w-md">
          <VolverPortada />
          <h1 className="mt-2 text-[1.5rem] font-bold tracking-tight">Panel de administración</h1>
          <InicioStaff persona={persona} />
        </div>
      </main>
    </>
  );
}
