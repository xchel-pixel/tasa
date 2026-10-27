import { PantallaAdmin } from "@/components/pantalla-admin";
import { exigirRol } from "@/lib/sesion";
import { crearClienteServidor, oExplota } from "@/lib/supabase/server";
import FormularioAlta from "./formulario-alta";

export const metadata = { title: "Alta de comisionista — Tasa" };

export default async function NuevoComisionista() {
  await exigirRol("super_admin", "finanzas");
  const supabase = await crearClienteServidor();
  const filas =
    oExplota(
      await supabase
        .from("comisionistas")
        .select("persona_id, slug, personas(nombre)")
        .returns<{ persona_id: string; slug: string; personas: { nombre: string } | null }[]>(),
      "los comisionistas"
    ) ?? [];

  return (
    <PantallaAdmin titulo="Alta de comisionista" volver={{ href: "/admin/comisionistas", texto: "Comisionistas" }}>
      <p className="mt-2 text-[0.9375rem] leading-6 text-secundario">
        Con el alta ya puede entrar: escribe su correo en la pantalla de acceso y le llega el código.
      </p>
      <FormularioAlta
        existentes={filas
          .map((f) => ({ id: f.persona_id, nombre: f.personas?.nombre ?? "", slug: f.slug }))
          .sort((a, b) => a.nombre.localeCompare(b.nombre))}
      />
    </PantallaAdmin>
  );
}
