import { redirect } from "next/navigation";
import { cerrarSesion } from "@/app/acciones";
import { Marca } from "@/components/marca";
import { NOMBRE_DEL_ROL, esStaff, obtenerSesion } from "@/lib/sesion";

/**
 * El inicio decide por rol. Por ahora solo confirma quién entró: las
 * pantallas de cada rol son la siguiente etapa.
 */
export default async function Inicio() {
  const sesion = await obtenerSesion();
  if (!sesion) redirect("/entrar");

  const { persona } = sesion;

  return (
    <>
      <header className="border-b border-linea bg-fondo px-6 py-4">
        <div className="mx-auto flex w-full max-w-md items-center justify-between">
          <Marca className="text-[1.375rem]" />
          <form action={cerrarSesion}>
            <button
              type="submit"
              className="toque text-[0.9375rem] font-semibold text-acento underline underline-offset-4"
            >
              Cerrar sesión
            </button>
          </form>
        </div>
      </header>

      <main className="flex flex-1 flex-col px-6 py-8">
        <div className="mx-auto w-full max-w-md">
          {persona ? (
            <>
              <h1 className="text-[1.5rem] font-bold tracking-tight">
                Hola, {persona.nombre.split(" ")[0]}
              </h1>
              <p className="mt-1 text-[0.9375rem] text-secundario">
                {NOMBRE_DEL_ROL[persona.rol]} · {persona.correo}
              </p>

              <section className="mt-8 rounded-xl border border-linea bg-alterno px-5 py-4">
                <p className="leading-7">
                  {esStaff(persona)
                    ? "Aquí vas a ver primero los pagos por confirmar y las alertas de Notion."
                    : "Aquí vas a ver tus trabajos, su estatus y tu estado de cuenta."}
                </p>
                <p className="mt-2 text-[0.9375rem] text-secundario">
                  Esta pantalla se construye en la siguiente etapa.
                </p>
              </section>
            </>
          ) : (
            <>
              <h1 className="text-[1.5rem] font-bold tracking-tight">
                Tu correo no está dado de alta
              </h1>
              <p className="mt-2 leading-7 text-secundario">
                Entraste como {sesion.correo}, pero nadie te ha registrado en
                Tasa. Pídele a Xchel que te dé de alta con este mismo correo.
              </p>
            </>
          )}
        </div>
      </main>
    </>
  );
}
