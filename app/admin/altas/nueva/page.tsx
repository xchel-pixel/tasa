import { PantallaAdmin } from "@/components/pantalla-admin";
import { exigirRol } from "@/lib/sesion";
import { crearClienteServidor, oExplota } from "@/lib/supabase/server";
import FormularioCaptura from "./formulario-captura";
import { cuentasDePrueba } from "@/lib/cuentas-prueba";

export const metadata = { title: "Capturar solicitud de alta — Tasa" };

export default async function CapturarSolicitud() {
  await exigirRol("admin_org", "finanzas");
  const supabase = await crearClienteServidor();
  const prueba = await cuentasDePrueba(supabase);
  const filas = (
    oExplota(
      await supabase
        .from("comisionistas")
        .select("persona_id, codigo_referido, personas!comisionistas_persona_id_fkey(nombre)")
        .returns<{ persona_id: string; codigo_referido: string; personas: { nombre: string } | null }[]>(),
      "los comisionistas"
    ) ?? []
  ).filter((c) => !prueba.has(c.persona_id));

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
