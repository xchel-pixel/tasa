import Link from "next/link";
import { redirect } from "next/navigation";
import { Encabezado } from "@/components/encabezado";
import { hoyMx, ligaWhatsApp, type Contacto } from "@/lib/agenda";
import { TODOS_LOS_ROLES, tengoHerramienta } from "@/lib/herramientas";
import { exigirRol } from "@/lib/sesion";
import { crearClienteServidor, verComoId } from "@/lib/supabase/server";

export const metadata = { title: "Contactos — Tasa" };

/** Contactos de seguimiento (privados), con buscador y su próximo seguimiento. */
export default async function Contactos({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await exigirRol(...TODOS_LOS_ROLES);
  if (!(await tengoHerramienta("agenda"))) redirect("/");
  if (await verComoId()) redirect("/agenda");
  const buscar = ((await searchParams).q ?? "").trim().slice(0, 60);
  const supabase = await crearClienteServidor();
  let q = supabase.from("agenda_contactos").select("id, nombre, telefono, nota, seguimiento_en, archivado_en").is("archivado_en", null);
  // Sin comodines del usuario: solo letras, números y espacios.
  const limpio = buscar.replace(/[^0-9a-zA-ZáéíóúüñÁÉÍÓÚÜÑ ]/g, "");
  if (limpio) q = q.ilike("nombre", `%${limpio}%`);
  const { data } = await q.order("seguimiento_en", { nullsFirst: false }).order("nombre").limit(200).returns<Contacto[]>();
  const hoy = hoyMx();

  return (
    <>
      <Encabezado />
      <main className="flex flex-1 flex-col px-4 py-6">
        <div className="mx-auto w-full max-w-md md:max-w-3xl">
          <div className="flex items-center justify-between">
            <Link href="/agenda" className="toque text-[0.9375rem] font-semibold text-acento">← Agenda</Link>
            <Link href="/agenda/contactos/nuevo" className="text-[0.9375rem] font-semibold text-acento">+ Contacto</Link>
          </div>
          <h1 className="mt-2 text-[1.5rem] font-bold tracking-tight">Contactos</h1>
          <form className="mt-3">
            <label htmlFor="q" className="sr-only">Buscar</label>
            <input id="q" name="q" defaultValue={buscar} placeholder="Buscar por nombre" enterKeyHint="search"
              className="w-full rounded-lg border border-borde-campo bg-fondo px-3 py-2 text-[1rem] focus:border-acento" />
          </form>
          {(data ?? []).length ? (
            <ul className="mt-3 flex flex-col gap-1">
              {(data ?? []).map((k) => {
                const wa = ligaWhatsApp(k.telefono);
                return (
                  <li key={k.id} className="flex items-center gap-3 rounded-lg border border-linea bg-fondo px-3 py-2">
                    <Link href={`/agenda/contactos/${k.id}`} className="min-w-0 flex-1">
                      <span className="block font-semibold">{k.nombre}</span>
                      <span className={`text-[0.8125rem] ${k.seguimiento_en && k.seguimiento_en < hoy ? "text-error" : "text-secundario"}`}>
                        {k.seguimiento_en ? `Seguimiento: ${k.seguimiento_en.slice(8, 10)}/${k.seguimiento_en.slice(5, 7)}` : "Sin seguimiento"}
                      </span>
                    </Link>
                    {wa ? <a href={wa} target="_blank" rel="noopener noreferrer" className="text-[0.8125rem] font-semibold text-acento underline underline-offset-4">WhatsApp</a> : null}
                  </li>
                );
              })}
            </ul>
          ) : <p className="mt-3 text-[0.9375rem] text-secundario">{buscar ? "No hay contactos con ese nombre." : "Todavía no tienes contactos."}</p>}
        </div>
      </main>
    </>
  );
}
