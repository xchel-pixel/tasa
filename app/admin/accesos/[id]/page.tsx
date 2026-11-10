import Link from "next/link";
import { notFound } from "next/navigation";
import { AccesosYSesiones, HistorialPersona, ParaQueSirve } from "@/components/ficha-persona";
import { PantallaAdmin } from "@/components/pantalla-admin";
import { BotonVerComo } from "@/components/resumen-comisionista";
import { exigirRol } from "@/lib/sesion";
import { crearClienteServidor } from "@/lib/supabase/server";

export const metadata = { title: "Accesos — Tasa" };

/**
 * Accesos de una persona (0071): solo admin_org. De un comisionista, esto se mudó a su ficha (pestaña "Accesos y
 * sesiones"), que es el único lugar donde se editan sus cupos y su DXF; aquí sigue funcionando para consulta.
 */
export default async function AccesoPersona({ params }: { params: Promise<{ id: string }> }) {
  await exigirRol("admin_org");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const supabase = await crearClienteServidor();
  const { data } = await supabase.rpc("accesos_persona", { p_persona: id });
  const a = data as { persona: { nombre: string }; rol: string; activa: boolean } | null;
  if (!a) notFound();
  const comisionista = a.rol === "comisionista";

  return (
    <PantallaAdmin titulo={a.persona.nombre} volver={{ href: "/admin/accesos", texto: "Accesos" }}>
      {comisionista ? (
        <p className="mt-3 rounded-xl border border-proceso bg-proceso-fondo px-4 py-3 text-[0.9375rem] leading-6">
          Esta pantalla se mudó a la{" "}
          <Link href={`/admin/comisionistas/${id}?tab=accesos`} className="font-semibold underline underline-offset-4">ficha del comisionista, pestaña Accesos y sesiones</Link>.
          Sus cupos y su DXF se editan solo ahí.
        </p>
      ) : null}
      <ParaQueSirve>ver y cambiar cómo entra esta persona a Tasa: estatus, sesiones, equipos, cupos y DXF.</ParaQueSirve>
      <AccesosYSesiones id={id} editaCuposYDxf={!comisionista} verComo={comisionista && a.activa ? <BotonVerComo personaId={id} /> : null} />
      <HistorialPersona id={id} admin />
    </PantallaAdmin>
  );
}
