import { redirect } from "next/navigation";
import { Encabezado } from "@/components/encabezado";
import { FranjaPendientes } from "@/components/franja-pendientes";
import { Lanzador } from "@/components/lanzador";
import { PortadaPublica } from "@/components/portada-publica";
import { obtenerContacto } from "@/lib/contacto";
import { NOMBRE_DEL_ROL, obtenerSesion } from "@/lib/sesion";

/**
 * La portada: saludo, cuadrícula de herramientas (cada una abre su pantalla), "Próximamente" y la franja de
 * pendientes si hay algo. Nada más: el panel de cada quien vive en su propia ruta. Sin sesión, la portada
 * pública; sin organización elegida, primero se elige.
 */
export default async function Inicio() {
  const sesion = await obtenerSesion();
  if (!sesion) return <PortadaPublica />;
  if (sesion.sinOrganizacion) redirect(sesion.superPlataforma ? "/plataforma" : "/organizacion");

  const { persona } = sesion;
  if (persona?.debeAceptarTerminos) redirect("/terminos");
  const contacto = persona ? null : await obtenerContacto();

  return (
    <>
      <Encabezado />

      <main className="flex flex-1 flex-col px-6 py-8">
        <div className="mx-auto w-full max-w-md md:max-w-2xl">
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
          ) : (
            <>
              <h1 className="text-[1.5rem] font-bold tracking-tight">Hola, {persona.nombre.split(" ")[0]}</h1>
              {persona.rol !== "comisionista" ? (
                <p className="mt-1 text-[0.9375rem] text-secundario">{NOMBRE_DEL_ROL[persona.rol]} · {persona.organizacion.nombre}</p>
              ) : null}
              <Lanzador persona={persona} />
              <FranjaPendientes persona={persona} />
            </>
          )}
        </div>
      </main>
    </>
  );
}
