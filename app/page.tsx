import Link from "next/link";
import { redirect } from "next/navigation";
import { Encabezado } from "@/components/encabezado";
import { InicioComisionista } from "@/components/inicio-comisionista";
import { obtenerContacto } from "@/lib/contacto";
import { NOMBRE_DEL_ROL, obtenerSesion } from "@/lib/sesion";

/**
 * El inicio decide por rol: el comisionista ve sus trabajos y su mes;
 * el staff, por ahora, un aviso de lo que viene.
 */
export default async function Inicio() {
  const sesion = await obtenerSesion();
  if (!sesion) redirect("/entrar");

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
          ) : (
            <>
              <h1 className="text-[1.5rem] font-bold tracking-tight">
                Hola, {persona.nombre.split(" ")[0]}
              </h1>
              <p className="mt-1 text-[0.9375rem] text-secundario">
                {NOMBRE_DEL_ROL[persona.rol]} · {persona.correo}
              </p>

              <section className="mt-8 rounded-xl border border-linea bg-alterno px-5 py-4">
                <p className="leading-7">
                  Aquí vas a ver primero los pagos por confirmar y las alertas de Notion.
                </p>
                <p className="mt-2 text-[0.9375rem] text-secundario">
                  El panel se construye después de las pantallas del comisionista.
                </p>
              </section>

              {persona.rol === "super_admin" ? (
                <Link
                  href="/ajustes"
                  className="toque mt-4 text-[0.9375rem] font-semibold text-acento underline underline-offset-4"
                >
                  Ajustes
                </Link>
              ) : null}
            </>
          )}
        </div>
      </main>
    </>
  );
}
