import Link from "next/link";
import { redirect } from "next/navigation";
import { Encabezado } from "@/components/encabezado";
import { VolverPortada } from "@/components/volver-portada";
import { diaLegible, diaValido, horaMx, hoyMx, leerDia, ligaWhatsApp, sumarDias, type Tarea } from "@/lib/agenda";
import { TODOS_LOS_ROLES, tengoHerramienta } from "@/lib/herramientas";
import { exigirRol } from "@/lib/sesion";
import { verComoId } from "@/lib/supabase/server";
import { cambiarCita, cambiarContacto, cambiarTarea } from "./acciones";
import { AgregarTarea } from "./formularios";

export const metadata = { title: "Agenda — Tasa" };

const ICONO: Record<string, string> = { visita: "🏠", entrega: "📦", cobrar: "💰", cierre: "📅", pago_comisiones: "💵", paquete: "⏳" };
const BOTON_CHICO = "text-[0.8125rem] font-semibold text-acento underline underline-offset-4";

/** Agenda HOY (0091): una sola pantalla, como la agenda de papel. Privada: en "ver como" se muestra cerrada. */
export default async function Agenda({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await exigirRol(...TODOS_LOS_ROLES);
  if (!(await tengoHerramienta("agenda"))) redirect("/");
  if (await verComoId()) return <AgendaPrivada />;

  const hoy = hoyMx();
  const dia = diaValido((await searchParams).dia) ?? hoy;
  const esHoy = dia === hoy;
  const d = await leerDia(dia);
  const pendientes = d.tareas.filter((t) => !t.hecha_en).length;

  return (
    <>
      <Encabezado />
      <main className="flex flex-1 flex-col px-4 py-6">
        <div className="mx-auto w-full max-w-md">
          <div className="flex items-center justify-between px-1">
            <VolverPortada />
            <div className="flex gap-4">
              <Link href="/agenda/contactos" className="text-[0.9375rem] font-semibold text-acento">Contactos</Link>
              <Link href="/agenda/calendario" className="text-[0.9375rem] font-semibold text-acento">Calendario</Link>
            </div>
          </div>

          <div className="mt-3 flex items-center justify-between rounded-xl border border-linea bg-fondo px-2 py-2">
            <Link href={`/agenda?dia=${sumarDias(dia, -1)}`} aria-label="Día anterior" className="flex min-h-11 min-w-11 items-center justify-center text-[1.25rem]">‹</Link>
            <div className="text-center">
              <h1 className="text-[1.125rem] font-bold">{esHoy ? `Hoy, ${diaLegible(dia)}` : mayuscula(diaLegible(dia))}</h1>
              <p className="text-[0.8125rem] text-secundario">
                {d.citas.length} cita{d.citas.length === 1 ? "" : "s"} · {pendientes} tarea{pendientes === 1 ? "" : "s"} pendiente{pendientes === 1 ? "" : "s"}
                {esHoy ? null : <> · <Link href="/agenda" className="font-semibold text-acento">Ir a hoy</Link></>}
              </p>
            </div>
            <Link href={`/agenda?dia=${sumarDias(dia, 1)}`} aria-label="Día siguiente" className="flex min-h-11 min-w-11 items-center justify-center text-[1.25rem]">›</Link>
          </div>

          {d.eventos.length ? (
            <section className="mt-4">
              <h2 className="px-1 text-[0.8125rem] font-semibold uppercase tracking-wide text-secundario">De Tasa</h2>
              <ul className="mt-1 flex flex-col gap-1">
                {d.eventos.map((e) => (
                  <li key={e.uid} className="flex items-start gap-2 rounded-lg bg-alterno px-3 py-2 text-[0.9375rem]">
                    <span aria-hidden>{ICONO[e.tipo] ?? "•"}</span>
                    <span className="min-w-0 flex-1">
                      {e.hora ? <span className="font-semibold">{e.hora.slice(0, 5)} </span> : null}
                      {e.solicitud_id ? <Link href={`/trabajos/${e.solicitud_id}`} className="underline underline-offset-4">{e.titulo}</Link>
                        : e.tipo === "cobrar" ? <Link href="/mis-tramites" className="underline underline-offset-4">{e.titulo}</Link> : e.titulo}
                      {e.detalle ? <span className="block text-[0.8125rem] text-secundario">{e.detalle}</span> : null}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <section className="mt-5">
            <div className="flex items-baseline justify-between px-1">
              <h2 className="text-[0.8125rem] font-semibold uppercase tracking-wide text-secundario">Citas</h2>
              <Link href={`/agenda/cita/nueva?dia=${dia}`} className="text-[0.9375rem] font-semibold text-acento">+ Agregar cita</Link>
            </div>
            {d.citas.length ? (
              <ul className="mt-1 flex flex-col gap-1">
                {d.citas.map((c) => {
                  const pasada = new Date(c.termina ?? c.inicia).getTime() < d.ahora;
                  return (
                    <li key={c.id} className="rounded-lg border border-linea bg-fondo px-3 py-2">
                      <div className="flex items-start gap-3">
                        <span className="w-12 shrink-0 pt-0.5 font-semibold tabular-nums">{horaMx(c.inicia)}</span>
                        <Link href={`/agenda/cita/${c.id}`} className="min-w-0 flex-1">
                          <span className={`block text-[0.9375rem] ${c.estatus === "hecha" ? "text-secundario line-through" : ""}`}>{c.titulo}</span>
                          {c.lugar ? <span className="block text-[0.8125rem] text-secundario">{c.lugar}</span> : null}
                          <span className="text-[0.8125rem] text-secundario">
                            {c.estatus === "hecha" ? "Hecha" : c.estatus === "no_hecha" ? "No se hizo" : c.alarma_min !== null ? "⏰ Con alarma" : ""}
                          </span>
                        </Link>
                      </div>
                      {pasada && c.estatus === "pendiente" ? (
                        <div className="mt-1 flex items-center gap-3 pl-15 text-[0.8125rem]">
                          <span className="text-secundario">¿Se hizo?</span>
                          <form action={cambiarCita}><input type="hidden" name="id" value={c.id} /><input type="hidden" name="que" value="hecha" /><button className={BOTON_CHICO}>Sí</button></form>
                          <form action={cambiarCita}><input type="hidden" name="id" value={c.id} /><input type="hidden" name="que" value="no_hecha" /><button className={BOTON_CHICO}>No</button></form>
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            ) : <p className="mt-1 px-1 text-[0.9375rem] text-secundario">Sin citas.</p>}
          </section>

          <section className="mt-5">
            <h2 className="px-1 text-[0.8125rem] font-semibold uppercase tracking-wide text-secundario">{esHoy ? "Para hoy" : "Tareas del día"}</h2>
            <ListaTareas tareas={d.tareas} dia={dia} hoy={hoy} />
            <AgregarTarea dia={dia} />
          </section>

          {esHoy && d.seguimientos.length ? (
            <section className="mt-5">
              <h2 className="px-1 text-[0.8125rem] font-semibold uppercase tracking-wide text-secundario">Seguimientos</h2>
              <ul className="mt-1 flex flex-col gap-1">
                {d.seguimientos.map((k) => {
                  const wa = ligaWhatsApp(k.telefono);
                  const atrasado = k.seguimiento_en && k.seguimiento_en < hoy;
                  return (
                    <li key={k.id} className="rounded-lg border border-linea bg-fondo px-3 py-2">
                      <Link href={`/agenda/contactos/${k.id}`} className="block">
                        <span className="font-semibold">{k.nombre}</span>
                        {atrasado ? <span className="ml-2 text-[0.8125rem] text-error">atrasado</span> : null}
                        {k.nota ? <span className="block text-[0.8125rem] text-secundario">{k.nota}</span> : null}
                      </Link>
                      <div className="mt-1 flex gap-4 text-[0.8125rem]">
                        {wa ? <a href={wa} target="_blank" rel="noopener noreferrer" className={BOTON_CHICO}>WhatsApp</a> : null}
                        <form action={cambiarContacto}><input type="hidden" name="id" value={k.id} /><input type="hidden" name="que" value="seguido" /><button className={BOTON_CHICO}>Ya le di seguimiento</button></form>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : null}

          <details className="mt-5 rounded-xl border border-linea bg-fondo px-3 py-2">
            <summary className="cursor-pointer text-[0.9375rem] font-semibold">Para después ({d.despues.length})</summary>
            <ListaTareas tareas={d.despues} dia={dia} hoy={hoy} despues />
            <AgregarTarea dia={dia} despues />
          </details>
        </div>
      </main>
    </>
  );
}

function ListaTareas({ tareas, dia, hoy, despues = false }: { tareas: Tarea[]; dia: string; hoy: string; despues?: boolean }) {
  if (!tareas.length) return <p className="mt-1 px-1 text-[0.9375rem] text-secundario">{despues ? "Nada para después." : "Sin tareas."}</p>;
  return (
    <ul className="mt-1 flex flex-col">
      {tareas.map((t) => (
        <li key={t.id} className="flex items-start gap-2 border-b border-linea py-1.5 last:border-b-0">
          <form action={cambiarTarea}>
            <input type="hidden" name="id" value={t.id} />
            <input type="hidden" name="que" value={t.hecha_en ? "pendiente" : "hecha"} />
            <button aria-label={t.hecha_en ? "Marcar como pendiente" : "Marcar como hecha"}
              className={`flex h-6 w-6 items-center justify-center rounded border ${t.hecha_en ? "border-primario bg-primario text-sobre-primario" : "border-borde-campo bg-fondo"}`}>
              {t.hecha_en ? "✓" : ""}
            </button>
          </form>
          <span className={`min-w-0 flex-1 text-[0.9375rem] ${t.hecha_en ? "text-secundario line-through" : ""}`}>
            {t.texto}
            {t.fecha && t.fecha < hoy && !t.hecha_en ? <span className="ml-1 text-[0.8125rem] text-error">(desde el {t.fecha.slice(8, 10)}/{t.fecha.slice(5, 7)})</span> : null}
          </span>
          {!t.hecha_en ? (
            <form action={cambiarTarea}>
              <input type="hidden" name="id" value={t.id} />
              <input type="hidden" name="que" value={despues ? "hoy" : "despues"} />
              <input type="hidden" name="dia" value={dia} />
              <button className={BOTON_CHICO}>{despues ? "A este día" : "Después"}</button>
            </form>
          ) : null}
          <form action={cambiarTarea}>
            <input type="hidden" name="id" value={t.id} />
            <input type="hidden" name="que" value="borrar" />
            <button aria-label="Borrar tarea" className="px-1 text-[0.9375rem] text-secundario">×</button>
          </form>
        </li>
      ))}
    </ul>
  );
}

/** "jueves 19 de noviembre" → "Jueves 19 de noviembre". */
function mayuscula(t: string): string {
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function AgendaPrivada() {
  return (
    <>
      <Encabezado />
      <main className="flex flex-1 flex-col px-4 py-6">
        <div className="mx-auto w-full max-w-md">
          <VolverPortada />
          <h1 className="mt-2 text-[1.5rem] font-bold tracking-tight">Agenda privada</h1>
          <p className="mt-2 rounded-xl bg-alterno px-4 py-3 text-[0.9375rem] leading-6 text-secundario">
            La agenda de cada persona es privada: ni administración ni &quot;ver como&quot; la pueden abrir.
          </p>
        </div>
      </main>
    </>
  );
}
