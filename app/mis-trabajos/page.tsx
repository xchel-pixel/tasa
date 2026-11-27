import { EncabezadoSeccion, TarjetasDeSeccion } from "@/components/centro-seccion";
import { Encabezado } from "@/components/encabezado";
import { misHerramientas } from "@/lib/herramientas";
import { seccionesDe } from "@/lib/menu";
import { exigirRol } from "@/lib/sesion";

export const metadata = { title: "Mis trabajos — Tasa" };

/** Sección "Mis trabajos" del comisionista: solicitar, seguimiento, comisiones y referidos (las pantallas de siempre). */
export default async function MisTrabajos() {
  const persona = await exigirRol("comisionista");
  const s = seccionesDe(persona, await misHerramientas()).find((x) => x.id === "trabajos");
  return (
    <>
      <Encabezado />
      <main className="flex flex-1 flex-col px-6 py-6">
        <div className="mx-auto w-full max-w-md md:max-w-3xl">
          <EncabezadoSeccion titulo="Mis trabajos" bajada="Pide un avalúo, sigue tus trámites y cobra tus comisiones." ilustracion="seccion-mis-trabajos"
            texto="Todo lo de tus trámites: desde la solicitud hasta tu comisión." />
          <TarjetasDeSeccion pantallas={s?.pantallas ?? []} />
        </div>
      </main>
    </>
  );
}
