import { EncabezadoSeccion, TarjetasDeSeccion } from "@/components/centro-seccion";
import { Encabezado } from "@/components/encabezado";
import { misHerramientas } from "@/lib/herramientas";
import { seccionesDe } from "@/lib/menu";
import { exigirRol } from "@/lib/sesion";

export const metadata = { title: "Mi cuenta — Tasa" };

/** Sección "Mi cuenta" del comisionista: sus datos, paquetes, uso y privacidad (las pantallas de siempre). */
export default async function MiCuenta() {
  const persona = await exigirRol("comisionista");
  const s = seccionesDe(persona, await misHerramientas()).find((x) => x.id === "cuenta");
  return (
    <>
      <Encabezado />
      <main className="flex flex-1 flex-col px-6 py-6">
        <div className="mx-auto w-full max-w-md md:max-w-3xl">
          <EncabezadoSeccion titulo="Mi cuenta" bajada="Tus datos, tu crédito y cómo cuidamos tu información." ilustracion="seccion-mi-cuenta"
            texto="Tus datos solo los ven tú y administración." />
          <TarjetasDeSeccion pantallas={s?.pantallas ?? []} />
        </div>
      </main>
    </>
  );
}
