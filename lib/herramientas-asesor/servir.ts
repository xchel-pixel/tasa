import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NextResponse } from "next/server";
import { misHerramientas } from "@/lib/herramientas";
import { obtenerSesion } from "@/lib/sesion";
import { crearClienteServidor, verComoId } from "@/lib/supabase/server";
import { ARCHIVO, cspHerramienta, prepararHerramienta, type ClaveHerramientaAsesor, type ServiciosMgp } from "./preparar";

/** La liga de cada herramienta (/herramientas/ficha-captacion y /h/ficha-captacion) → su clave en el catálogo. */
export const POR_LIGA: Record<string, ClaveHerramientaAsesor> = {
  "ficha-captacion": "ficha_captacion",
  "checklist-documentos": "checklist_documentos",
  "contrato-arrendamiento": "contrato_arrendamiento",
  "acta-entrega": "acta_entrega",
};

/** Los servicios del botón "Solicitar a MGP", por su nombre en Notion (0100). */
const NOTION_MGP: Record<keyof ServiciosMgp, string> = {
  clg: "Certificado de Libertad de Gravamen",
  renta: "Justipreciación de Rentas",
  regimen: "Régimen en Condominio",
  ov: "Opinión de Valor",
};

const fechaLarga = (iso: string) =>
  new Intl.DateTimeFormat("es-MX", { timeZone: "UTC", day: "numeric", month: "long", year: "numeric" }).format(new Date(`${iso}T12:00:00Z`));

function texto(t: string, status: number) {
  return new NextResponse(t, { status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "private, no-store" } });
}

/**
 * La herramienta, lista para la persona: solo con sesión y si la tiene en el catálogo (rol y nivel). Se registra que la
 * abrió (eventos_uso). Lo que se le pasa sale de la base con su sesión: sus datos de asesor, los del trabajo (si abrió
 * desde uno y es suyo) y los servicios de su organización. Nada se guarda: lo que captura vive en su navegador.
 */
export async function servirHerramienta(liga: string, trabajo: string | null): Promise<NextResponse> {
  const clave = POR_LIGA[liga];
  if (!clave) return texto("Esa herramienta no existe.", 404);
  const sesion = await obtenerSesion();
  const persona = sesion?.persona;
  if (!persona) return texto("Inicia sesión para usar las herramientas.", 401);
  const mias = await misHerramientas();
  if (!mias.some((h) => h.clave === clave)) return texto("Esa herramienta no está disponible para ti.", 403);

  const supabase = await crearClienteServidor();
  const [datos, servicios, ajustes, solicitud] = await Promise.all([
    supabase.from("personas").select("nombre, correo, telefono").eq("id", persona.id).maybeSingle<{ nombre: string; correo: string; telefono: string | null }>(),
    persona.rol === "comisionista"
      ? supabase.from("servicios").select("id, nombre_notion").eq("activo", true).returns<{ id: string; nombre_notion: string | null }[]>()
      : Promise.resolve({ data: null }),
    clave === "checklist_documentos" ? supabase.from("ajustes").select("checklist_revisado").maybeSingle<{ checklist_revisado: string }>() : Promise.resolve({ data: null }),
    trabajo && /^[0-9a-f-]{36}$/.test(trabajo)
      ? supabase.from("solicitudes").select("folio, inmueble_direccion, inmueble_municipio, inmueble_clave_catastral").eq("id", trabajo)
          .maybeSingle<{ folio: string | null; inmueble_direccion: string | null; inmueble_municipio: string | null; inmueble_clave_catastral: string | null }>()
      : Promise.resolve({ data: null }),
  ]);

  const d = datos.data;
  const s = solicitud.data;
  const prellenar: Record<string, string> = {};
  if (s) {
    if (clave === "ficha_captacion") Object.assign(prellenar, { cat: s.inmueble_clave_catastral ?? "", calle: s.inmueble_direccion ?? "", mun: s.inmueble_municipio ?? "" });
    if (clave === "checklist_documentos") prellenar.exp = [s.folio, s.inmueble_direccion].filter(Boolean).join(" · ");
  }
  const solicitar: ServiciosMgp | null = servicios.data
    ? Object.fromEntries(Object.entries(NOTION_MGP)
      .map(([k, n]) => [k, servicios.data!.find((x) => x.nombre_notion === n)?.id])
      .filter(([, id]) => id)) as ServiciosMgp
    : null;

  let original: string;
  try {
    original = readFileSync(join(process.cwd(), "assets", "herramientas", ARCHIVO[clave]), "utf8");
  } catch {
    return texto("No se pudo abrir la herramienta.", 500);
  }
  const nonce = randomBytes(16).toString("base64");
  let html: string;
  try {
    html = prepararHerramienta(original, {
      nonce, herramienta: clave,
      asesor: d ? { nombre: d.nombre, empresa: "", telefono: (d.telefono ?? "").replace(/[^0-9]/g, "").slice(-10), correo: d.correo, logo: null } : null,
      prellenar: Object.values(prellenar).some(Boolean) ? prellenar : null,
      catastro: mias.some((h) => h.clave === "mapa_catastral"),
      solicitar: solicitar && Object.keys(solicitar).length ? solicitar : null,
      revisado: ajustes.data?.checklist_revisado ? fechaLarga(ajustes.data.checklist_revisado) : null,
    });
  } catch (e) {
    console.error(`[tasa] ${e instanceof Error ? e.message : "Herramienta"} (${clave})`);
    return texto("La herramienta no está lista. Avísale a administración.", 500);
  }
  // "Ver como" (0080) no deja huella de uso.
  if (!(await verComoId())) await supabase.rpc("registrar_uso_herramienta", { p_clave: clave, p_evento: "acceso" });
  return new NextResponse(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": cspHerramienta(nonce),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "same-origin",
    },
  });
}
