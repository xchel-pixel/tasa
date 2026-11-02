import { ligaPrivacidad, urlDelSitio } from "@/lib/altas";
import { obtenerContacto } from "@/lib/contacto";
import { enviarCorreo } from "@/lib/correo";
import { crearClienteServidor } from "@/lib/supabase/server";

/**
 * ¿Puede la persona asignar comisionistas (admin_org, o finanzas si Ajustes lo permite)? Y, si
 * puede, los comisionistas activos de la organización para elegir. La base vuelve a revisarlo todo.
 */
export async function paraAsignar(): Promise<{ asigna: boolean; comisionistas: { id: string; nombre: string }[] }> {
  const supabase = await crearClienteServidor();
  const asigna = Boolean((await supabase.rpc("puedo_asignar")).data);
  if (!asigna) return { asigna, comisionistas: [] };
  const { data } = await supabase
    .from("membresias")
    .select("persona_id, personas(nombre:nombre_visible, activo)")
    .eq("rol", "comisionista")
    .eq("activa", true)
    .returns<{ persona_id: string; personas: { nombre: string; activo: boolean } | null }[]>();
  const comisionistas = (data ?? [])
    .filter((m) => m.personas?.activo)
    .map((m) => ({ id: m.persona_id, nombre: m.personas!.nombre }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
  return { asigna, comisionistas };
}

/** "Se te asignó el trámite {folio}": correo al comisionista del trabajo. Nunca truena: lo asignado ya quedó. */
export async function avisarAsignacion(solicitudId: string, orgSlug: string): Promise<void> {
  const supabase = await crearClienteServidor();
  const { data: s } = await supabase
    .from("solicitudes")
    .select("folio, cliente_nombre, comisionistas(personas!comisionistas_persona_id_fkey(correo, nombre:nombre_visible))")
    .eq("id", solicitudId)
    .maybeSingle<{ folio: string | null; cliente_nombre: string; comisionistas: { personas: { correo: string; nombre: string } | null } | null }>();
  const para = s?.comisionistas?.personas;
  if (!s || !para?.correo) return;
  const { data: demo } = await supabase.rpc("organizacion_es_demo", { p_slug: orgSlug });
  const que = s.folio ?? s.cliente_nombre;
  const error = await enviarCorreo({
    para: para.correo,
    asunto: `Se te asignó el trámite ${que}`,
    texto:
      `Hola, ${para.nombre}:\n\nSe te asignó el trámite ${que} (${s.cliente_nombre}). Ya lo ves en Tasa, en tu inicio.\n\n` +
      `${await urlDelSitio()}/trabajos/${solicitudId}`,
    contacto: await obtenerContacto(),
    ligaPrivacidad: await ligaPrivacidad(supabase, orgSlug),
    demo: demo !== false,
  });
  if (error) console.error(`[tasa] No salió el aviso de asignación de ${solicitudId}: ${error}`);
}
