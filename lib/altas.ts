import { createHash } from "node:crypto";
import { headers } from "next/headers";
import { obtenerContacto } from "@/lib/contacto";
import { enviarCorreo } from "@/lib/correo";
import { crearClienteServidor } from "@/lib/supabase/server";
import { fechaDMA } from "@/lib/tratos";
import { llenarTexto, nivelYPorcentaje, type TextoLleno } from "@/lib/textos-alta";

type ClienteServidor = Awaited<ReturnType<typeof crearClienteServidor>>;

/** La dirección del sitio tal como la pidió el navegador (local o producción). */
export async function urlDelSitio(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "tasa.xgplataform.com";
  const protocolo = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${protocolo}://${host}`;
}

/**
 * La IP de quien manda una solicitud, resumida (hash): sirve para el
 * límite de envíos sin guardar la IP.
 */
export async function ipResumida(): Promise<string> {
  const h = await headers();
  const ip = (h.get("x-forwarded-for") ?? "").split(",")[0].trim() || h.get("x-real-ip") || "sin-ip";
  return createHash("sha256").update(`tasa-alta|${ip}`).digest("hex").slice(0, 32);
}

/**
 * /privacidad sin nada muestra el aviso de la organización principal; las
 * demás llevan `?org=`.
 */
export async function ligaPrivacidad(supabase: ClienteServidor, slug: string): Promise<string> {
  const base = `${await urlDelSitio()}/privacidad`;
  const { data } = await supabase.rpc("aviso_privacidad_publico");
  const principal = (data as { slug?: string } | null)?.slug;
  return principal === slug ? base : `${base}?org=${encodeURIComponent(slug)}`;
}

const BIENVENIDA_POR_OMISION = "Te damos la bienvenida a Tasa";
const RECHAZO_POR_OMISION = "Tu solicitud para Tasa";

/** El correo de bienvenida ya llenado, con el trato inicial que quedó en la base. */
export async function bienvenidaDe(supabase: ClienteServidor, personaId: string): Promise<TextoLleno & { para: string }> {
  const [{ data: c }, { data: a }, contacto] = await Promise.all([
    supabase
      .from("comisionistas")
      .select("trato_hasta, trato_nivel_id, personas(nombre, correo)")
      .eq("persona_id", personaId)
      .maybeSingle()
      .returns<{ trato_hasta: string | null; trato_nivel_id: string | null; personas: { nombre: string; correo: string } | null } | null>(),
    supabase.from("ajustes").select("correo_bienvenida").maybeSingle().returns<{ correo_bienvenida: string | null } | null>(),
    obtenerContacto(),
  ]);
  const { data: niveles } = await supabase
    .from("niveles")
    .select("id, nombre, porcentaje, es_forzado")
    .returns<{ id: string; nombre: string; porcentaje: number | null; es_forzado: boolean }[]>();
  const normales = (niveles ?? []).filter((n) => !n.es_forzado).sort((x, y) => Number(x.porcentaje) - Number(y.porcentaje));
  // Sin trato (la organización no usa arranque): el primer nivel.
  const nivel = normales.find((n) => n.id === c?.trato_nivel_id) ?? normales[0];
  const lleno = llenarTexto(
    a?.correo_bienvenida ?? "",
    {
      nombre: c?.personas?.nombre ?? "",
      nivel: nivel ? nivelYPorcentaje(nivel.nombre, nivel.porcentaje ?? 0) : null,
      fecha: c?.trato_nivel_id && c.trato_hasta ? fechaDMA(c.trato_hasta) : null,
      contacto,
    },
    BIENVENIDA_POR_OMISION
  );
  return { ...lleno, para: c?.personas?.correo ?? "" };
}

export async function rechazoDe(
  supabase: ClienteServidor,
  solicitud: { nombre: string; motivo: string | null }
): Promise<TextoLleno> {
  const [{ data: a }, contacto] = await Promise.all([
    supabase.from("ajustes").select("correo_rechazo").maybeSingle().returns<{ correo_rechazo: string | null } | null>(),
    obtenerContacto(),
  ]);
  return llenarTexto(a?.correo_rechazo ?? "", { nombre: solicitud.nombre, motivo: solicitud.motivo, contacto }, RECHAZO_POR_OMISION);
}

/** Manda el correo y deja en la solicitud si salió o por qué no. */
export async function mandarCorreoDeAlta(
  supabase: ClienteServidor,
  { solicitudId, para, correo, slug }: { solicitudId: string; para: string; correo: TextoLleno; slug: string }
): Promise<string | null> {
  const error = await enviarCorreo({
    para,
    asunto: correo.asunto,
    texto: correo.texto,
    contacto: await obtenerContacto(),
    ligaPrivacidad: await ligaPrivacidad(supabase, slug),
  });
  await supabase.rpc("registrar_correo_alta", { p_id: solicitudId, p_error: error });
  return error;
}
