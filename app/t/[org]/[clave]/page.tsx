import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { TarjetaVista, urlImagenTarjeta } from "@/components/tarjeta-vista";
import { Contador } from "./contador";
import { leerTarjeta } from "./datos";

type Props = { params: Promise<{ org: string; clave: string }> };

/** Vista previa al pegar la liga en WhatsApp: nombre, frase y foto (imagen pública). */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { org, clave } = await params;
  const t = await leerTarjeta(org, clave);
  if (!t || !t.disponible) return { title: "Tarjeta no disponible", robots: { index: false } };
  const titulo = `${t.nombre} · Asesor afiliado`;
  const descripcion = t.frase ?? `Solicita tu avalúo o cotización con ${t.nombre}.`;
  const foto = urlImagenTarjeta(t.foto);
  return {
    title: titulo,
    description: descripcion,
    openGraph: { title: titulo, description: descripcion, type: "profile", ...(foto ? { images: [{ url: foto, width: 512, height: 512 }] } : {}) },
    twitter: { card: "summary", title: titulo, description: descripcion, ...(foto ? { images: [foto] } : {}) },
  };
}

/**
 * La tarjeta digital pública del comisionista. Solo muestra lo que él decidió publicar y lo que su
 * nivel del mes permite. El botón principal abre su liga de clientes (ya atribuida a él).
 */
export default async function Tarjeta({ params }: Props) {
  const { org, clave } = await params;
  const t = await leerTarjeta(org, clave);
  if (!t) notFound();

  if (!t.disponible) {
    return (
      <main className="flex flex-1 flex-col px-6 py-16">
        <div className="mx-auto w-full max-w-sm text-center">
          <h1 className="text-[1.5rem] font-bold tracking-tight">Esta tarjeta no está disponible</h1>
          <p className="mt-2 leading-7 text-secundario">Comunícate con {t.organizacion}.</p>
        </div>
      </main>
    );
  }

  return (
    <main className="flex flex-1 flex-col px-4 py-6">
      <div className="mx-auto w-full max-w-sm">
        <TarjetaVista
          d={{
            nombre: t.nombre,
            frase: t.frase,
            telefono: t.telefono,
            correo: t.correo,
            zona: t.zona,
            fotoUrl: urlImagenTarjeta(t.foto),
            logoUrl: urlImagenTarjeta(t.logo),
            color: t.color,
            servicios: t.servicios,
            testimonios: t.testimonios,
          }}
          ligaSolicitud={`/s/${t.org}/${t.codigo}`}
          vcardHref={`/t/${t.org}/${t.slug}/vcard`}
          ligaPrivacidad={`/privacidad?org=${t.org}`}
        />
        <Contador org={t.org} clave={t.slug} />
      </div>
    </main>
  );
}
