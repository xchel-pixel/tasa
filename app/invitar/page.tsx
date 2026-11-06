import { redirect } from "next/navigation";
import { Encabezado } from "@/components/encabezado";
import { TarjetaInvitar } from "@/components/tarjeta-invitar";
import { VolverPortada } from "@/components/volver-portada";
import { TODOS_LOS_ROLES, tengoHerramienta } from "@/lib/herramientas";
import { ligasDe, mensajesDeInvitacion } from "@/lib/ligas";
import { exigirRol } from "@/lib/sesion";

export const metadata = { title: "Invita a un comisionista — Tasa" };

/** Herramienta del catálogo (0056): la liga para invitar a otros aliados (el equipo ve además su bono, si lo tiene). */
export default async function Invitar() {
  const persona = await exigirRol(...TODOS_LOS_ROLES);
  if (!(await tengoHerramienta("invitar"))) redirect("/");
  const ligas = await ligasDe(persona);
  const { invitar, bono, equipo } = ligas;
  const mensajes = await mensajesDeInvitacion(ligas);
  return (
    <>
      <Encabezado />
      <main className="flex flex-1 flex-col px-6 py-6">
        <div className="mx-auto w-full max-w-md">
          <VolverPortada />
          <h1 className="mt-2 text-[1.5rem] font-bold tracking-tight">Invita a un comisionista</h1>
          {invitar ? (
            <TarjetaInvitar liga={invitar} mensaje={mensajes.invitar} equipo={equipo} bono={bono} />
          ) : (
            <p className="mt-4 rounded-xl bg-alterno px-4 py-3 text-secundario">Todavía no tienes liga para invitar; pídela a Administración.</p>
          )}
        </div>
      </main>
    </>
  );
}
