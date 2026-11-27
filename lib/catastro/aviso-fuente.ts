/**
 * Si la fuente catastral responde 403 o 429 a cualquier consulta del mapa, admin_org recibe al momento una alerta en Hoy
 * ("nos están limitando"), una sola abierta (0098, catastro_aviso_fuente). Al abrirse, además, un correo a XG (la cuenta
 * admin_org de XG con super_plataforma), uno al día como máximo (0099): la base dice cuándo y a quién.
 * Se registra con la sesión de quien consultó. Nunca detiene la consulta: si el aviso o el correo fallan, se ignora.
 */

export type ServicioFuente = "mapa" | "expediente" | "folio" | "mosaicos" | "parcela" | "construcciones" | "zona";

/** ¿Es un bloqueo o límite de la fuente? */
export const esBloqueo = (estado: number) => estado === 403 || estado === 429;

type Correo = { correo: string; nombre: string; slug: string; mensaje: string };

export async function avisarSiBloqueo(servicio: ServicioFuente, estado: number): Promise<void> {
  if (!esBloqueo(estado)) return;
  try {
    // Import tardío: este módulo también lo usan pruebas y scripts fuera del servidor.
    const { crearClienteServidor } = await import("@/lib/supabase/server");
    const supabase = await crearClienteServidor();
    const { data } = await supabase.rpc("catastro_aviso_fuente", { p_servicio: servicio, p_estado: estado });
    const c = data as Correo | null;
    if (c?.correo) await mandarCorreo(c);
  } catch {
    // Sin sesión o sin base: el aviso no es indispensable.
  }
}

async function mandarCorreo(c: Correo) {
  const [{ enviarCorreo }, { ligaPrivacidad, urlDelSitio }, { obtenerContacto }, { crearClienteServidor }] = await Promise.all([
    import("@/lib/correo"), import("@/lib/altas"), import("@/lib/contacto"), import("@/lib/supabase/server")]);
  const supabase = await crearClienteServidor();
  const error = await enviarCorreo({
    para: c.correo,
    asunto: "Tasa: la fuente catastral nos está limitando",
    texto: `Hola, ${c.nombre}:\n\n${c.mensaje}\n\nLa alerta está en Hoy: ${await urlDelSitio()}/admin/alertas\n\n`
      + "Este correo sale una vez al día como máximo; las siguientes respuestas así solo quedan en la alerta.",
    contacto: await obtenerContacto(),
    ligaPrivacidad: await ligaPrivacidad(supabase, c.slug),
    // XG, nunca DEMO: la base solo devuelve la cuenta de XG.
    demo: false,
  });
  if (error) console.error(`[tasa] No salió el correo de bloqueo de la fuente: ${error}`);
}
