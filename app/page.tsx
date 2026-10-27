import { redirect } from "next/navigation";
import { cerrarSesion } from "@/app/acciones";
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
    <main className="flex flex-1 flex-col px-6 py-10">
      <div className="mx-auto w-full max-w-md">
        <p className="text-[0.9375rem] font-medium text-acento">Tasa</p>

        {persona ? (
          <>
            <h1 className="mt-1 text-[1.5rem] font-semibold tracking-tight">
              Hola, {persona.nombre.split(" ")[0]}
            </h1>
            <p className="mt-1 text-[0.9375rem] text-apagado">
              {NOMBRE_DEL_ROL[persona.rol]} · {persona.correo}
            </p>

            <section className="mt-8 rounded-lg border border-linea bg-tarjeta px-5 py-4">
              <p className="leading-7">
                {esStaff(persona)
                  ? "Aquí vas a ver primero los pagos por confirmar y las alertas de Notion."
                  : "Aquí vas a ver tus trabajos, su estatus y tu estado de cuenta."}
              </p>
              <p className="mt-2 text-[0.9375rem] text-apagado">
                Esta pantalla se construye en la siguiente etapa.
              </p>
            </section>
          </>
        ) : (
          <>
            <h1 className="mt-1 text-[1.5rem] font-semibold tracking-tight">
              Tu correo no está dado de alta
            </h1>
            <p className="mt-2 leading-7 text-apagado">
              Entraste como {sesion.correo}, pero nadie te ha registrado en
              Tasa. Pídele a Xchel que te dé de alta con este mismo correo.
            </p>
          </>
        )}

        <form action={cerrarSesion} className="mt-8">
          <button
            type="submit"
            className="toque text-[0.9375rem] text-apagado underline underline-offset-4"
          >
            Cerrar sesión
          </button>
        </form>
      </div>
    </main>
  );
}
