import { PantallaAdmin } from "@/components/pantalla-admin";
import { exigirRol } from "@/lib/sesion";
import { crearClienteServidor, oExplota } from "@/lib/supabase/server";
import FormularioCaptura from "./formulario-captura";

export const metadata = { title: "Capturar solicitud de alta — Tasa" };

export default async function CapturarSolicitud() {
  await exigirRol("admin_org", "finanzas");
  const supabase = await crearClienteServidor();
  const filas =
    oExplota(
      await supabase
        .from("comisionistas")
        .select("codigo_referido, personas!comisionistas_persona_id_fkey(nombre)")
        .returns<{ codigo_referido: string; personas: { nombre: string } | null }[]>(),
      "los comisionistas"
    ) ?? [];

  return (
    <PantallaAdmin titulo="Capturar solicitud" volver={{ href: "/admin/altas", texto: "Solicitudes de alta" }}>
      <p className="mt-2 text-[0.9375rem] leading-6 text-secundario">
        Para quien te mandó sus datos por otro medio. Queda pendiente hasta que Administración la apruebe.
      </p>
      <FormularioCaptura
        existentes={filas
          .map((f) => ({ codigo: f.codigo_referido, nombre: f.personas?.nombre ?? f.codigo_referido }))
          .sort((a, b) => a.nombre.localeCompare(b.nombre))}
      />
    </PantallaAdmin>
  );
}
