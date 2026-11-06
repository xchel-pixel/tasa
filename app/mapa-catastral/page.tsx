import { redirect } from "next/navigation";
import { Encabezado } from "@/components/encabezado";
import { PedirMas } from "@/components/formularios-cupo";
import { VolverPortada } from "@/components/volver-portada";
import { miCupo, textoCupo } from "@/lib/cupos";
import { TODOS_LOS_ROLES, tengoHerramienta } from "@/lib/herramientas";
import { exigirRol } from "@/lib/sesion";
import { MapaCatastral } from "./mapa";

export const metadata = { title: "Mapa catastral — Tasa" };
// Cada consulta a IDECATQ tiene 12 s de límite y puede haber dos seguidas (mapa y expediente): margen arriba.
export const maxDuration = 60;

/** Herramienta del catálogo (0059): satélite con la capa de predios de IDECATQ; picar un predio da su ficha. */
export default async function MapaCatastralPagina({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const persona = await exigirRol(...TODOS_LOS_ROLES);
  if (!(await tengoHerramienta("mapa_catastral"))) redirect("/");
  const q = await searchParams;
  const [cupo, cupoPdf, calculadora] = await Promise.all([miCupo("mapa_catastral"), miCupo("mapa_catastral_pdf"), tengoHerramienta("calculadora_traslado")]);

  return (
    <>
      <Encabezado />
      <main className="flex flex-1 flex-col px-4 py-6">
        <div className="mx-auto w-full max-w-3xl">
          <div className="px-2">
            <VolverPortada />
            <h1 className="mt-2 text-[1.5rem] font-bold tracking-tight">Mapa catastral</h1>
            <p className="mt-1 text-[0.9375rem] leading-6 text-secundario">
              Pica un terreno o busca por clave. Las líneas de los predios aparecen al acercarte a nivel de calle.
            </p>
            <p className="mt-1 text-[0.875rem] text-secundario">
              Consultas a catastro: {textoCupo(cupo).replace(/^Te quedan/, "te quedan").replace(/^Sin límite/, "sin límite")}. Un predio ya guardado no cuenta.
              {" "}PDF: {textoCupo(cupoPdf).replace(/^Te quedan/, "te quedan").replace(/^Sin límite/, "sin límite")}.
            </p>
            {cupo.disponibles === 0 && persona.rol === "comisionista" ? <PedirMas herramienta="mapa_catastral" /> : null}
            {cupoPdf.disponibles === 0 && persona.rol === "comisionista" ? <PedirMas herramienta="mapa_catastral_pdf" /> : null}
          </div>
          <MapaCatastral
            token={process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? ""}
            claveInicial={q.clave ?? null}
            puedeCotizar={persona.rol === "comisionista"}
            calculadora={calculadora}
            veVisor={["admin_org", "finanzas", "equipo"].includes(persona.rol)}
          />
        </div>
      </main>
    </>
  );
}
