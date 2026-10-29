import { notFound } from "next/navigation";
import { PantallaAdmin } from "@/components/pantalla-admin";
import { exigirRol, ROLES_OPERACION } from "@/lib/sesion";
import { crearClienteServidor, oExplota } from "@/lib/supabase/server";
import FormularioPrecio from "./formulario-precio";

export const metadata = { title: "Cotizar — Tasa" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Solicitud = {
  id: string;
  tipo: "cotizacion" | "tramite_directo";
  estado: string;
  marca_id: string | null;
  inmueble_direccion: string;
  inmueble_municipio: string | null;
  inmueble_clave_catastral: string | null;
  inmueble_descripcion: string | null;
  cliente_nombre: string;
  cliente_telefono: string | null;
  cliente_correo: string | null;
  servicios: { nombre: string } | null;
  comisionistas: { personas: { nombre: string } | null } | null;
};

export default async function Cotizar({ params }: PageProps<"/admin/solicitudes/[id]">) {
  await exigirRol(...ROLES_OPERACION);
  const { id } = await params;
  if (!UUID.test(id)) notFound();

  const supabase = await crearClienteServidor();
  const [sol, marcas, cuentas] = await Promise.all([
    supabase
      .from("solicitudes")
      .select(
        `id, tipo, estado, marca_id, inmueble_direccion, inmueble_municipio, inmueble_clave_catastral,
         inmueble_descripcion, cliente_nombre, cliente_telefono, cliente_correo,
         servicios(nombre), comisionistas(personas!comisionistas_persona_id_fkey(nombre))`
      )
      .eq("id", id)
      .maybeSingle()
      .returns<Solicitud | null>(),
    supabase.from("marcas").select("id, nombre, cuenta_sugerida_id").eq("activa", true).order("clave")
      .returns<{ id: string; nombre: string; cuenta_sugerida_id: string | null }[]>(),
    supabase.from("cuentas_receptoras").select("id, alias, banco, marca_id").eq("activa", true).order("alias")
      .returns<{ id: string; alias: string; banco: string | null; marca_id: string }[]>(),
  ]);

  const s = oExplota(sol, "la solicitud");
  if (!s) notFound();

  const datos: [string, string | null | undefined][] = [
    ["Comisionista", s.comisionistas?.personas?.nombre],
    ["Servicio", s.servicios?.nombre],
    ["Dirección", [s.inmueble_direccion, s.inmueble_municipio].filter(Boolean).join(", ")],
    ["Clave catastral", s.inmueble_clave_catastral],
    ["Descripción", s.inmueble_descripcion],
    ["Cliente", s.cliente_nombre],
    ["Teléfono", s.cliente_telefono],
    ["Correo", s.cliente_correo],
  ];

  const cotizable = s.estado === "solicitada" || s.estado === "vencida";

  return (
    <PantallaAdmin
      titulo={s.tipo === "tramite_directo" ? "Poner precio al trámite" : "Emitir cotización"}
      volver={{ href: "/admin/solicitudes", texto: "Solicitudes" }}
    >
      <dl className="mt-4 flex flex-col gap-2 rounded-xl bg-alterno px-4 py-3 text-[0.9375rem]">
        {datos.filter(([, v]) => v).map(([k, v]) => (
          <div key={k}>
            <dt className="text-secundario">{k}</dt>
            <dd className="font-semibold">{v}</dd>
          </div>
        ))}
      </dl>

      {cotizable ? (
        <FormularioPrecio
          solicitudId={s.id}
          tipo={s.tipo}
          marcaInicial={s.marca_id}
          marcas={oExplota(marcas, "las marcas") ?? []}
          cuentas={oExplota(cuentas, "las cuentas") ?? []}
        />
      ) : (
        <p className="mt-6 rounded-xl bg-tinte px-4 py-3">Esta solicitud ya no espera precio.</p>
      )}
    </PantallaAdmin>
  );
}
