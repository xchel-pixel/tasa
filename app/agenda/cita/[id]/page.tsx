import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Encabezado } from "@/components/encabezado";
import { diaMx, diaValido, horaMx, horaValida, hoyMx, ligaWhatsApp, type Cita, type Contacto } from "@/lib/agenda";
import { TODOS_LOS_ROLES, tengoHerramienta } from "@/lib/herramientas";
import { exigirRol } from "@/lib/sesion";
import { crearClienteServidor, verComoId } from "@/lib/supabase/server";
import { cambiarCita } from "../../acciones";
import { FormaCita } from "../../formularios";

export const metadata = { title: "Cita — Tasa" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BOTON = "flex min-h-11 items-center justify-center rounded-lg border border-linea bg-fondo px-3 text-center text-[0.9375rem] font-semibold";

/** Cita nueva (/agenda/cita/nueva?dia=…) o una existente, con "Cotizar avalúo", "Abrir en el mapa" y "WhatsApp". */
export default async function CitaAgenda({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>>;
}) {
  const persona = await exigirRol(...TODOS_LOS_ROLES);
  if (!(await tengoHerramienta("agenda"))) redirect("/");
  if (await verComoId()) redirect("/agenda");
  const { id } = await params;
  const q = await searchParams;
  const nueva = id === "nueva";
  if (!nueva && !UUID.test(id)) notFound();
  const supabase = await crearClienteServidor();
  const [cita, contactos, herramientas] = await Promise.all([
    nueva ? Promise.resolve({ data: null })
      : supabase.from("agenda_citas").select("id, inicia, termina, titulo, lugar, clave_catastral, contacto_id, solicitud_id, alarma_min, estatus, notas")
          .eq("id", id).maybeSingle<Cita>(),
    supabase.from("agenda_contactos").select("id, nombre, telefono").is("archivado_en", null).order("nombre").returns<Pick<Contacto, "id" | "nombre" | "telefono">[]>(),
    Promise.all([tengoHerramienta("mapa_catastral")]),
  ]);
  const c = cita.data;
  if (!nueva && !c) notFound();
  const [mapa] = herramientas;
  const contacto = c?.contacto_id ? (contactos.data ?? []).find((k) => k.id === c.contacto_id) ?? null : null;
  const wa = ligaWhatsApp(contacto?.telefono ?? null);
  const dia = c ? diaMx(c.inicia) : diaValido(q.dia) ?? hoyMx();
  const contactoInicial = q.contacto && UUID.test(q.contacto) ? q.contacto : "";

  return (
    <>
      <Encabezado />
      <main className="flex flex-1 flex-col px-4 py-6">
        <div className="mx-auto w-full max-w-md md:max-w-3xl">
          <Link href={`/agenda?dia=${dia}`} className="toque text-[0.9375rem] font-semibold text-acento">← Agenda</Link>
          <h1 className="mt-2 text-[1.5rem] font-bold tracking-tight">{nueva ? "Cita nueva" : c!.titulo}</h1>

          {c ? (
            <div className="mt-3 grid grid-cols-2 gap-2">
              {persona.rol === "comisionista" ? (
                <Link href={`/solicitudes/nueva?${new URLSearchParams({ desde: "agenda", ...(c.clave_catastral ? { clave: c.clave_catastral } : {}), ...(c.lugar ? { direccion: c.lugar } : {}),
                  ...(contacto ? { cliente: contacto.nombre, ...(contacto.telefono ? { telefono: contacto.telefono } : {}) } : {}) })}`}
                  className={BOTON}>Cotizar avalúo</Link>
              ) : null}
              {mapa && (c.clave_catastral || c.lugar) ? (
                <Link href={`/mapa-catastral?${new URLSearchParams(c.clave_catastral ? { clave: c.clave_catastral } : { buscar: c.lugar ?? "" })}`} className={BOTON}>Abrir en el mapa</Link>
              ) : null}
              {wa ? <a href={wa} target="_blank" rel="noopener noreferrer" className={BOTON}>WhatsApp</a> : null}
              {c.solicitud_id ? <Link href={`/trabajos/${c.solicitud_id}`} className={BOTON}>Ver el trámite</Link> : null}
            </div>
          ) : null}

          {c ? (
            <div className="mt-3 flex items-center gap-3 text-[0.9375rem]">
              <span className="text-secundario">Estatus:</span>
              {(["pendiente", "hecha", "no_hecha"] as const).map((e) => (
                <form key={e} action={cambiarCita}>
                  <input type="hidden" name="id" value={c.id} />
                  <input type="hidden" name="que" value={e} />
                  <button className={`rounded-full border px-3 py-1 text-[0.8125rem] font-semibold ${c.estatus === e ? "border-primario bg-primario text-sobre-primario" : "border-linea"}`}>
                    {e === "pendiente" ? "Pendiente" : e === "hecha" ? "Hecha" : "No se hizo"}
                  </button>
                </form>
              ))}
            </div>
          ) : null}

          <FormaCita contactos={(contactos.data ?? []).map((k) => ({ id: k.id, nombre: k.nombre }))} c={{
            id: c?.id, dia, hora: c ? horaMx(c.inicia) : horaValida(q.hora) ?? "09:00", hora_fin: c?.termina ? horaMx(c.termina) : "", titulo: c?.titulo ?? "",
            lugar: c?.lugar ?? "", clave: c?.clave_catastral ?? "", contacto_id: c?.contacto_id ?? contactoInicial, solicitud_id: c?.solicitud_id ?? "",
            alarma: c?.alarma_min === null || c?.alarma_min === undefined ? "" : String(c.alarma_min), notas: c?.notas ?? "",
          }} />

          {c ? (
            <form action={cambiarCita} className="mt-6">
              <input type="hidden" name="id" value={c.id} />
              <input type="hidden" name="que" value="borrar" />
              <input type="hidden" name="dia" value={dia} />
              <button className="text-[0.9375rem] font-semibold text-error underline underline-offset-4">Borrar la cita</button>
            </form>
          ) : null}
        </div>
      </main>
    </>
  );
}
