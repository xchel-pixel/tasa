import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Encabezado } from "@/components/encabezado";
import { ligaWhatsApp, type Contacto } from "@/lib/agenda";
import { TODOS_LOS_ROLES, tengoHerramienta } from "@/lib/herramientas";
import { exigirRol } from "@/lib/sesion";
import { crearClienteServidor, verComoId } from "@/lib/supabase/server";
import { cambiarContacto } from "../../acciones";
import { FormaContacto } from "../../formularios";

export const metadata = { title: "Contacto — Tasa" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BOTON = "flex min-h-11 items-center justify-center rounded-lg border border-linea bg-fondo px-3 text-center text-[0.9375rem] font-semibold";

/** Contacto nuevo (/agenda/contactos/nuevo) o uno existente, con WhatsApp, cita nueva y cotizar. */
export default async function ContactoAgenda({ params }: { params: Promise<{ id: string }> }) {
  const persona = await exigirRol(...TODOS_LOS_ROLES);
  if (!(await tengoHerramienta("agenda"))) redirect("/");
  if (await verComoId()) redirect("/agenda");
  const { id } = await params;
  const nuevo = id === "nuevo";
  if (!nuevo && !UUID.test(id)) notFound();
  const k = nuevo ? null : (await (await crearClienteServidor()).from("agenda_contactos")
    .select("id, nombre, telefono, nota, seguimiento_en, archivado_en").eq("id", id).maybeSingle<Contacto>()).data;
  if (!nuevo && !k) notFound();
  const wa = ligaWhatsApp(k?.telefono ?? null);

  return (
    <>
      <Encabezado />
      <main className="flex flex-1 flex-col px-4 py-6">
        <div className="mx-auto w-full max-w-md">
          <Link href="/agenda/contactos" className="toque text-[0.9375rem] font-semibold text-acento">← Contactos</Link>
          <h1 className="mt-2 text-[1.5rem] font-bold tracking-tight">{nuevo ? "Contacto nuevo" : k!.nombre}</h1>
          {k ? (
            <div className="mt-3 grid grid-cols-2 gap-2">
              {wa ? <a href={wa} target="_blank" rel="noopener noreferrer" className={BOTON}>WhatsApp</a> : null}
              <Link href={`/agenda/cita/nueva?contacto=${k.id}`} className={BOTON}>Agendar cita</Link>
              {persona.rol === "comisionista" ? (
                <Link href={`/solicitudes/nueva?${new URLSearchParams({ desde: "agenda", cliente: k.nombre, ...(k.telefono ? { telefono: k.telefono } : {}) })}`} className={BOTON}>Cotizar avalúo</Link>
              ) : null}
            </div>
          ) : null}
          <FormaContacto k={{ id: k?.id, nombre: k?.nombre ?? "", telefono: k?.telefono ?? "", nota: k?.nota ?? "", seguimiento_en: k?.seguimiento_en ?? "" }} />
          {k ? (
            <div className="mt-6 flex gap-6">
              <form action={cambiarContacto}>
                <input type="hidden" name="id" value={k.id} />
                <input type="hidden" name="que" value="archivar" />
                <button className="text-[0.9375rem] font-semibold text-acento underline underline-offset-4">Archivar</button>
              </form>
              <form action={cambiarContacto}>
                <input type="hidden" name="id" value={k.id} />
                <input type="hidden" name="que" value="borrar" />
                <button className="text-[0.9375rem] font-semibold text-error underline underline-offset-4">Borrar</button>
              </form>
            </div>
          ) : null}
        </div>
      </main>
    </>
  );
}
