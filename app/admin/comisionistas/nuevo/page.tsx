import { PantallaAdmin } from "@/components/pantalla-admin";
import { exigirRol } from "@/lib/sesion";
import { tratosDeLaOrg } from "@/lib/tratos";
import { crearClienteServidor, oExplota } from "@/lib/supabase/server";
import FormularioAlta from "./formulario-alta";

export const metadata = { title: "Alta de comisionista — Tasa" };

export default async function NuevoComisionista() {
  const persona = await exigirRol("admin_org");
  const tratos = await tratosDeLaOrg(persona.organizacion.id);
  const supabase = await crearClienteServidor();
  const filas =
    oExplota(
      await supabase
        .from("comisionistas")
        .select("persona_id, slug, personas!comisionistas_persona_id_fkey(nombre)")
        .returns<{ persona_id: string; slug: string; personas: { nombre: string } | null }[]>(),
      "los comisionistas"
    ) ?? [];

  return (
    <PantallaAdmin titulo="Alta de comisionista" volver={{ href: "/admin/comisionistas", texto: "Comisionistas" }}>
      <p className="mt-2 text-[0.9375rem] leading-6 text-secundario">
        Con el alta ya puede entrar: escribe su correo en la pantalla de acceso y le llega el código.
      </p>
      <FormularioAlta
        carpetaCsf={`${persona.organizacion.id}/directa`}
        tratos={tratos}
        puedeCambiarMeses={persona.rol === "admin_org"}
        existentes={filas
          .map((f) => ({ id: f.persona_id, nombre: f.personas?.nombre ?? "", slug: f.slug }))
          .sort((a, b) => a.nombre.localeCompare(b.nombre))}
      />
    </PantallaAdmin>
  );
}
