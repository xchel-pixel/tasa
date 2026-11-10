import Link from "next/link";
import { Encabezado } from "@/components/encabezado";
import { inicialSolicitudDelMapa } from "@/lib/catastro/prellenado";
import { exigirRol } from "@/lib/sesion";
import { crearClienteServidor, oExplota } from "@/lib/supabase/server";
import { prellenadoDesdeCalculo } from "@/lib/traslado/prellenado";
import { leerCalculo } from "@/lib/traslado/servidor";
import FormularioSolicitud from "./formulario-solicitud";

export const metadata = { title: "Nueva solicitud — Tasa" };

/**
 * Desde la calculadora de traslado llega con ?calculo=<id>&servicio=hacendario|comercial: el formulario sale con
 * servicio, municipio, clave y una descripción con todo lo capturado, y la solicitud queda ligada al cálculo. El
 * cálculo solo lo lee quien lo hizo (RLS). El cliente se captura aquí.
 */
export default async function NuevaSolicitud({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const q = await searchParams;
  const calculo = q.calculo && /^[0-9a-f-]{36}$/.test(q.calculo) ? await leerCalculo(q.calculo) : null;
  const pre = calculo ? prellenadoDesdeCalculo(calculo, q.servicio ?? "hacendario") : null;
  // Desde el Mapa catastral (0059): ?clave=&municipio=&nota= (sin datos del cliente).
  const delMapa = pre ? null : inicialSolicitudDelMapa(q);
  await exigirRol("comisionista");
  const supabase = await crearClienteServidor();
  const servicios =
    oExplota(
      await supabase
        .from("servicios")
        .select("id, nombre")
        .eq("activo", true)
        .order("orden")
        .returns<{ id: string; nombre: string }[]>(),
      "los servicios"
    ) ?? [];

  // Monedero (0077): con saldo vigente puede pedir que el trámite se pague con su crédito.
  const { data: paquetes } = await supabase.rpc("mis_paquetes");
  const credito = Number((paquetes as { saldo?: number | string } | null)?.saldo ?? 0);

  return (
    <>
      <Encabezado />
      <main className="flex flex-1 flex-col px-6 py-6">
        <div className="mx-auto w-full max-w-md">
          <Link href="/" className="toque text-[0.9375rem] font-semibold text-acento">
            ← Portada
          </Link>
          <h1 className="mt-2 text-[1.5rem] font-bold tracking-tight">Nueva solicitud</h1>
          <p className="mt-1 text-[0.9375rem] leading-6 text-secundario">
            Administración revisa los datos y te manda la cotización. Los montos los pone ella.
          </p>
          {pre ? (
            <p className="mt-3 rounded-xl bg-tinte px-4 py-3 text-[0.9375rem] leading-6">
              Viene de tu cálculo de traslado: ya llenamos el inmueble y los valores. Agrega la dirección y al cliente.
            </p>
          ) : delMapa ? (
            <p className="mt-3 rounded-xl bg-tinte px-4 py-3 text-[0.9375rem] leading-6">
              Viene del Mapa catastral: ya llenamos la clave, el municipio y la ubicación. Revisa la dirección y agrega el servicio y al cliente.
            </p>
          ) : null}
          <FormularioSolicitud servicios={servicios} credito={credito} inicial={delMapa ?? (pre ? {
            servicio_id: servicios.find((s) => s.nombre.toLowerCase().includes(pre.servicio))?.id,
            municipio: pre.municipio,
            clave: pre.clave,
            descripcion: pre.descripcion,
            calculo: calculo!.id,
          } : {})} />
        </div>
      </main>
    </>
  );
}
