import Link from "next/link";
import { notFound } from "next/navigation";
import { Marca } from "@/components/marca";
import { crearClienteServidor } from "@/lib/supabase/server";
import FormularioSolicitud from "./formulario-solicitud";

export const metadata = { title: "Solicitud de alta — Tasa" };

type DatosOrg = { id: string; organizacion: string; slug: string; aviso_version: number | null; contacto: string | null };

/**
 * Se ve sin sesión: aquí pide su alta quien quiere ser comisionista.
 * Desde la liga de un referidor llega con `?ref=<su liga>`.
 * `anon` no lee ninguna tabla: todo pasa por funciones de la base.
 */
export default async function SolicitudDeAlta({
  params,
  searchParams,
}: {
  params: Promise<{ org: string }>;
  searchParams: Promise<{ ref?: string }>;
}) {
  const [{ org }, { ref }] = await Promise.all([params, searchParams]);
  const supabase = await crearClienteServidor();
  const { data } = await supabase.rpc("datos_alta_publica", { p_slug: org });
  const datos = data as DatosOrg | null;
  if (!datos) notFound();
  // Un código que no sirve (o de otra organización) se ignora sin decir nada.
  const invito = ref ? ((await supabase.rpc("invitado_por", { p_org_slug: org, p_codigo: ref })).data as string | null) : null;

  const ligaAviso = `/privacidad?org=${encodeURIComponent(datos.slug)}`;

  return (
    <main className="flex flex-1 flex-col px-6 py-10">
      <div className="mx-auto w-full max-w-sm">
        <Marca alto={56} prioridad />
        <h1 className="mt-6 text-[1.5rem] font-bold tracking-tight">Solicitud de alta</h1>
        <p className="mt-1 text-[0.9375rem] leading-6 text-secundario">
          Para comisionistas de {datos.organizacion}. Revisamos tu solicitud y te escribimos a tu correo.
        </p>

        {invito ? (
          <p className="mt-4 rounded-lg bg-tinte px-4 py-3 text-[0.9375rem]">
            Te invitó: <strong>{invito}</strong>
          </p>
        ) : null}

        {datos.aviso_version ? (
          <FormularioSolicitud
            org={datos.slug}
            orgId={datos.id}
            referidor={invito ? (ref ?? "") : ""}
            avisoVersion={datos.aviso_version}
            ligaAviso={ligaAviso}
          />
        ) : (
          <p className="mt-8 rounded-lg border border-linea px-4 py-3 leading-7">
            Esta organización todavía no recibe solicitudes.
            {datos.contacto ? ` Escríbenos a ${datos.contacto}.` : ""}
          </p>
        )}

        <p className="mt-10 text-[0.9375rem] text-secundario">
          ¿Ya tienes cuenta?{" "}
          <Link href="/entrar" className="toque font-semibold text-acento underline underline-offset-4">Entrar</Link>
          {" · "}
          <Link href={ligaAviso} className="toque font-semibold text-acento underline underline-offset-4">Aviso de privacidad</Link>
        </p>
      </div>
    </main>
  );
}
