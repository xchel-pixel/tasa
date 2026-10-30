/**
 * La tarjeta digital tal como se ve: la usan la página pública /t/… y la vista previa en vivo de
 * "Mi tarjeta". Sin datos de la base: recibe solo lo que el comisionista decidió publicar (y lo que
 * su nivel permite). Leyenda fija "Asesor afiliado".
 */

export type DatosTarjeta = {
  nombre: string;
  frase: string | null;
  telefono: string | null;
  correo: string | null;
  zona: string | null;
  fotoUrl: string | null;
  logoUrl: string | null;
  color: string | null;
  servicios: string[];
  testimonios: { cliente: string; texto: string }[];
};

/** URL pública de una imagen del bucket `tarjetas`. */
export function urlImagenTarjeta(ruta: string | null): string | null {
  if (!ruta) return null;
  return `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/tarjetas/${ruta}`;
}

const iniciales = (nombre: string) =>
  nombre
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");

export function TarjetaVista({
  d,
  ligaSolicitud,
  vcardHref,
  ligaPrivacidad,
}: {
  d: DatosTarjeta;
  ligaSolicitud: string;
  vcardHref: string | null;
  ligaPrivacidad: string;
}) {
  const color = d.color ?? "#04386C";
  const mensaje = `Hola, ${d.nombre.split(" ")[0]}. Vi tu tarjeta y me interesa un avalúo.`;
  return (
    <article className="overflow-hidden rounded-2xl border border-linea bg-fondo shadow-sm">
      <div className="h-20" style={{ backgroundColor: color }} />
      <div className="-mt-12 flex flex-col items-center px-5 pb-5 text-center">
        {d.fotoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- imagen pública del bucket de tarjetas
          <img src={d.fotoUrl} alt={`Foto de ${d.nombre}`} width={96} height={96}
            className="size-24 rounded-full border-4 border-fondo object-cover" />
        ) : (
          <div className="flex size-24 items-center justify-center rounded-full border-4 border-fondo text-[1.75rem] font-bold text-white"
            style={{ backgroundColor: color }} aria-hidden="true">
            {iniciales(d.nombre)}
          </div>
        )}
        <h1 className="mt-3 text-[1.375rem] font-bold leading-tight">{d.nombre}</h1>
        <p className="mt-1 rounded-full bg-tinte px-3 py-1 text-[0.875rem] font-semibold text-primario">Asesor afiliado</p>
        {d.frase ? <p className="mt-3 leading-6">{d.frase}</p> : null}
        {d.zona ? <p className="mt-1 text-[0.9375rem] text-secundario">{d.zona}</p> : null}
        {d.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- imagen pública del bucket de tarjetas
          <img src={d.logoUrl} alt="" className="mt-3 max-h-12 max-w-[160px] object-contain" />
        ) : null}

        <div className="mt-5 flex w-full flex-col gap-2">
          <a href={ligaSolicitud} className="flex min-h-12 items-center justify-center rounded-lg px-4 font-semibold text-white"
            style={{ backgroundColor: color }}>
            Solicita tu avalúo o cotización
          </a>
          {d.telefono ? (
            <a href={`https://wa.me/52${d.telefono}?text=${encodeURIComponent(mensaje)}`} target="_blank" rel="noopener" data-evento="whatsapp"
              className="flex min-h-12 items-center justify-center rounded-lg border border-primario px-4 font-semibold text-primario">
              Escríbeme por WhatsApp
            </a>
          ) : null}
          <div className="grid grid-cols-2 gap-2">
            {vcardHref ? (
              <a href={vcardHref} className="flex min-h-12 items-center justify-center rounded-lg border border-linea px-3 text-[0.9375rem] font-semibold">
                Guardar contacto
              </a>
            ) : null}
            {d.correo ? (
              <a href={`mailto:${d.correo}`} className="flex min-h-12 items-center justify-center rounded-lg border border-linea px-3 text-[0.9375rem] font-semibold">
                Correo
              </a>
            ) : null}
          </div>
        </div>

        {d.servicios.length > 0 ? (
          <section className="mt-5 w-full text-left">
            <h2 className="font-bold">Servicios</h2>
            <ul className="mt-2 flex flex-wrap gap-2">
              {d.servicios.map((s) => (
                <li key={s} className="rounded-full bg-tinte px-3 py-1 text-[0.875rem]">{s}</li>
              ))}
            </ul>
          </section>
        ) : null}

        {d.testimonios.length > 0 ? (
          <section className="mt-5 w-full text-left">
            <h2 className="font-bold">Lo que dicen mis clientes</h2>
            <ul className="mt-2 flex flex-col gap-2">
              {d.testimonios.map((t, i) => (
                <li key={i} className="rounded-lg bg-alterno px-3 py-2 text-[0.9375rem] leading-6">
                  “{t.texto}”<span className="mt-1 block font-semibold text-secundario">— {t.cliente}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <p className="mt-5 text-[0.8125rem] text-secundario">
          <a href={ligaPrivacidad} className="underline underline-offset-4">Aviso de privacidad</a>
        </p>
      </div>
    </article>
  );
}
