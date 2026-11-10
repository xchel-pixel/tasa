import { Encabezado } from "@/components/encabezado";
import { InicioStaff } from "@/components/inicio-staff";
import { VolverPortada } from "@/components/volver-portada";
import { exigirRol, ROLES_OPERACION } from "@/lib/sesion";

export const metadata = { title: "Hoy — Tasa" };

/** "Hoy" (fase 1): la página de inicio de administración. Todo lo que espera una acción, en una sola lista. */
export default async function PanelAdministracion() {
  const persona = await exigirRol(...ROLES_OPERACION);
  return (
    <>
      <Encabezado />
      <main className="flex flex-1 flex-col px-6 py-6">
        <div className="mx-auto w-full max-w-md">
          <VolverPortada />
          <h1 className="mt-2 text-[1.5rem] font-bold tracking-tight">Hoy</h1>
          <p className="mt-1 text-[0.9375rem] leading-6 text-secundario">Para qué sirve: ver de un vistazo todo lo que espera una acción tuya y llegar directo a resolverlo.</p>
          <InicioStaff persona={persona} />
        </div>
      </main>
    </>
  );
}
