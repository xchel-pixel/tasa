import { redirect } from "next/navigation";
import { Encabezado } from "@/components/encabezado";
import { InicioComisionista } from "@/components/inicio-comisionista";
import { InicioStaff } from "@/components/inicio-staff";
import { obtenerContacto } from "@/lib/contacto";
import { obtenerSesion } from "@/lib/sesion";

/**
 * El inicio decide por rol: el comisionista ve sus trabajos y su mes;
 * el staff, lo que le toca hacer hoy. Sin organización elegida, primero
 * se elige.
 */
export default async function Inicio() {
  const sesion = await obtenerSesion();
  if (!sesion) redirect("/entrar");
  if (sesion.sinOrganizacion) redirect(sesion.superPlataforma ? "/plataforma" : "/organizacion");

  const { persona } = sesion;
  const contacto = persona ? null : await obtenerContacto();

  return (
    <>
      <Encabezado />

      <main className="flex flex-1 flex-col px-6 py-8">
        <div className="mx-auto w-full max-w-md">
          {!persona ? (
            <>
              <h1 className="text-[1.5rem] font-bold tracking-tight">
                Tu correo no está dado de alta
              </h1>
              <p className="mt-2 leading-7 text-secundario">
                Entraste como {sesion.correo}, pero nadie te ha registrado en
                Tasa. Pídele al administrador que te dé de alta con este mismo
                correo.
                {contacto ? <> Contacto: {contacto}.</> : null}
              </p>
            </>
          ) : persona.rol === "comisionista" ? (
            <InicioComisionista persona={persona} />
          ) : persona.rol === "equipo" ? (
            <>
              <h1 className="text-[1.5rem] font-bold tracking-tight">Hola, {persona.nombre.split(" ")[0]}</h1>
              <p className="mt-2 leading-7 text-secundario">
                Ya eres parte del equipo de {persona.organizacion.nombre}. Tus herramientas todavía no están
                listas; aquí aparecerán.
              </p>
            </>
          ) : (
            <InicioStaff persona={persona} />
          )}
        </div>
      </main>
    </>
  );
}
