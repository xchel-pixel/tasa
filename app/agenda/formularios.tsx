"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";
import { Aviso } from "@/components/aviso";
import { BotonEnviar } from "@/components/boton-enviar";
import { agregarTarea, guardarCita, guardarContacto, regenerarLiga, type EstadoAgenda } from "./acciones";

const INICIAL: EstadoAgenda = { error: null, mensaje: null };
const ENTRADA = "mt-1 w-full rounded-lg border border-borde-campo bg-fondo px-3 py-2 text-[1rem] focus:border-acento";
const ETIQUETA = "block text-[0.9375rem] font-semibold";

/** Escribir y Enter: tarea del día (o "para después"). Se limpia al guardar. */
export function AgregarTarea({ dia, despues = false }: { dia: string; despues?: boolean }) {
  const [estado, enviar] = useActionState(agregarTarea, INICIAL);
  const forma = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (estado.mensaje) forma.current?.reset();
  }, [estado]);
  return (
    <form ref={forma} action={enviar} className="mt-2">
      <input type="hidden" name="dia" value={dia} />
      {despues ? <input type="hidden" name="despues" value="si" /> : null}
      <label className="sr-only" htmlFor={despues ? "tarea-despues" : "tarea-hoy"}>{despues ? "Tarea para después" : "Tarea"}</label>
      <input id={despues ? "tarea-despues" : "tarea-hoy"} name="texto" maxLength={200} enterKeyHint="done" autoComplete="off"
        placeholder={despues ? "Agregar para después…" : "Agregar tarea y Enter…"} className={ENTRADA} />
      {estado.error ? <Aviso estado={estado} /> : null}
    </form>
  );
}

type CitaForma = {
  id?: string; dia: string; hora: string; hora_fin: string; titulo: string; lugar: string; clave: string; contacto_id: string;
  solicitud_id: string; alarma: string; notas: string;
};

/** Cita nueva o editada. */
export function FormaCita({ c, contactos }: { c: CitaForma; contactos: { id: string; nombre: string }[] }) {
  const [estado, enviar] = useActionState(guardarCita, INICIAL);
  return (
    <form action={enviar} className="mt-4 flex flex-col gap-3">
      {c.id ? <input type="hidden" name="id" value={c.id} /> : null}
      <input type="hidden" name="solicitud_id" value={c.solicitud_id} />
      <label className={ETIQUETA}>Qué es
        <input name="titulo" required maxLength={120} defaultValue={c.titulo} className={ENTRADA} placeholder="Visita, llamada, firma…" />
      </label>
      <div className="grid grid-cols-3 gap-2">
        <label className={ETIQUETA}>Día<input type="date" name="dia" required defaultValue={c.dia} className={ENTRADA} /></label>
        <label className={ETIQUETA}>De<input type="time" name="hora" required defaultValue={c.hora} className={ENTRADA} /></label>
        <label className={ETIQUETA}>A<input type="time" name="hora_fin" defaultValue={c.hora_fin} className={ENTRADA} /></label>
      </div>
      <label className={ETIQUETA}>Lugar<input name="lugar" maxLength={200} defaultValue={c.lugar} className={ENTRADA} /></label>
      <label className={ETIQUETA}>Clave catastral (opcional)
        <input name="clave" inputMode="numeric" maxLength={20} defaultValue={c.clave} className={ENTRADA} placeholder="15 dígitos" />
      </label>
      <label className={ETIQUETA}>Contacto
        <select name="contacto_id" defaultValue={c.contacto_id} className={ENTRADA}>
          <option value="">Sin contacto</option>
          {contactos.map((k) => <option key={k.id} value={k.id}>{k.nombre}</option>)}
        </select>
      </label>
      <label className={ETIQUETA}>Alarma
        <select name="alarma" defaultValue={c.alarma} className={ENTRADA}>
          <option value="">Sin alarma</option>
          <option value="0">A la hora</option>
          <option value="15">15 minutos antes</option>
          <option value="30">30 minutos antes</option>
          <option value="60">1 hora antes</option>
          <option value="1440">1 día antes</option>
        </select>
      </label>
      <label className={ETIQUETA}>Notas<textarea name="notas" maxLength={2000} rows={3} defaultValue={c.notas} className={ENTRADA} /></label>
      <p className="text-[0.8125rem] text-secundario">No escribas datos sensibles (salud, datos bancarios, contraseñas).</p>
      <BotonEnviar>{c.id ? "Guardar cambios" : "Agregar cita"}</BotonEnviar>
      <Aviso estado={estado} />
    </form>
  );
}

/** Contacto nuevo o editado. */
export function FormaContacto({ k }: { k: { id?: string; nombre: string; telefono: string; nota: string; seguimiento_en: string } }) {
  const [estado, enviar] = useActionState(guardarContacto, INICIAL);
  return (
    <form action={enviar} className="mt-4 flex flex-col gap-3">
      {k.id ? <input type="hidden" name="id" value={k.id} /> : null}
      <label className={ETIQUETA}>Nombre<input name="nombre" required maxLength={120} defaultValue={k.nombre} className={ENTRADA} /></label>
      <label className={ETIQUETA}>Teléfono<input name="telefono" type="tel" maxLength={30} defaultValue={k.telefono} className={ENTRADA} /></label>
      <label className={ETIQUETA}>Siguiente seguimiento<input type="date" name="seguimiento_en" defaultValue={k.seguimiento_en} className={ENTRADA} /></label>
      <label className={ETIQUETA}>Nota<textarea name="nota" maxLength={1000} rows={3} defaultValue={k.nota} className={ENTRADA} /></label>
      <p className="text-[0.8125rem] text-secundario">No escribas datos sensibles (salud, datos bancarios, contraseñas).</p>
      <BotonEnviar>{k.id ? "Guardar cambios" : "Agregar contacto"}</BotonEnviar>
      <Aviso estado={estado} />
    </form>
  );
}

/** Liga de calendario: se muestra completa solo al crearla; "Copiar" y suscribirse en Google o Apple. */
export function LigaCalendario({ activa }: { activa: boolean }) {
  const [estado, enviar] = useActionState<EstadoAgenda & { liga?: string }, FormData>(regenerarLiga, INICIAL);
  const [copiada, setCopiada] = useState(false);
  // El token solo llega después de enviar (en el navegador): ahí ya hay window.
  const liga = estado.liga ? `${window.location.origin}/api/calendario/${estado.liga}` : null;
  return (
    <div className="mt-4 flex flex-col gap-3">
      {liga ? (
        <div className="rounded-xl border border-linea bg-fondo px-4 py-3">
          <p className="text-[0.9375rem] font-semibold">{estado.mensaje}</p>
          <input readOnly value={liga} onFocus={(e) => e.currentTarget.select()} className={`${ENTRADA} text-[0.8125rem]`} aria-label="Tu liga de calendario" />
          <div className="mt-2 flex flex-wrap gap-4 text-[0.9375rem]">
            <button type="button" className="font-semibold text-acento underline underline-offset-4"
              onClick={() => navigator.clipboard?.writeText(liga).then(() => setCopiada(true), () => {})}>{copiada ? "Copiada" : "Copiar"}</button>
            <a className="font-semibold text-acento underline underline-offset-4"
              href={`https://calendar.google.com/calendar/r?cid=${encodeURIComponent(liga.replace(/^https:/, "webcal:"))}`} target="_blank" rel="noopener noreferrer">Agregar a Google Calendar</a>
            <a className="font-semibold text-acento underline underline-offset-4" href={liga.replace(/^https?:/, "webcal:")}>Agregar a Apple / Outlook</a>
          </div>
        </div>
      ) : null}
      <form action={enviar}>
        <BotonEnviar variante={activa ? "secundario" : "primario"}>{activa ? "Regenerar liga" : "Crear mi liga"}</BotonEnviar>
      </form>
      {estado.error ? <Aviso estado={estado} /> : null}
      {activa && !liga ? <p className="text-[0.8125rem] text-secundario">Al regenerarla, la anterior deja de servir en todos los calendarios donde la agregaste.</p> : null}
      <Link href="/agenda" className="text-[0.9375rem] font-semibold text-acento">← Volver a la agenda</Link>
    </div>
  );
}
