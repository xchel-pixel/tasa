import { redirect } from "next/navigation";
import { PantallaAdmin } from "@/components/pantalla-admin";
import { paraAsignar } from "@/lib/asignar";
import { exigirRol } from "@/lib/sesion";
import { crearClienteServidor, oExplota } from "@/lib/supabase/server";
import { FormularioTraer } from "./formulario";

export const metadata = { title: "Traer trámite de Notion — Tasa" };

/**
 * Un trámite que ya está en Notion (con su folio) y nunca pasó por Tasa: se lee su página, se ve la
 * vista previa y se crea en Tasa ligado a ESA página, asignado al comisionista elegido. De ahí en
 * adelante se sincroniza como cualquier otro.
 */
export default async function TraerDeNotion() {
  await exigirRol("admin_org", "finanzas");
  const { asigna, comisionistas } = await paraAsignar();
  if (!asigna) redirect("/");

  const supabase = await crearClienteServidor();
  const [servicios, marcas, cuentas] = await Promise.all([
    supabase.from("servicios").select("id, nombre, nombre_notion").eq("activo", true).order("nombre")
      .returns<{ id: string; nombre: string; nombre_notion: string | null }[]>(),
    supabase.from("marcas").select("id, nombre, cuenta_sugerida_id").eq("activa", true).order("clave")
      .returns<{ id: string; nombre: string; cuenta_sugerida_id: string | null }[]>(),
    supabase.from("cuentas_receptoras").select("id, alias, marca_id").eq("activa", true).order("alias")
      .returns<{ id: string; alias: string; marca_id: string }[]>(),
  ]);

  return (
    <PantallaAdmin titulo="Traer trámite de Notion" volver={{ href: "/admin/tramites", texto: "Trámites" }}>
      <p className="mt-2 text-[0.9375rem] leading-6 text-secundario">
        Para un trámite que ya existe en Notion y no pasó por Tasa. No se crea otra página: el trámite queda ligado a la que ya
        tiene ese folio y, de ahí en adelante, se sincroniza normal. Los pagos que ya tenga se registran aparte, con su fecha
        real, para que la comisión caiga en el mes que corresponde.
      </p>
      <FormularioTraer
        comisionistas={comisionistas}
        servicios={oExplota(servicios, "los servicios") ?? []}
        marcas={oExplota(marcas, "las marcas") ?? []}
        cuentas={oExplota(cuentas, "las cuentas") ?? []}
      />
    </PantallaAdmin>
  );
}
