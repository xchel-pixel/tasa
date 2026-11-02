"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { avisarAsignacion } from "@/lib/asignar";
import { conectorNotion } from "@/lib/conectores/notion";
import type { ConfigConector, TramiteExterno } from "@/lib/conectores/tipos";
import { exigirRol } from "@/lib/sesion";
import { crearClienteServidor } from "@/lib/supabase/server";
import { clienteDeServicio } from "@/lib/supabase/servicio";

export type Busqueda = { error: string | null; folio?: string; tramite?: TramiteExterno; demo?: boolean };

const FOLIO = /^[A-Z0-9]{2,6}-\d{4}-\d{4}$/;

/**
 * Lee de Notion la página con ese folio para la vista previa. La clave de Notion se lee aquí, en el
 * servidor, con la llave de servicio y después de revisar que quien pide puede traer trámites; nunca
 * llega al navegador. En DEMO no hay Notion: se simula la lectura con datos sintéticos.
 */
export async function buscarEnNotion(_previo: Busqueda, formData: FormData): Promise<Busqueda> {
  const persona = await exigirRol("admin_org", "finanzas");
  const folio = String(formData.get("folio") ?? "").trim().toUpperCase();
  if (!FOLIO.test(folio)) return { error: "Escribe el folio completo, por ejemplo MGP-2026-0123." };

  const supabase = await crearClienteServidor();
  if (!(await supabase.rpc("puedo_asignar")).data) {
    return { error: "Solo admin_org (o finanzas, si Ajustes lo permite) trae trámites de Notion." };
  }
  const { data: yaEsta } = await supabase.from("solicitudes").select("id").eq("folio", folio).maybeSingle();
  if (yaEsta) return { error: `El folio ${folio} ya está en Tasa.`, folio };

  const { data: org } = await supabase.from("organizaciones").select("demo").eq("id", persona.organizacion.id).single<{ demo: boolean }>();
  if (org?.demo) {
    // DEMO: la "página" es sintética y su id empieza con demo- (la base solo lo acepta en DEMO).
    const numero = Number(folio.slice(-4));
    return {
      error: null,
      folio,
      demo: true,
      tramite: {
        externo_id: `demo-${folio.toLowerCase()}`,
        titulo: `${folio} – Cliente Notion ${numero}`,
        etapa: "Visita agendada",
        tipo: null,
        cotizacion: 3500 + (numero % 5) * 500,
        fecha_aceptacion: new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City" }).format(new Date(Date.now() - 20 * 864e5)),
        cliente_nombre: `Cliente Notion ${numero}`,
        cliente_telefono: "4429990000",
        cliente_correo: null,
        clave_catastral: null,
        descripcion: "Casa habitación en Querétaro (lectura simulada de DEMO)",
        requiere_factura: false,
      },
    };
  }

  const servicio = clienteDeServicio();
  if (!servicio) return { error: "Falta la llave de servicio en el servidor: no se puede leer Notion." };
  const { data: config } = await servicio
    .rpc("conector_para_importar", { p_org: persona.organizacion.id })
    .maybeSingle<{ id: string; configuracion: Record<string, string>; mapeo_campos: Record<string, string>; prefijo_folio: string }>();
  if (!config) return { error: "El conector de Notion no está activo. Actívalo en Ajustes." };
  const { data: credencial } = await servicio.rpc("credencial_conector", { p_conector: config.id });
  if (!credencial) return { error: "Falta la credencial del conector de Notion (Ajustes)." };

  try {
    const conector = conectorNotion(
      { ...config, organizacion_id: persona.organizacion.id, tipo: "notion", ultimo_sync: null } as ConfigConector,
      credencial as string
    );
    const tramite = await conector.buscarPorFolio(folio);
    if (!tramite) return { error: `No encontré el folio ${folio} en Notion.`, folio };
    const { data: ligada } = await supabase.from("solicitudes").select("folio").eq("externo_id", tramite.externo_id).maybeSingle();
    if (ligada) return { error: `Esa página de Notion ya está en Tasa (${ligada.folio ?? "sin folio"}).`, folio };
    return { error: null, folio, tramite };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "No se pudo leer Notion.", folio };
  }
}

export type EstadoTraer = { error: string | null };

/** Crea el trámite en Tasa ligado a esa página (no crea otra) y asignado al comisionista elegido. */
export async function traerTramite(_previo: EstadoTraer, formData: FormData): Promise<EstadoTraer> {
  const persona = await exigirRol("admin_org", "finanzas");
  const campo = (n: string) => String(formData.get(n) ?? "").trim();
  const honorarios = Number(campo("honorarios").replace(/[$,\s]/g, ""));
  const terceros = Number(campo("terceros").replace(/[$,\s]/g, "") || "0");
  if (!campo("comisionista")) return { error: "Elige el comisionista." };
  if (!campo("servicio") || !campo("marca") || !campo("cuenta")) return { error: "Elige servicio, marca y cuenta." };
  if (!campo("cliente_nombre") || !campo("direccion")) return { error: "Faltan el cliente o la dirección del inmueble." };
  if (!Number.isFinite(honorarios) || honorarios < 0 || !Number.isFinite(terceros) || terceros < 0) {
    return { error: "Revisa los honorarios y los terceros." };
  }
  const genera = campo("genera_comision") !== "no";

  const supabase = await crearClienteServidor();
  const { data: id, error } = await supabase.rpc("importar_tramite", {
    p_datos: {
      folio: campo("folio"),
      externo_id: campo("externo_id"),
      etapa: campo("etapa") || null,
      comisionista: campo("comisionista"),
      servicio: campo("servicio"),
      marca: campo("marca"),
      cuenta: campo("cuenta"),
      cliente_nombre: campo("cliente_nombre"),
      cliente_telefono: campo("cliente_telefono") || null,
      cliente_correo: campo("cliente_correo") || null,
      direccion: campo("direccion"),
      clave: campo("clave") || null,
      descripcion: campo("descripcion") || null,
      requiere_factura: formData.get("requiere_factura") === "on",
      honorarios,
      terceros,
      aceptada: campo("aceptada") || null,
      motivo: campo("motivo"),
      genera_comision: genera,
      sin_comision_motivo: genera ? null : campo("sin_comision_motivo"),
    },
  });
  if (error || !id) return { error: error?.message || "No se pudo traer el trámite." };

  await avisarAsignacion(id as string, persona.organizacion.slug);
  revalidatePath("/admin/tramites");
  redirect(`/trabajos/${id}`);
}
