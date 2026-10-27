import { redirect } from "next/navigation";
import { Encabezado } from "@/components/encabezado";
import { elegirOrganizacion } from "@/app/organizacion/acciones";
import { obtenerSesion } from "@/lib/sesion";
import { crearClienteServidor, oExplota } from "@/lib/supabase/server";
import FormularioOrganizacion from "./formulario-organizacion";

export const metadata = { title: "Plataforma — Tasa" };

type Fila = { id: string; nombre: string; slug: string; activa: boolean; prefijo_folio: string; creado_en: string };

/** Solo la plataforma: las organizaciones, darlas de alta y entrar a cualquiera. */
export default async function Plataforma() {
  const sesion = await obtenerSesion();
  if (!sesion) redirect("/entrar");
  if (!sesion.superPlataforma) redirect("/");

  const supabase = await crearClienteServidor();
  const organizaciones =
    oExplota(
      await supabase
        .from("organizaciones")
        .select("id, nombre, slug, activa, prefijo_folio, creado_en")
        .order("nombre")
        .returns<Fila[]>(),
      "las organizaciones"
    ) ?? [];

  return (
    <>
      <Encabezado />
      <main className="flex flex-1 flex-col px-6 py-8">
        <div className="mx-auto w-full max-w-md">
          <h1 className="text-[1.5rem] font-bold tracking-tight">Plataforma</h1>
          <p className="mt-1 text-[0.9375rem] leading-6 text-secundario">
            Cada organización está aislada: sus datos, niveles, cuentas y ajustes no se mezclan.
          </p>

          <ul className="mt-6 flex flex-col gap-3">
            {organizaciones.map((o) => (
              <li key={o.id} className="rounded-xl border border-linea px-4 py-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold">{o.nombre}</p>
                    <p className="text-[0.9375rem] text-secundario">
                      {o.slug} · folios {o.prefijo_folio}-AAAA-NNNN{o.activa ? "" : " · inactiva"}
                    </p>
                  </div>
                  <form action={elegirOrganizacion}>
                    <input type="hidden" name="organizacion" value={o.id} />
                    <button type="submit" className="toque text-[0.9375rem] font-semibold text-acento underline underline-offset-4">
                      Entrar
                    </button>
                  </form>
                </div>
              </li>
            ))}
          </ul>

          <section className="mt-10">
            <h2 className="text-[1.125rem] font-bold">Nueva organización</h2>
            <p className="mt-1 text-[0.9375rem] leading-6 text-secundario">
              Nace con conector manual, niveles y orígenes del dinero por omisión, y su primer administrador. Sus
              marcas, cuentas y servicios los da de alta ese administrador.
            </p>
            <FormularioOrganizacion />
          </section>
        </div>
      </main>
    </>
  );
}
