"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { diasDelMes } from "./acciones";

const LLAVE = "agenda-vista";
const ES_COMPU = "(min-width: 1024px)";

/**
 * Celular: dos pantallas completas lado a lado, "Lista" (la primera, por omisión) y "Jornada"; se cambian deslizando
 * de lado o tocando el indicador. El desplazamiento se ajusta siempre a una pantalla completa (scroll-snap) y cada
 * pantalla se desplaza hacia abajo por separado. La pantalla en que se quedó se recuerda solo en esta sesión del
 * navegador (sessionStorage); al abrir de nuevo, Lista.
 * Computadora: dos columnas, la lista a la izquierda y la jornada a la derecha.
 */
export function VistaAgenda({ lista, jornada, pendientes, citas, ahoraY }: {
  lista: ReactNode; jornada: ReactNode; pendientes: number; citas: number; ahoraY: number | null;
}) {
  const carril = useRef<HTMLDivElement>(null);
  const panelJornada = useRef<HTMLDivElement>(null);
  const [vista, setVista] = useState(0);

  useEffect(() => {
    const c = carril.current;
    if (!c) return;
    // En el celular el carril ocupa lo que queda de pantalla arriba del menú fijo, para que cada pantalla se desplace sola.
    const ajustar = () => {
      if (window.matchMedia(ES_COMPU).matches) {
        c.style.height = "";
        return;
      }
      const menu = document.querySelector<HTMLElement>("[data-menu-fijo]");
      const alto = window.innerHeight - c.getBoundingClientRect().top - (menu?.offsetHeight ?? 0);
      c.style.height = `${Math.max(360, Math.floor(alto))}px`;
    };
    ajustar();
    window.addEventListener("resize", ajustar);
    let guardada: string | null = null;
    try {
      guardada = sessionStorage.getItem(LLAVE);
    } catch {
      guardada = null;
    }
    if (guardada === "jornada" && !window.matchMedia(ES_COMPU).matches) c.scrollTo({ left: c.clientWidth, behavior: "instant" });
    // La jornada abre en la hora actual (con un poco de lo anterior arriba).
    if (panelJornada.current && ahoraY !== null) panelJornada.current.scrollTop = Math.max(0, ahoraY - 96);
    return () => window.removeEventListener("resize", ajustar);
  }, [ahoraY]);

  const alDeslizar = () => {
    const c = carril.current;
    if (!c || !c.clientWidth) return;
    const v = Math.round(c.scrollLeft / c.clientWidth) ? 1 : 0;
    setVista(v);
    try {
      sessionStorage.setItem(LLAVE, v ? "jornada" : "lista");
    } catch {
      // Sin almacenamiento (modo privado): solo no se recuerda.
    }
  };

  const ir = (v: number) => carril.current?.scrollTo({ left: v * carril.current.clientWidth, behavior: "smooth" });

  return (
    <>
      <div role="group" aria-label="Pantalla de la agenda" className="mx-4 mt-3 grid grid-cols-2 rounded-lg border border-linea bg-alterno p-1 lg:hidden">
        {[`Lista · ${pendientes}`, `Jornada · ${citas}`].map((t, i) => (
          <button key={t} type="button" onClick={() => ir(i)} aria-pressed={vista === i}
            className={`min-h-10 rounded-md text-[0.9375rem] font-semibold ${vista === i ? "bg-primario text-sobre-primario" : "text-secundario"}`}>
            {t}
          </button>
        ))}
      </div>
      <div ref={carril} onScroll={alDeslizar}
        className="mt-2 flex snap-x snap-mandatory overflow-x-auto overscroll-x-contain [scrollbar-width:none] lg:mx-auto lg:mt-4 lg:grid lg:w-full lg:max-w-6xl lg:snap-none lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] lg:gap-8 lg:overflow-visible lg:px-6">
        <section aria-label="Lista" className="w-full shrink-0 snap-start snap-always overflow-y-auto overscroll-y-contain px-4 pb-6 lg:overflow-visible lg:px-0">
          {lista}
        </section>
        <section ref={panelJornada} aria-label="Jornada" className="w-full shrink-0 snap-start snap-always overflow-y-auto overscroll-y-contain px-4 pb-6 lg:overflow-visible lg:px-0">
          {jornada}
        </section>
      </div>
    </>
  );
}

const SEMANA = ["L", "M", "M", "J", "V", "S", "D"];
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

function otroMes(mes: string, n: number): string {
  const [a, m] = mes.split("-").map(Number);
  const t = a * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
}

/** El título de la fecha: al tocarlo abre el calendario del mes para saltar a cualquier día (con punto si hay citas). */
export function FechaConCalendario({ dia, hoy, titulo }: { dia: string; hoy: string; titulo: string }) {
  const [abierto, setAbierto] = useState(false);
  const [mes, setMes] = useState(dia.slice(0, 7));
  const [puntos, setPuntos] = useState<Record<string, string[]>>({});
  const [cargando, iniciar] = useTransition();

  const ver = (m: string) => {
    setMes(m);
    if (puntos[m]) return;
    iniciar(async () => {
      const dias = await diasDelMes(m);
      setPuntos((p) => ({ ...p, [m]: dias }));
    });
  };

  const [a, m] = mes.split("-").map(Number);
  const primero = (new Date(Date.UTC(a, m - 1, 1)).getUTCDay() + 6) % 7;
  const total = new Date(Date.UTC(a, m, 0)).getUTCDate();
  const conPunto = new Set(puntos[mes] ?? []);

  return (
    <div className="relative">
      <h1 className="text-center text-[1.125rem] font-bold leading-tight lg:text-[2rem]">
        <button type="button" aria-expanded={abierto} aria-label={`${titulo}: ${abierto ? "cerrar el calendario del mes" : "abrir el calendario del mes"}`}
          onClick={() => { if (!abierto) ver(dia.slice(0, 7)); setAbierto(!abierto); }}
          className="rounded-lg px-2 py-0.5 underline decoration-1 underline-offset-[6px]">
          {titulo} <span aria-hidden className="text-[0.75em]">▾</span>
        </button>
      </h1>
      {abierto ? (
        <div className="absolute left-1/2 top-full z-40 mt-2 w-[18.5rem] -translate-x-1/2 rounded-xl border border-linea bg-fondo p-3 text-texto shadow-lg">
          <div className="flex items-center justify-between">
            <button type="button" onClick={() => ver(otroMes(mes, -1))} aria-label="Mes anterior" className="min-h-11 min-w-11 text-[1.25rem]">‹</button>
            <p className="font-semibold">{MESES[m - 1].charAt(0).toUpperCase() + MESES[m - 1].slice(1)} {a}</p>
            <button type="button" onClick={() => ver(otroMes(mes, 1))} aria-label="Mes siguiente" className="min-h-11 min-w-11 text-[1.25rem]">›</button>
          </div>
          <div className="mt-1 grid grid-cols-7 text-center text-[0.75rem] text-secundario">
            {SEMANA.map((s, i) => <span key={i}>{s}</span>)}
          </div>
          <div className="mt-1 grid grid-cols-7 gap-y-1 text-center">
            {Array.from({ length: primero }, (_, i) => <span key={`v${i}`} />)}
            {Array.from({ length: total }, (_, i) => {
              const d = `${mes}-${String(i + 1).padStart(2, "0")}`;
              return (
                <Link key={d} href={`/agenda?dia=${d}`} onClick={() => setAbierto(false)} aria-current={d === dia ? "date" : undefined}
                  className={`mx-auto flex h-10 w-10 flex-col items-center justify-center rounded-full text-[0.9375rem] ${
                    d === dia ? "bg-primario text-sobre-primario" : d === hoy ? "border border-primario font-semibold text-primario" : ""}`}>
                  {i + 1}
                  <span aria-hidden className={`h-1 w-1 rounded-full ${conPunto.has(d) ? (d === dia ? "bg-sobre-primario" : "bg-acento") : "bg-transparent"}`} />
                  {conPunto.has(d) ? <span className="sr-only"> (con citas)</span> : null}
                </Link>
              );
            })}
          </div>
          <p className="mt-2 text-center text-[0.75rem] text-secundario">{cargando ? "Buscando citas…" : "• día con citas"}</p>
        </div>
      ) : null}
    </div>
  );
}
