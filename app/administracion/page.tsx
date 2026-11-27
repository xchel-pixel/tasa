import { EncabezadoSeccion, TarjetasDeSeccion } from "@/components/centro-seccion";
import { Encabezado } from "@/components/encabezado";
import { misHerramientas } from "@/lib/herramientas";
import { seccionesDe } from "@/lib/menu";
import { exigirRol, ROLES_OPERACION } from "@/lib/sesion";

export const metadata = { title: "Administración — Tasa" };

/** Sección "Administración": las pantallas de operación de la organización, agrupadas, según lo que permite cada rol. */
export default async function Administracion() {
  const persona = await exigirRol(...ROLES_OPERACION);
  const s = seccionesDe(persona, await misHerramientas()).find((x) => x.id === "administracion");
  return (
    <>
      <Encabezado />
      <main className="flex flex-1 flex-col px-6 py-6">
        <div className="mx-auto w-full max-w-md md:max-w-3xl">
          <EncabezadoSeccion titulo="Administración" bajada={`La operación de ${persona.organizacion.nombre}, agrupada por tema.`} ilustracion="seccion-administracion"
            texto="Lo urgente de hoy está en Hoy; aquí, todas las pantallas de operación." />
          <TarjetasDeSeccion pantallas={s?.pantallas ?? []} />
        </div>
      </main>
    </>
  );
}
