import { Icono } from "@/components/iconos-tarjeta";
import { pesos } from "@/lib/formato";

/**
 * La tarjeta digital tal como se ve: la usan la página pública /t/… y la vista previa en vivo de
 * "Mi tarjeta". Sin datos de la base: recibe solo lo que el comisionista decidió publicar (y lo que
 * su nivel permite). Leyenda fija "Asesor afiliado".
 *
 * Dos responsabilidades separadas a la vista: el bloque del despacho aliado (solicitar avalúo + la
 * nota de independencia, siempre visible) y "Mis servicios" del comisionista, que responde él.
 */

export type ServicioPropio = { id: string; titulo: string; descripcion: string | null; icono: string; enlace: string | null };
export type Inmueble = {
  id: string;
  titulo: string;
  operacion: "venta" | "renta";
  precio: number | null;
  zona: string;
  fotoUrl: string | null;
  enlace: string | null;
};
export type Redes = Partial<Record<"facebook" | "instagram" | "tiktok" | "linkedin" | "sitio", string>>;

export type DatosTarjeta = {
  nombre: string;
  frase: string | null;
  telefono: string | null;
  correo: string | null;
  zona: string | null;
  fotoUrl: string | null;
  logoUrl: string | null;
  color: string | null;
  /** Servicios destacados del despacho (Socio Plus). */
  servicios: string[];
  testimonios: { cliente: string; texto: string }[];
  /** Nota de independencia (de Ajustes), con el nombre ya puesto. */
  nota: string | null;
  misServicios: ServicioPropio[];
  inmuebles: Inmueble[];
  redes: Redes;
  /** El bloque del despacho va arriba (por omisión) o abajo de "Mis servicios". */
  despachoArriba: boolean;
};

const NOMBRE_RED: Record<keyof Redes, string> = {
  facebook: "Facebook",
  instagram: "Instagram",
  tiktok: "TikTok",
  linkedin: "LinkedIn",
  sitio: "Sitio web",
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
  const primerNombre = d.nombre.split(" ")[0];
  const whatsapp = (texto: string) => `https://wa.me/52${d.telefono}?text=${encodeURIComponent(texto)}`;
  const redes = (Object.keys(NOMBRE_RED) as (keyof Redes)[]).filter((r) => d.redes[r]);

  const despacho = (
    <section className="mt-5 w-full rounded-xl border border-linea px-4 py-4 text-left">
      <h2 className="text-[0.875rem] font-bold uppercase tracking-wide text-secundario">Avalúos y valuación · despacho aliado</h2>
      <a href={ligaSolicitud} className="mt-3 flex min-h-12 items-center justify-center rounded-lg px-4 text-center font-semibold text-white"
        style={{ backgroundColor: color }}>
        Solicita tu avalúo o cotización
      </a>
      {d.nota ? <p className="mt-2 text-[0.8125rem] leading-5 text-secundario">{d.nota}</p> : null}
      {d.servicios.length > 0 ? (
        <ul className="mt-3 flex flex-wrap gap-2">
          {d.servicios.map((s) => (
            <li key={s} className="rounded-full bg-tinte px-3 py-1 text-[0.875rem]">{s}</li>
          ))}
        </ul>
      ) : null}
    </section>
  );

  const misServicios =
    d.misServicios.length > 0 ? (
      <section className="mt-5 w-full text-left">
        <h2 className="font-bold">Mis servicios</h2>
        <ul className="mt-2 flex flex-col gap-2">
          {d.misServicios.map((s) => {
            const contenido = (
              <>
                <span className="mt-0.5 shrink-0" style={{ color }}><Icono clave={s.icono} /></span>
                <span>
                  <span className="block font-semibold">{s.titulo}</span>
                  {s.descripcion ? <span className="block text-[0.9375rem] leading-6 text-secundario">{s.descripcion}</span> : null}
                </span>
              </>
            );
            return (
              <li key={s.id}>
                {s.enlace ? (
                  <a href={s.enlace} target="_blank" rel="noopener nofollow" data-clic={s.id}
                    className="flex gap-3 rounded-lg border border-linea px-3 py-3 hover:bg-alterno">{contenido}</a>
                ) : (
                  <div className="flex gap-3 rounded-lg border border-linea px-3 py-3">{contenido}</div>
                )}
              </li>
            );
          })}
        </ul>
        <p className="mt-2 text-[0.8125rem] leading-5 text-secundario">Servicios ofrecidos directamente por {d.nombre}.</p>
      </section>
    ) : null;

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
          {d.telefono ? (
            <a href={whatsapp(`Hola, ${primerNombre}. Vi tu tarjeta y me interesa un avalúo.`)} target="_blank" rel="noopener" data-evento="whatsapp"
              className="flex min-h-12 items-center justify-center rounded-lg border border-primario px-4 font-semibold text-primario">
              Escríbeme por WhatsApp
            </a>
          ) : null}
          <div className={`grid gap-2 ${vcardHref && d.correo ? "grid-cols-2" : "grid-cols-1"}`}>
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
          {redes.length > 0 ? (
            <ul className="mt-1 flex justify-center gap-2">
              {redes.map((r) => (
                <li key={r}>
                  <a href={d.redes[r]} target="_blank" rel="noopener nofollow" aria-label={NOMBRE_RED[r]} title={NOMBRE_RED[r]}
                    className="flex size-12 items-center justify-center rounded-full border border-linea text-primario hover:bg-alterno">
                    <Icono clave={r} />
                  </a>
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        {d.despachoArriba ? despacho : null}
        {misServicios}
        {d.despachoArriba ? null : despacho}

        {d.inmuebles.length > 0 ? (
          <section className="mt-5 w-full text-left">
            <h2 className="font-bold">Portafolio</h2>
            <ul className="mt-2 flex flex-col gap-3">
              {d.inmuebles.map((i) => (
                <li key={i.id} className="overflow-hidden rounded-xl border border-linea">
                  {i.fotoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element -- imagen pública del bucket de tarjetas
                    <img src={i.fotoUrl} alt={i.titulo} className="aspect-[4/3] w-full object-cover" loading="lazy" />
                  ) : null}
                  <div className="px-3 py-3">
                    <p className="text-[0.8125rem] font-semibold uppercase tracking-wide text-secundario">
                      {i.operacion === "venta" ? "En venta" : "En renta"} · {i.zona}
                    </p>
                    <p className="mt-1 font-semibold">{i.titulo}</p>
                    {i.precio ? (
                      <p className="text-[1.0625rem] font-bold" style={{ color }}>
                        {pesos(i.precio)}{i.operacion === "renta" ? " al mes" : ""}
                      </p>
                    ) : null}
                    <div className="mt-2 flex flex-wrap gap-2">
                      {d.telefono ? (
                        <a href={whatsapp(`Hola, ${primerNombre}. Me interesa: ${i.titulo} (${i.zona}).`)} target="_blank" rel="noopener"
                          data-clic={i.id} className="flex min-h-11 items-center rounded-lg px-4 font-semibold text-white" style={{ backgroundColor: color }}>
                          Me interesa
                        </a>
                      ) : null}
                      {i.enlace ? (
                        <a href={i.enlace} target="_blank" rel="noopener nofollow" data-clic={i.id}
                          className="flex min-h-11 items-center rounded-lg border border-linea px-4 font-semibold">
                          Ver más
                        </a>
                      ) : null}
                    </div>
                  </div>
                </li>
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
