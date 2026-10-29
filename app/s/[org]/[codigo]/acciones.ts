"use server";

import { ipResumida, urlDelSitio } from "@/lib/altas";
import { enviarCorreo } from "@/lib/correo";
import { crearClienteServidor } from "@/lib/supabase/server";
import { clienteDeServicio } from "@/lib/supabase/servicio";

export type ResultadoLiga = { error: string | null; id?: string; token?: string | null; organizacion?: string };

/** Menos que esto, y con todo lleno, no lo escribió una persona. */
const TIEMPO_MINIMO_MS = 4000;

/**
 * La solicitud de un cliente por la liga de un comisionista o del equipo. Valida, aplica los
 * anti-bots, la crea (la base pone los límites por conexión y teléfono) y avisa por correo al
 * dueño de la liga y al cliente. Los adjuntos los sube después el teléfono directo a Storage.
 */
export async function pedirPorLiga(formData: FormData): Promise<ResultadoLiga> {
  const campo = (n: string) => String(formData.get(n) ?? "").trim();

  // Campo trampa: invisible para una persona, irresistible para un bot.
  if (campo("sitio_web")) return { error: "No se pudo enviar la solicitud." };
  if (Date.now() - Number(campo("t")) < TIEMPO_MINIMO_MS) return { error: "Revisa tus datos y vuelve a enviar." };
  if (!campo("nombre")) return { error: "Escribe tu nombre." };
  if (!campo("telefono")) return { error: "Escribe tu teléfono." };
  if (formData.get("acepto") !== "on") return { error: "Para enviar la solicitud, acepta el aviso de privacidad." };

  const supabase = await crearClienteServidor();
  const { data, error } = await supabase
    .rpc("pedir_por_liga", {
      p_org: campo("org"),
      p_codigo: campo("codigo"),
      p_nombre: campo("nombre"),
      p_telefono: campo("telefono"),
      p_correo: campo("correo") || null,
      p_servicio: campo("servicio") || null,
      p_tramite: campo("que") === "tramite",
      p_direccion: campo("direccion"),
      p_inmueble_tipo: campo("inmueble_tipo") || null,
      p_clave: campo("clave") || null,
      p_comentarios: campo("comentarios") || null,
      p_aviso_version: Number(campo("aviso_version")),
      p_ip_resumen: await ipResumida(),
      p_adjuntos: Math.min(Number(campo("adjuntos")) || 0, 3),
    })
    .maybeSingle<{ solicitud: string; token: string | null; organizacion: string }>();
  // Los mensajes de la base ya están escritos para leerse.
  if (error || !data) return { error: error?.message || "No se pudo enviar la solicitud. Inténtalo otra vez." };

  await avisar(data.solicitud, campo("org"));
  return { error: null, id: data.solicitud, token: data.token, organizacion: data.organizacion };
}

/** Correos al dueño de la liga y al cliente. Nunca truena: la solicitud ya quedó. */
async function avisar(solicitud: string, org: string) {
  const servicio = clienteDeServicio();
  if (!servicio) {
    console.error("[tasa] Falta SUPABASE_SECRET_KEY: no salieron los correos de la liga de cliente.");
    return;
  }
  const { data: d } = await servicio
    .rpc("datos_aviso_liga", { p_solicitud: solicitud })
    .maybeSingle<{
      dueno_correo: string | null; dueno_nombre: string; cliente_nombre: string; cliente_correo: string | null;
      servicio: string; tramite: boolean; organizacion: string; contacto: string | null;
    }>();
  if (!d) return;
  // DEMO no manda correos; si no se pudo saber, tampoco (mejor no mandar que mandar de más).
  const { data: esDemo } = await servicio.rpc("organizacion_es_demo", { p_slug: org });
  const demo = esDemo !== false;
  const sitio = await urlDelSitio();
  const privacidad = `${sitio}/privacidad?org=${encodeURIComponent(org)}`;
  const que = d.tramite ? "el trámite" : "una cotización";

  const correos: Promise<string | null>[] = [];
  if (d.dueno_correo) {
    correos.push(
      enviarCorreo({
        para: d.dueno_correo,
        asunto: `Tu cliente ${d.cliente_nombre} pidió ${d.servicio}`,
        texto:
          `Tu cliente ${d.cliente_nombre} pidió ${que} de ${d.servicio} con tu liga.\n\n` +
          `Ya está en Tasa, en tu inicio ("Mis trabajos" o "Mis trámites"), con su teléfono. ` +
          `El seguimiento lo das tú: el cliente no tiene cuenta.\n\n${sitio}`,
        contacto: d.contacto,
        ligaPrivacidad: privacidad,
        demo,
      })
    );
  }
  if (d.cliente_correo) {
    correos.push(
      enviarCorreo({
        para: d.cliente_correo,
        asunto: "Recibimos tu solicitud",
        texto:
          `Hola, ${d.cliente_nombre}:\n\nRecibimos tu solicitud de ${que} de ${d.servicio}. ` +
          `${d.dueno_nombre} te va a contactar para darle seguimiento.\n\n${d.organizacion}`,
        contacto: d.contacto,
        ligaPrivacidad: privacidad,
        demo,
      })
    );
  }
  await Promise.all(correos);
}
