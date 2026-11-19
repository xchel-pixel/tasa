import Link from "next/link";
import { redirect } from "next/navigation";
import { Encabezado } from "@/components/encabezado";
import { VolverPortada } from "@/components/volver-portada";
import {
  acomodar, diaLegible, diaMx, diaValido, horaMx, hoyMx, leerDia, ligaWhatsApp, minutosMx, sumarDias,
  type Cita, type Contacto, type EventoTasa, type Tarea,
} from "@/lib/agenda";
import { TODOS_LOS_ROLES, tengoHerramienta } from "@/lib/herramientas";
import { exigirRol } from "@/lib/sesion";
import { verComoId } from "@/lib/supabase/server";
import { cambiarCita, cambiarContacto, cambiarTarea, guardarJornada } from "./acciones";
import { AgregarTarea } from "./formularios";
import { FechaConCalendario, VistaAgenda } from "./vista";

export const metadata = { title: "Agenda — Tasa" };

const ICONO: Record<string, string> = { visita: "🏠", entrega: "📦", cobrar: "💰", cierre: "📅", pago_comisiones: "💵", paquete: "⏳" };
const BOTON_CHICO = "text-[0.8125rem] font-semibold text-acento underline underline-offset-4";
const TITULO = "border-b-2 border-primario pb-1 text-[1rem] font-bold text-primario";
/** 1 px por minuto: una hora mide 60 px; las franjas para tocar son de media hora. */
const MEDIA_HORA = 30;
const MIN_ALTO = 28;
const CANAL = 48;

/** Agenda HOY (0091, 0092): Lista y Jornada por horas. Privada: en "ver como" se muestra cerrada. */
export default async function Agenda({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await exigirRol(...TODOS_LOS_ROLES);
  if (!(await tengoHerramienta("agenda"))) redirect("/");
  if (await verComoId()) return <AgendaPrivada />;

  const hoy = hoyMx();
  const dia = diaValido((await searchParams).dia) ?? hoy;
  const esHoy = dia === hoy;
  const d = await leerDia(dia);
  const pendientes = d.tareas.filter((t) => !t.hecha_en).length;
  const conHora = d.eventos.filter((e) => e.hora);
  const deDia = d.eventos.filter((e) => !e.hora);
  const ini = d.jornada.inicia * 60;
  const fin = d.jornada.termina * 60;
  const ahoraMin = esHoy ? minutosMx(d.ahora) : null;
  const ahoraY = ahoraMin !== null && ahoraMin >= ini && ahoraMin <= fin ? ahoraMin - ini : null;

  return (
    <>
      <Encabezado />
      <main className="flex flex-1 flex-col pt-3 lg:pb-10">
        <div className="mx-auto w-full max-w-6xl px-4 lg:px-6">
          <div className="flex items-center justify-between px-1">
            <VolverPortada />
            <div className="flex gap-4">
              <Link href="/agenda/contactos" className="text-[0.9375rem] font-semibold text-acento">Contactos</Link>
              <Link href="/agenda/calendario" className="text-[0.9375rem] font-semibold text-acento">Calendario</Link>
            </div>
          </div>

          <div className="mt-3 flex items-center justify-between gap-1 rounded-xl bg-primario px-1 py-1 text-sobre-primario lg:px-4 lg:py-3">
            <Link href={`/agenda?dia=${sumarDias(dia, -1)}`} aria-label="Día anterior" className="flex min-h-11 min-w-11 items-center justify-center text-[1.5rem]">‹</Link>
            <div className="flex flex-col items-center">
              <FechaConCalendario key={dia} dia={dia} hoy={hoy} titulo={mayuscula(diaLegible(dia))} />
              <p className="text-[0.8125rem] opacity-90">
                {esHoy ? "Hoy · " : null}
                {d.citas.length} cita{d.citas.length === 1 ? "" : "s"} · {pendientes} pendiente{pendientes === 1 ? "" : "s"}
              </p>
            </div>
            <div className="flex items-center">
              {esHoy ? null : (
                <Link href="/agenda" className="rounded-lg border border-sobre-primario px-2 py-1 text-[0.8125rem] font-semibold">Hoy</Link>
              )}
              <Link href={`/agenda?dia=${sumarDias(dia, 1)}`} aria-label="Día siguiente" className="flex min-h-11 min-w-11 items-center justify-center text-[1.5rem]">›</Link>
            </div>
          </div>
        </div>

        <VistaAgenda pendientes={pendientes} citas={d.citas.length + conHora.length} ahoraY={ahoraY}
          lista={<Lista d={d} dia={dia} hoy={hoy} esHoy={esHoy} />}
          jornada={<Jornada dia={dia} citas={d.citas} conHora={conHora} deDia={deDia} ini={ini} fin={fin} ahora={d.ahora}
            ahoraMin={ahoraMin} ahoraY={ahoraY} jornada={d.jornada} />} />
      </main>
    </>
  );
}

function Lista({ d, dia, hoy, esHoy }: { d: Awaited<ReturnType<typeof leerDia>>; dia: string; hoy: string; esHoy: boolean }) {
  return (
    <div className="flex flex-col gap-6 pt-2">
      <section>
        <h2 className={TITULO}>{esHoy ? "Para hoy" : "Para este día"}</h2>
        <ListaTareas tareas={d.tareas} dia={dia} hoy={hoy} />
        <AgregarTarea dia={dia} />
      </section>
      <section>
        <h2 className={TITULO}>Para después</h2>
        <ListaTareas tareas={d.despues} dia={dia} hoy={hoy} despues />
        <AgregarTarea dia={dia} despues />
      </section>
      <Seguimientos contactos={d.seguimientos} hoy={hoy} />
    </div>
  );
}

function Seguimientos({ contactos, hoy }: { contactos: Contacto[]; hoy: string }) {
  return (
    <section>
      <div className="flex items-baseline justify-between gap-2 border-b-2 border-primario pb-1">
        <h2 className="text-[1rem] font-bold text-primario">Contactos / seguimiento</h2>
        <Link href="/agenda/contactos" className="text-[0.8125rem] font-semibold text-acento">Todos</Link>
      </div>
      {contactos.length ? (
        <ul className="flex flex-col">
          {contactos.map((k) => {
            const wa = ligaWhatsApp(k.telefono);
            const atrasado = k.seguimiento_en && k.seguimiento_en < hoy;
            return (
              <li key={k.id} className="flex items-start gap-3 border-b border-linea py-2 last:border-b-0">
                <Link href={`/agenda/contactos/${k.id}`} className="min-w-0 flex-1">
                  <span className="font-semibold">{k.nombre}</span>
                  {atrasado ? <span className="ml-2 text-[0.8125rem] text-error">desde el {k.seguimiento_en!.slice(8, 10)}/{k.seguimiento_en!.slice(5, 7)}</span> : null}
                  {k.nota ? <span className="block truncate text-[0.8125rem] text-secundario">{k.nota}</span> : null}
                </Link>
                {wa ? <a href={wa} target="_blank" rel="noopener noreferrer" className={BOTON_CHICO}>WhatsApp</a> : null}
                <form action={cambiarContacto}>
                  <input type="hidden" name="id" value={k.id} />
                  <input type="hidden" name="que" value="seguido" />
                  <button className={BOTON_CHICO}>Hecho</button>
                </form>
              </li>
            );
          })}
        </ul>
      ) : <p className="mt-2 text-[0.9375rem] text-secundario">Nadie para seguimiento este día.</p>}
      <Link href="/agenda/contactos/nuevo" className="mt-2 inline-block text-[0.9375rem] font-semibold text-acento">+ Agregar contacto</Link>
    </section>
  );
}

type BloqueCita = { id: string; desde: number; hasta: number; cita?: Cita; evento?: EventoTasa };

function Jornada({ dia, citas, conHora, deDia, ini, fin, ahora, ahoraMin, ahoraY, jornada }: {
  dia: string; citas: Cita[]; conHora: EventoTasa[]; deDia: EventoTasa[]; ini: number; fin: number; ahora: number;
  ahoraMin: number | null; ahoraY: number | null; jornada: { inicia: number; termina: number };
}) {
  const todos: BloqueCita[] = [
    ...citas.map((c) => {
      const desde = minutosMx(c.inicia);
      const hasta = c.termina && diaMx(c.termina) === diaMx(c.inicia) ? minutosMx(c.termina) : desde + 60;
      return { id: c.id, desde, hasta: Math.max(hasta, desde + 15), cita: c };
    }),
    ...conHora.map((e) => {
      const [h, m] = e.hora!.split(":").map(Number);
      return { id: e.uid, desde: h * 60 + m, hasta: h * 60 + m + 60, evento: e };
    }),
  ];
  const antes = todos.filter((b) => b.desde < ini).sort((a, b) => a.desde - b.desde);
  const despues = todos.filter((b) => b.desde >= fin).sort((a, b) => a.desde - b.desde);
  const dentro = acomodar(todos.filter((b) => b.desde >= ini && b.desde < fin).map((b) => ({ ...b, hasta: Math.min(b.hasta, fin) })));
  const franjas = Array.from({ length: (fin - ini) / MEDIA_HORA }, (_, i) => ini + i * MEDIA_HORA);

  return (
    <div className="pt-2">
      <h2 className={TITULO}>Jornada <span className="text-[0.8125rem] font-normal text-secundario">{jornada.inicia}:00 a {jornada.termina}:00</span></h2>

      {deDia.length ? (
        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[0.8125rem]">
          <span className="text-secundario">Todo el día:</span>
          {deDia.map((e) => (
            <Link key={e.uid} href={e.solicitud_id ? `/trabajos/${e.solicitud_id}` : e.tipo === "cobrar" ? "/mis-tramites" : "#"}
              className="rounded-md bg-tinte px-2 py-0.5 font-semibold text-primario">
              <span aria-hidden>{ICONO[e.tipo] ?? "•"} </span>{e.titulo}
            </Link>
          ))}
        </div>
      ) : null}

      {antes.length ? <FueraDeHorario titulo={`Antes de las ${jornada.inicia}:00`} bloques={antes} ahora={ahora} /> : null}

      <div className="relative mt-2" style={{ height: fin - ini }}>
        {franjas.map((m) => {
          const hora = `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
          const entera = m % 60 === 0;
          return (
            <Link key={m} href={`/agenda/cita/nueva?dia=${dia}&hora=${hora}`} aria-label={`Agregar cita a las ${Math.floor(m / 60)}:${hora.slice(3)}`}
              className={`absolute inset-x-0 block hover:bg-alterno ${entera ? "border-t border-linea" : "border-t border-dashed border-linea/60"}`}
              style={{ top: m - ini, height: MEDIA_HORA }}>
              {entera ? <span className="absolute left-0 top-0.5 w-10 text-right text-[0.75rem] text-secundario">{Math.floor(m / 60)}:00</span> : null}
            </Link>
          );
        })}
        <div className="absolute inset-x-0 border-t border-linea" style={{ top: fin - ini }} />

        {ahoraY !== null ? (
          <>
            {/* La línea va DETRÁS de los bloques (que son opacos): nunca tapa su texto. */}
            <div aria-hidden className="pointer-events-none absolute right-0 z-10 border-t-2 border-primario" style={{ top: ahoraY - 1, left: CANAL - 4 }} />
            <span className="pointer-events-none absolute left-0 z-30 w-11 rounded bg-primario px-0.5 text-center text-[0.6875rem] font-semibold leading-4 text-sobre-primario"
              style={{ top: ahoraY - 8 }}>
              {String(Math.floor(ahoraMin! / 60))}:{String(ahoraMin! % 60).padStart(2, "0")}
            </span>
          </>
        ) : null}

        {dentro.map((b) => (
          <div key={b.id} className="absolute z-20 p-px"
            style={{
              top: b.desde - ini, height: Math.max(MIN_ALTO, b.hasta - b.desde),
              left: `calc(${CANAL}px + (100% - ${CANAL}px) * ${b.columna / b.columnas})`, width: `calc((100% - ${CANAL}px) / ${b.columnas})`,
            }}>
            <BloqueJornada b={b} ahora={ahora} />
          </div>
        ))}
      </div>

      {despues.length ? <FueraDeHorario titulo={`Después de las ${jornada.termina}:00`} bloques={despues} ahora={ahora} /> : null}

      <Link href={`/agenda/cita/nueva?dia=${dia}`} className="mt-3 flex min-h-11 items-center justify-center rounded-lg bg-primario font-semibold text-sobre-primario">
        + Agregar cita
      </Link>

      <details className="mt-4 text-[0.9375rem]">
        <summary className="cursor-pointer font-semibold text-acento">Horario de la jornada</summary>
        <form action={guardarJornada} className="mt-2 flex flex-wrap items-end gap-2">
          <label className="text-[0.8125rem] font-semibold">De
            <select name="inicia" defaultValue={jornada.inicia} className="mt-1 block rounded-lg border border-borde-campo bg-fondo px-2 py-2">
              {Array.from({ length: 21 }, (_, h) => <option key={h} value={h}>{h}:00</option>)}
            </select>
          </label>
          <label className="text-[0.8125rem] font-semibold">A
            <select name="termina" defaultValue={jornada.termina} className="mt-1 block rounded-lg border border-borde-campo bg-fondo px-2 py-2">
              {Array.from({ length: 21 }, (_, i) => i + 4).map((h) => <option key={h} value={h}>{h}:00</option>)}
            </select>
          </label>
          <button className="min-h-10 rounded-lg border border-linea px-3 font-semibold">Guardar</button>
        </form>
        <p className="mt-1 text-[0.8125rem] text-secundario">Al menos 4 horas. Las citas fuera de este horario salen arriba o abajo de la jornada.</p>
      </details>
    </div>
  );
}

function FueraDeHorario({ titulo, bloques, ahora }: { titulo: string; bloques: BloqueCita[]; ahora: number }) {
  return (
    <div className="mt-2 rounded-lg bg-alterno p-2">
      <p className="text-[0.8125rem] font-semibold text-secundario">{titulo}</p>
      <ul className="mt-1 flex flex-col gap-1">
        {bloques.map((b) => <li key={b.id} className="min-h-10"><BloqueJornada b={b} ahora={ahora} /></li>)}
      </ul>
    </div>
  );
}

function BloqueJornada({ b, ahora }: { b: BloqueCita; ahora: number }) {
  if (b.evento) {
    const e = b.evento;
    return (
      <Link href={e.solicitud_id ? `/trabajos/${e.solicitud_id}` : "#"}
        className="block h-full overflow-hidden rounded-md border border-dashed border-acento bg-fondo px-2 py-0.5 text-[0.8125rem] leading-4 text-primario">
        <span className="font-semibold">De Tasa · {e.hora!.slice(0, 5)}</span> {e.titulo}
        {e.detalle ? <span className="block truncate text-secundario">{e.detalle}</span> : null}
      </Link>
    );
  }
  const c = b.cita!;
  const pasada = new Date(c.termina ?? c.inicia).getTime() < ahora;
  const preguntar = pasada && c.estatus === "pendiente";
  return (
    <div className={`flex h-full items-start gap-1 overflow-hidden rounded-md border px-2 py-0.5 text-[0.8125rem] leading-4 ${
      c.estatus === "hecha" ? "border-linea bg-alterno text-secundario" : "border-acento bg-tinte text-primario"}`}>
      <Link href={`/agenda/cita/${c.id}`} className="min-w-0 flex-1">
        <span className="font-semibold">{horaMx(c.inicia)}{c.termina ? `–${horaMx(c.termina)}` : ""}</span>{" "}
        <span className={c.estatus === "hecha" ? "line-through" : ""}>{c.titulo}</span>
        {c.estatus === "no_hecha" ? <span className="text-secundario"> · no se hizo</span> : null}
        {c.alarma_min !== null && !pasada ? <span aria-label="Con alarma"> ⏰</span> : null}
        {c.lugar ? <span className="block truncate text-secundario">{c.lugar}</span> : null}
      </Link>
      {preguntar ? (
        <span className="flex shrink-0 items-center gap-2 bg-tinte">
          <span className="text-secundario">¿Se hizo?</span>
          <form action={cambiarCita}><input type="hidden" name="id" value={c.id} /><input type="hidden" name="que" value="hecha" /><button className={BOTON_CHICO}>Sí</button></form>
          <form action={cambiarCita}><input type="hidden" name="id" value={c.id} /><input type="hidden" name="que" value="no_hecha" /><button className={BOTON_CHICO}>No</button></form>
        </span>
      ) : null}
    </div>
  );
}

function ListaTareas({ tareas, dia, hoy, despues = false }: { tareas: Tarea[]; dia: string; hoy: string; despues?: boolean }) {
  if (!tareas.length) return <p className="mt-2 text-[0.9375rem] text-secundario">{despues ? "Nada para después." : "Sin tareas."}</p>;
  return (
    <ul className="flex flex-col">
      {tareas.map((t) => (
        <li key={t.id} className="flex items-start gap-2 border-b border-linea py-2 last:border-b-0">
          <form action={cambiarTarea}>
            <input type="hidden" name="id" value={t.id} />
            <input type="hidden" name="que" value={t.hecha_en ? "pendiente" : "hecha"} />
            <button aria-label={t.hecha_en ? "Marcar como pendiente" : "Marcar como hecha"}
              className={`flex h-6 w-6 items-center justify-center rounded-sm border-2 text-[0.875rem] ${t.hecha_en ? "border-primario bg-primario text-sobre-primario" : "border-borde-campo bg-fondo"}`}>
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
