import Link from "next/link";
import { BloqueNivel } from "@/components/bloque-nivel";
import { Encabezado } from "@/components/encabezado";
import { VistaEstadoDeCuenta } from "@/components/vista-estado-de-cuenta";
import { carpetaDe, exigirRol } from "@/lib/sesion";
import { miNivel } from "@/lib/trabajos";

export const metadata = { title: "Estado de cuenta — Tasa" };

/**
 * Sin ranking ni comparación con otros comisionistas: cada quien ve
 * solo lo suyo (el RLS no le deja ver más).
 */
export default async function EstadoDeCuenta({ searchParams }: PageProps<"/estado-de-cuenta">) {
  const persona = await exigirRol("comisionista");
  const { mes } = await searchParams;
  const nivel = await miNivel(persona.id, persona.organizacion.id);

  return (
    <>
      <Encabezado />
      <main className="flex flex-1 flex-col px-6 py-6">
        <div className="mx-auto w-full max-w-md">
          <Link href="/" className="toque text-[0.9375rem] font-semibold text-acento">
            ← Mis trabajos
          </Link>
          <h1 className="mt-2 text-[1.5rem] font-bold tracking-tight">Estado de cuenta</h1>

          <div className="mt-4 mb-6">
            <BloqueNivel nivel={nivel} />
          </div>

          <VistaEstadoDeCuenta
            personaId={persona.id}
            mesPedido={typeof mes === "string" ? mes : undefined}
            base="/estado-de-cuenta"
            dueno
            carpeta={carpetaDe(persona)}
          />
        </div>
      </main>
    </>
  );
}
