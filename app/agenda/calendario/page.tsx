import { redirect } from "next/navigation";
import { Encabezado } from "@/components/encabezado";
import { fechaHora } from "@/lib/uso";
import { TODOS_LOS_ROLES, tengoHerramienta } from "@/lib/herramientas";
import { exigirRol } from "@/lib/sesion";
import { crearClienteServidor, verComoId } from "@/lib/supabase/server";
import { quitarLiga } from "../acciones";
import { LigaCalendario } from "../formularios";

export const metadata = { title: "Liga de calendario — Tasa" };

/** Liga privada (iCal) para ver lo de Tasa en Google, Apple u Outlook. Solo folio y municipio; sin nombres de clientes. */
export default async function Calendario() {
  await exigirRol(...TODOS_LOS_ROLES);
  if (!(await tengoHerramienta("agenda"))) redirect("/");
  if (await verComoId()) redirect("/agenda");
  const { data } = await (await crearClienteServidor()).rpc("mi_liga_calendario")
    .maybeSingle<{ creada_en: string; ultimo_uso_en: string | null }>();

  return (
    <>
      <Encabezado />
      <main className="flex flex-1 flex-col px-4 py-6">
        <div className="mx-auto w-full max-w-md">
          <h1 className="text-[1.5rem] font-bold tracking-tight">Liga de calendario</h1>
          <p className="mt-2 text-[0.9375rem] leading-6 text-secundario">
            Suscríbela en Google, Apple u Outlook para ver tus visitas, entregas, cierre, pago de comisiones y paquete. Solo lleva el
            folio y el municipio, nunca el nombre del cliente. Tus citas y tareas no van en la liga.
          </p>
          <p className="mt-3 rounded-xl bg-proceso-fondo px-4 py-3 text-[0.9375rem] font-semibold leading-6 text-proceso">
            Las alarmas y cambios de último momento míralos en la Agenda de Tasa.
          </p>
          <p className="mt-2 text-[0.8125rem] leading-5 text-secundario">
            Google y Outlook actualizan la liga cada varias horas y no respetan sus alarmas; el iPhone las quita salvo que desactives
            &quot;Quitar alertas&quot; al suscribirte.
          </p>
          {data ? (
            <p className="mt-3 text-[0.9375rem]">
              Tienes una liga activa desde el {fechaHora(data.creada_en)}.{" "}
              {data.ultimo_uso_en ? `Tu calendario la leyó por última vez el ${fechaHora(data.ultimo_uso_en)}.` : "Todavía no la ha leído ningún calendario."}
            </p>
          ) : null}
          <LigaCalendario activa={Boolean(data)} />
          {data ? (
            <form action={quitarLiga} className="mt-4">
              <button className="text-[0.9375rem] font-semibold text-error underline underline-offset-4">Desactivar la liga</button>
            </form>
          ) : null}
        </div>
      </main>
    </>
  );
}
