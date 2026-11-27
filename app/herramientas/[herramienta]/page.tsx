import { redirect } from "next/navigation";
import { Encabezado } from "@/components/encabezado";
import { misHerramientas, TODOS_LOS_ROLES } from "@/lib/herramientas";
import { POR_LIGA } from "@/lib/herramientas-asesor/servir";
import { exigirRol } from "@/lib/sesion";
import { MarcoHerramienta } from "./marco";

const BAJADA: Record<string, string> = {
  ficha_captacion: "Ficha comercial con QR a tu WhatsApp, ficha interna y texto para portales. Lo que capturas se queda en este equipo.",
  checklist_documentos: "Los documentos según la operación y el crédito, mensajes para pedirlos y PDF. Lo que capturas se queda en este equipo.",
  contrato_arrendamiento: "Contrato para Querétaro con inventario y anexo de INE, en PDF. Lo que capturas se queda en este equipo.",
  acta_entrega: "Entrega o devolución del inmueble, con fotos y depósito. Lo que capturas se queda en este equipo.",
};

export const metadata = { title: "Herramienta — Tasa" };

/** Una herramienta de asesor (0100) dentro de Tasa. Si la persona no la tiene en el catálogo, regresa al inicio. */
export default async function Herramienta({ params, searchParams }: {
  params: Promise<{ herramienta: string }>; searchParams: Promise<Record<string, string | undefined>>;
}) {
  await exigirRol(...TODOS_LOS_ROLES);
  const { herramienta } = await params;
  const q = await searchParams;
  const clave = POR_LIGA[herramienta];
  const h = clave ? (await misHerramientas()).find((x) => x.clave === clave) : null;
  if (!clave || !h) redirect("/");
  const trabajo = q.trabajo && /^[0-9a-f-]{36}$/.test(q.trabajo) ? `?trabajo=${q.trabajo}` : "";
  return (
    <>
      <Encabezado />
      <main className="flex flex-1 flex-col px-4 py-6 md:px-6">
        <div className="mx-auto w-full max-w-md md:max-w-3xl">
          <h1 className="px-2 text-[1.5rem] font-bold tracking-tight">{h.nombre}</h1>
          <p className="mt-1 px-2 text-[0.9375rem] leading-6 text-secundario">{BAJADA[clave]}</p>
          <MarcoHerramienta src={`/h/${herramienta}${trabajo}`} titulo={h.nombre} />
        </div>
      </main>
    </>
  );
}
