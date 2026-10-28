import { esCorreo } from "@/lib/textos-alta";

/**
 * Correos de Tasa por la API de Resend, con `fetch` (sin librería).
 * La llave (`RESEND_API_KEY`) solo existe en el servidor.
 *
 * Nunca truena: regresa el error en palabras para que la pantalla lo
 * diga y quede el respaldo de WhatsApp. Un correo que no salió no
 * deshace una aprobación.
 */

const REMITENTE = "Tasa <no-reply@xgplataform.com>";

export async function enviarCorreo({
  para,
  asunto,
  texto,
  contacto,
  ligaPrivacidad,
}: {
  para: string;
  asunto: string;
  texto: string;
  /** El contacto de soporte: si es un correo, va de Reply-To. */
  contacto: string | null;
  ligaPrivacidad: string;
}): Promise<string | null> {
  const llave = process.env.RESEND_API_KEY;
  if (!llave) return "El servidor no tiene la llave de correos (RESEND_API_KEY).";

  try {
    const respuesta = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${llave}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: REMITENTE,
        to: [para],
        subject: asunto,
        text: `${texto}\n\n—\nAviso de privacidad: ${ligaPrivacidad}`,
        ...(esCorreo(contacto) ? { reply_to: contacto!.trim() } : {}),
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (respuesta.ok) return null;
    const cuerpo = (await respuesta.json().catch(() => null)) as { message?: string } | null;
    console.error(`[tasa] Resend respondió ${respuesta.status}: ${cuerpo?.message ?? "sin detalle"}`);
    return `El servicio de correo respondió ${respuesta.status}${cuerpo?.message ? `: ${cuerpo.message}` : ""}.`;
  } catch (falla) {
    console.error(`[tasa] No se pudo llamar a Resend: ${falla instanceof Error ? falla.message : String(falla)}`);
    return "No se pudo conectar con el servicio de correo.";
  }
}
