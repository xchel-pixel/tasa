import { redirect } from "next/navigation";
import { Encabezado } from "@/components/encabezado";
import { NOMBRE_DEL_ROL, obtenerSesion, type Rol } from "@/lib/sesion";
import { crearClienteServidor, oExplota } from "@/lib/supabase/server";
import { elegirOrganizacion } from "./acciones";

export const metadata = { title: "Organización — Tasa" };

type Opcion = { id: string; nombre: string; slug: string; rol: Rol; es_miembro: boolean };

/**
 * Quien pertenece a más de una organización elige con cuál trabaja. La
 * elección se guarda en su persona: el RLS la lee en cada consulta.
 */
export default async function ElegirOrganizacion() {
  const sesion = await obtenerSesion();
  if (!sesion) redirect("/entrar");

  const supabase = await crearClienteServidor();
  const opciones = (oExplota(await supabase.rpc("mis_organizaciones"), "tus organizaciones") ?? []) as Opcion[];
  const actual = sesion.persona?.organizacion.id;

  return (
    <>
      <Encabezado />
      <main className="flex flex-1 flex-col px-6 py-8">
        <div className="mx-auto w-full max-w-md">
          <h1 className="text-[1.5rem] font-bold tracking-tight">¿Con qué organización trabajas?</h1>
          {opciones.length === 0 ? (
            <p className="mt-4 rounded-xl bg-alterno px-4 py-3 text-secundario">
              No perteneces a ninguna organización activa. Pide que te den de alta.
            </p>
          ) : (
            <ul className="mt-6 flex flex-col gap-3">
              {opciones.map((o) => (
                <li key={o.id}>
                  <form action={elegirOrganizacion}>
                    <input type="hidden" name="organizacion" value={o.id} />
                    <button
                      type="submit"
                      className={`w-full rounded-xl border px-4 py-4 text-left ${
                        o.id === actual ? "border-acento bg-tinte" : "border-linea bg-fondo"
                      }`}
                    >
                      <span className="block font-semibold">{o.nombre}</span>
                      <span className="block text-[0.9375rem] text-secundario">
                        {o.es_miembro ? NOMBRE_DEL_ROL[o.rol] : "Como administrador de plataforma"}
                        {o.id === actual ? " · actual" : ""}
                      </span>
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          )}
        </div>
      </main>
    </>
  );
}
