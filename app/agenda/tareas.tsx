"use client";

import { createContext, useContext, useEffect, useState, useTransition, type ReactNode } from "react";
import type { Tarea } from "@/lib/agenda";
import { cambiarTarea } from "./acciones";

/**
 * Tareas de la agenda (0093): la casilla solo palomea (en cualquier lista) y el × marca la tarea como eliminada.
 * Después de palomear o borrar sale un aviso abajo con "Deshacer" durante 8 segundos.
 */

type Aviso = { texto: string; deshacer: () => Promise<unknown>; n: number };
const Avisar = createContext<(texto: string, deshacer: () => Promise<unknown>) => void>(() => {});
const SEGUNDOS = 8;

export function AvisosDeshacer({ children }: { children: ReactNode }) {
  const [aviso, setAviso] = useState<Aviso | null>(null);
  const [, iniciar] = useTransition();
  useEffect(() => {
    if (!aviso) return;
    const t = setTimeout(() => setAviso((a) => (a?.n === aviso.n ? null : a)), SEGUNDOS * 1000);
    return () => clearTimeout(t);
  }, [aviso]);
  const avisar = (texto: string, deshacer: () => Promise<unknown>) => setAviso({ texto, deshacer, n: Date.now() });
  return (
    <Avisar.Provider value={avisar}>
      {children}
      {aviso ? (
        <div role="status" className="fixed inset-x-4 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-50 mx-auto flex max-w-md items-center justify-between gap-3 rounded-xl bg-texto px-4 py-2 text-fondo shadow-lg md:bottom-6">
          <span className="text-[0.9375rem]">{aviso.texto}</span>
          <button type="button" className="min-h-11 px-2 text-[0.9375rem] font-bold underline underline-offset-4"
            onClick={() => {
              const d = aviso.deshacer;
              setAviso(null);
              iniciar(async () => { await d(); });
            }}>
            Deshacer
          </button>
        </div>
      ) : null}
    </Avisar.Provider>
  );
}

function datos(id: string, que: string, dia?: string): FormData {
  const f = new FormData();
  f.set("id", id);
  f.set("que", que);
  if (dia) f.set("dia", dia);
  return f;
}

const ENLACE = "text-[0.8125rem] font-semibold text-acento underline underline-offset-4";

export function FilaTarea({ t, dia, hoy, despues = false }: { t: Tarea; dia: string; hoy: string; despues?: boolean }) {
  const avisar = useContext(Avisar);
  const [ocupado, iniciar] = useTransition();
  const hecha = Boolean(t.hecha_en);

  const palomear = () => iniciar(async () => {
    if (hecha) {
      await cambiarTarea(datos(t.id, "pendiente"));
      return;
    }
    if (await cambiarTarea(datos(t.id, "hecha"))) avisar("Tarea completada", () => cambiarTarea(datos(t.id, "pendiente")));
  });
  const borrar = () => iniciar(async () => {
    if (await cambiarTarea(datos(t.id, "borrar"))) avisar("Tarea eliminada", () => cambiarTarea(datos(t.id, "restaurar")));
  });
  const mover = () => iniciar(async () => { await cambiarTarea(datos(t.id, despues ? "hoy" : "despues", dia)); });

  return (
    <li className={`flex items-center gap-1 border-b border-linea py-0.5 last:border-b-0 ${ocupado ? "opacity-60" : ""}`}>
      {/* La casilla: solo palomea. Área de toque de 44 px. */}
      <button type="button" onClick={palomear} disabled={ocupado} aria-pressed={hecha}
        aria-label={hecha ? `Marcar "${t.texto}" como pendiente` : `Marcar "${t.texto}" como hecha`}
        className="-ml-2.5 flex h-11 w-11 shrink-0 items-center justify-center">
        <span aria-hidden className={`flex h-6 w-6 items-center justify-center rounded-sm border-2 text-[0.875rem] ${
          hecha ? "border-primario bg-primario text-sobre-primario" : "border-borde-campo bg-fondo"}`}>
          {hecha ? "✓" : ""}
        </span>
      </button>
      <span className={`min-w-0 flex-1 py-2 text-[0.9375rem] ${hecha ? "text-secundario line-through" : ""}`}>
        {t.texto}
        {t.fecha && t.fecha < hoy && !hecha ? <span className="ml-1 text-[0.8125rem] text-error">(desde el {t.fecha.slice(8, 10)}/{t.fecha.slice(5, 7)})</span> : null}
      </span>
      {!hecha ? (
        <button type="button" onClick={mover} disabled={ocupado} className={`min-h-11 shrink-0 px-1 ${ENLACE}`}>
          {despues ? "A este día" : "Después"}
        </button>
      ) : null}
      {/* Borrar: aparte, con su propio cuadro de 44 px y separado de lo demás; se puede deshacer. */}
      <button type="button" onClick={borrar} disabled={ocupado} aria-label={`Eliminar "${t.texto}"`} title="Eliminar"
        className="ml-3 flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-linea text-[1.125rem] text-secundario hover:border-error hover:text-error">
        ×
      </button>
    </li>
  );
}
