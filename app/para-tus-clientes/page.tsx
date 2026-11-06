import { redirect } from "next/navigation";
import { Encabezado } from "@/components/encabezado";
import { TarjetaClientes } from "@/components/tarjeta-clientes";
import { VolverPortada } from "@/components/volver-portada";
import { TODOS_LOS_ROLES, tengoHerramienta } from "@/lib/herramientas";
import { ligasDe, mensajesDeInvitacion } from "@/lib/ligas";
import { exigirRol } from "@/lib/sesion";

export const metadata = { title: "Para tus clientes — Tasa" };

/** Herramienta del catálogo (0056): la liga y el QR para que los clientes pidan su cotización a nombre de quien la comparte. */
export default async function ParaTusClientes() {
  const persona = await exigirRol(...TODOS_LOS_ROLES);
  if (!(await tengoHerramienta("para_tus_clientes"))) redirect("/");
  const ligas = await ligasDe(persona);
  const { clientes } = ligas;
  const mensajes = await mensajesDeInvitacion(ligas);
  return (
    <>
      <Encabezado />
      <main className="flex flex-1 flex-col px-6 py-6">
        <div className="mx-auto w-full max-w-md">
          <VolverPortada />
          <h1 className="mt-2 text-[1.5rem] font-bold tracking-tight">Para tus clientes</h1>
          {clientes ? (
            <TarjetaClientes liga={clientes} mensaje={mensajes.clientes} />
          ) : (
            <p className="mt-4 rounded-xl bg-alterno px-4 py-3 text-secundario">Todavía no tienes código de referido; pídelo a Administración.</p>
          )}
        </div>
      </main>
    </>
  );
}
