import { redirect } from "next/navigation";
import { Encabezado } from "@/components/encabezado";
import { FranjaPendientes } from "@/components/franja-pendientes";
import { BloqueNivel } from "@/components/bloque-nivel";
import { Lanzador } from "@/components/lanzador";
import { miNivel } from "@/lib/trabajos";
import { PortadaPublica } from "@/components/portada-publica";
import { obtenerContacto } from "@/lib/contacto";
import { NOMBRE_DEL_ROL, obtenerSesion } from "@/lib/sesion";

/**
 * La portada: saludo, cuadrícula de herramientas (cada una abre su pantalla), "Próximamente" y la franja de
 * pendientes si hay algo. Nada más: el panel de cada quien vive en su propia ruta. Sin sesión, la portada
 * pública; sin organización elegida, primero se elige.
 */
export default async function Inicio({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const q = await searchParams;
  const equipoCerrado = q.equipo_cerrado && q.equipo_cerrado.length <= 120 ? q.equipo_cerrado : null;
  const maximo = Number(q.maximo);
  const sesion = await obtenerSesion();
  if (!sesion) return <PortadaPublica />;
  if (sesion.sinOrganizacion) redirect(sesion.superPlataforma ? "/plataforma" : "/organizacion");

  const { persona } = sesion;
  if (persona?.debeAceptarTerminos) redirect("/terminos");
  const contacto = persona ? null : await obtenerContacto();
  const nivel = persona?.rol === "comisionista" ? await miNivel(persona.id, persona.organizacion.id) : null;

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
              {equipoCerrado && Number.isInteger(maximo) && maximo > 0 ? (
                <p role="status" className="mt-4 rounded-xl border border-linea bg-alterno px-4 py-3 text-[0.9375rem] leading-6">
                  Cerramos tu sesión en {equipoCerrado} porque tu cuenta permite {maximo} equipo{maximo === 1 ? "" : "s"} a la vez.
                </p>
              ) : null}
              {nivel ? <div className="mt-4"><BloqueNivel nivel={nivel} /></div> : null}
              <Lanzador persona={persona} />
              <FranjaPendientes persona={persona} />
            </>
          )}
        </div>
      </main>
    </>
  );
}
