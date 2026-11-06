import Link from "next/link";
import { Marca } from "@/components/marca";
import { crearClienteServidor } from "@/lib/supabase/server";

/**
 * La portada sin sesión: qué es el programa de aliados comerciales, cómo funciona y sus herramientas,
 * con "Entrar" y "Quiero ser aliado". Sin porcentajes, montos ni marcas de valuación: eso se ve ya
 * dentro, con los términos aceptados.
 */
export async function PortadaPublica() {
  const supabase = await crearClienteServidor();
  const { data } = await supabase.rpc("organizaciones_con_alta");
  const orgs = (data ?? []) as { slug: string; nombre: string }[];

  const pasos = [
    { titulo: "Refieres", texto: "Compartes tu liga o pides la cotización para tu cliente desde tu celular." },
    { titulo: "Se cotiza y se atiende", texto: "El despacho aliado cotiza, hace el trabajo y lo entrega a tu cliente." },
    { titulo: "Das seguimiento", texto: "Ves en qué va cada trámite de tus clientes y tu estado de cuenta, desde tu celular." },
  ];
  const herramientas = [
    { titulo: "Tu tarjeta digital", texto: "Una página para compartir con tus servicios y tus inmuebles." },
    { titulo: "Calculadora de traslado (próximamente)", texto: "Estima los gastos de escrituración en Querétaro para comprador y vendedor." },
    { titulo: "Seguimiento en línea", texto: "Ves en qué va cada trámite de tus clientes, sin llamar." },
  ];

  return (
    <main className="flex flex-1 flex-col px-6 py-10">
      <div className="mx-auto w-full max-w-md">
        <Marca alto={56} prioridad />
        <h1 className="mt-8 text-[1.75rem] font-bold leading-tight tracking-tight">Programa de aliados comerciales</h1>
        <p className="mt-3 leading-7 text-secundario">
          Si tienes clientes que compran, venden o heredan un inmueble, recomiéndales un despacho de valuación serio y usa las
          herramientas que Tasa tiene para ti. Tú refieres; el despacho cotiza, hace el trabajo y responde por él.
        </p>

        <div className="mt-6 flex flex-col gap-3">
          {orgs.length === 1 ? (
            <Link href={`/alta/${orgs[0].slug}`} className="flex min-h-12 items-center justify-center rounded-lg bg-primario px-4 font-semibold text-sobre-primario">
              Quiero ser aliado
            </Link>
          ) : null}
          <Link href="/entrar" className="flex min-h-12 items-center justify-center rounded-lg border border-primario px-4 font-semibold text-primario">
            Entrar
          </Link>
        </div>
        {orgs.length > 1 ? (
          <section className="mt-6">
            <h2 className="font-bold">Quiero ser aliado de…</h2>
            <ul className="mt-2 flex flex-col gap-2">
              {orgs.map((o) => (
                <li key={o.slug}>
                  <Link href={`/alta/${o.slug}`} className="block rounded-xl border border-linea bg-alterno px-4 py-3 font-semibold">{o.nombre}</Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section className="mt-10">
          <h2 className="text-[1.125rem] font-bold">Cómo funciona</h2>
          <ol className="mt-3 flex flex-col gap-3">
            {pasos.map((p, i) => (
              <li key={p.titulo} className="flex gap-3">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-tinte font-bold text-primario">{i + 1}</span>
                <span>
                  <span className="block font-semibold">{p.titulo}</span>
                  <span className="block text-[0.9375rem] leading-6 text-secundario">{p.texto}</span>
                </span>
              </li>
            ))}
          </ol>
        </section>

        <section className="mt-10">
          <h2 className="text-[1.125rem] font-bold">Tus herramientas</h2>
          <ul className="mt-3 grid grid-cols-1 gap-3">
            {herramientas.map((h) => (
              <li key={h.titulo} className="rounded-xl border border-linea bg-alterno px-4 py-3">
                <span className="block font-semibold">{h.titulo}</span>
                <span className="block text-[0.9375rem] leading-6 text-secundario">{h.texto}</span>
              </li>
            ))}
          </ul>
        </section>

        <p className="mt-10 text-[0.8125rem] leading-5 text-secundario">
          Como aliado comercial promueves el servicio mediante una alianza comercial; no formas parte del despacho ni respondes
          por los avalúos. <Link href="/privacidad" className="underline underline-offset-4">Aviso de privacidad</Link>
        </p>
      </div>
    </main>
  );
}
