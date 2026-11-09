import Link from "next/link";
import type { ReactNode } from "react";
import { Marca } from "@/components/marca";
import { obtenerContacto } from "@/lib/contacto";
import { crearClienteServidor } from "@/lib/supabase/server";

/**
 * La bienvenida sin sesión: qué es Tasa para un aliado comercial, sus beneficios y herramientas, cómo funciona,
 * y "Entrar" / "Solicitar unirme". Sin porcentajes ni montos, sin nombres de personas ni de las marcas de
 * valuación, y sin mencionar herramientas que dependen de fuentes de gobierno: eso se ve ya dentro.
 * El contacto sale de Ajustes (contacto_soporte); vacío, no se muestra.
 */

/** Íconos de trazo, del color del texto que los rodea (sin colores sueltos). */
function Icono({ children }: { children: ReactNode }) {
  return (
    <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-tinte text-primario" aria-hidden>
      <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        {children}
      </svg>
    </span>
  );
}

const BENEFICIOS = [
  { texto: "Comisiones que crecen con tu nivel, pagadas cada mes",
    icono: <><path d="M3 17l6-6 4 4 8-8" /><path d="M14 7h7v7" /></> },
  { texto: "Seguimiento de cada trámite: aceptada, en elaboración, en revisión, entregado",
    icono: <><path d="M9 11l3 3 8-8" /><path d="M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9" /></> },
  { texto: "Bonos por invitar a otros aliados",
    icono: <><circle cx="9" cy="8" r="3" /><path d="M3 20a6 6 0 0 1 12 0" /><path d="M19 8v6M16 11h6" /></> },
];

const HERRAMIENTAS = [
  { titulo: "Calculadora de gastos de traslado", detalle: "Querétaro",
    icono: <><rect x="5" y="3" width="14" height="18" rx="2" /><path d="M9 7h6M9 12h.01M12 12h.01M15 12h.01M9 16h.01M12 16h.01M15 16h.01" /></> },
  { titulo: "Tarjeta digital", detalle: "Para compartir tus servicios",
    icono: <><rect x="3" y="5" width="18" height="14" rx="2" /><circle cx="9" cy="11" r="2" /><path d="M6 16a3 3 0 0 1 6 0M15 10h3M15 13h3" /></> },
  { titulo: "Liga y QR", detalle: "Para que tus clientes te pidan directo",
    icono: <><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /><path d="M14 14h3v3M21 14v7h-7" /></> },
  { titulo: "Y más herramientas", detalle: "Para tu día a día",
    icono: <><path d="M12 5v14M5 12h14" /></> },
];

const PASOS = [
  { titulo: "Solicita unirte", texto: "Llena tu solicitud desde el celular." },
  { titulo: "Te damos acceso", texto: "Administración la revisa y te avisa por correo." },
  { titulo: "Pide, da seguimiento y cobra", texto: "Pide cotizaciones y trámites, ve en qué va cada uno y recibe tus comisiones." },
];

export async function PortadaPublica() {
  const supabase = await crearClienteServidor();
  const [{ data }, contacto] = await Promise.all([supabase.rpc("organizaciones_con_alta"), obtenerContacto()]);
  const orgs = (data ?? []) as { slug: string; nombre: string }[];

  return (
    <main className="flex flex-1 flex-col px-6 py-10">
      <div className="mx-auto w-full max-w-md md:max-w-3xl">
        <Marca alto={56} prioridad />
        <h1 className="mt-8 text-[1.75rem] font-bold leading-tight tracking-tight md:text-[2.25rem]">
          Tasa — la plataforma para aliados comerciales en valuación inmobiliaria
        </h1>
        <p className="mt-3 text-[1.0625rem] leading-7 text-secundario">
          Pide cotizaciones y trámites, sigue su avance y cobra tus comisiones, todo en un solo lugar.
        </p>

        <div className="mt-6 flex flex-col gap-3 md:max-w-sm">
          <Link href="/entrar" className="flex min-h-12 items-center justify-center rounded-lg bg-primario px-4 font-semibold text-sobre-primario">
            Entrar
          </Link>
          {orgs.length === 1 ? (
            <Link href={`/alta/${orgs[0].slug}`} className="flex min-h-12 items-center justify-center rounded-lg border border-primario px-4 font-semibold text-primario">
              Solicitar unirme
            </Link>
          ) : null}
        </div>
        {orgs.length > 1 ? (
          <section className="mt-6">
            <h2 className="font-bold">Solicitar unirme a…</h2>
            <ul className="mt-2 flex flex-col gap-2">
              {orgs.map((o) => (
                <li key={o.slug}>
                  <Link href={`/alta/${o.slug}`} className="block rounded-xl border border-linea bg-alterno px-4 py-3 font-semibold">{o.nombre}</Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section className="mt-12" aria-labelledby="beneficios">
          <h2 id="beneficios" className="text-[1.25rem] font-bold">Beneficios</h2>
          <ul className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
            {BENEFICIOS.map((b) => (
              <li key={b.texto} className="flex gap-3 rounded-xl border border-linea bg-alterno px-4 py-4 md:flex-col">
                <Icono>{b.icono}</Icono>
                <span className="font-semibold leading-6">{b.texto}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="mt-12" aria-labelledby="herramientas">
          <h2 id="herramientas" className="text-[1.25rem] font-bold">Herramientas</h2>
          <ul className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {HERRAMIENTAS.map((h) => (
              <li key={h.titulo} className="flex gap-3 rounded-xl border border-linea bg-alterno px-4 py-4">
                <Icono>{h.icono}</Icono>
                <span>
                  <span className="block font-semibold">{h.titulo}</span>
                  <span className="block text-[0.9375rem] leading-6 text-secundario">{h.detalle}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section className="mt-12" aria-labelledby="como-funciona">
          <h2 id="como-funciona" className="text-[1.25rem] font-bold">Cómo funciona</h2>
          <ol className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
            {PASOS.map((p, i) => (
              <li key={p.titulo} className="flex gap-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primario font-bold text-sobre-primario">{i + 1}</span>
                <span>
                  <span className="block font-semibold">{p.titulo}</span>
                  <span className="block text-[0.9375rem] leading-6 text-secundario">{p.texto}</span>
                </span>
              </li>
            ))}
          </ol>
        </section>

        <footer className="mt-14 border-t border-linea pt-6 text-[0.875rem] leading-6 text-secundario">
          <p>
            Como aliado comercial promueves el servicio mediante una alianza comercial; no formas parte del despacho ni respondes
            por los avalúos.
          </p>
          <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
            {contacto ? (
              <a href={contacto.includes("@") ? `mailto:${contacto}` : undefined} className="font-semibold text-acento underline underline-offset-4">
                {contacto}
              </a>
            ) : null}
            <Link href="/privacidad" className="font-semibold text-acento underline underline-offset-4">Aviso de privacidad</Link>
          </p>
        </footer>
      </div>
    </main>
  );
}
