"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { exigirRol } from "@/lib/sesion";
import { crearClienteServidor } from "@/lib/supabase/server";

export type EstadoConector = { error: string | null; mensaje: string | null };

const falla = (error: string): EstadoConector => ({ error, mensaje: null });
const listo = (mensaje: string): EstadoConector => {
  revalidatePath("/ajustes");
  revalidatePath("/");
  return { error: null, mensaje };
};

/** Encender el conector Notion: desde ahora, lo que se acepte se crea en Notion. */
export async function activarNotion(_previo: EstadoConector): Promise<EstadoConector> {
  await exigirRol("admin_org");
  const supabase = await crearClienteServidor();
  const { error } = await supabase.rpc("activar_conector", { p_tipo: "notion" });
  if (error) return falla(error.message || "No se pudo activar.");
  return listo("Notion activo. Lo que se acepte desde ahora se crea en Notion (máximo 15 minutos).");
}

export async function volverAManual(_previo: EstadoConector): Promise<EstadoConector> {
  await exigirRol("admin_org");
  const supabase = await crearClienteServidor();
  const { error } = await supabase.rpc("activar_conector", { p_tipo: "manual" });
  if (error) return falla(error.message || "No se pudo cambiar.");
  return listo("Conector manual activo: el estatus se mueve desde la ficha y Tasa pone los folios.");
}

/** Se cifra en Vault; no vuelve a mostrarse. */
export async function guardarCredencial(_previo: EstadoConector, formData: FormData): Promise<EstadoConector> {
  await exigirRol("admin_org");
  const valor = String(formData.get("credencial") ?? "").trim();
  if (!valor) return falla("Pega el secreto de la integración.");
  const supabase = await crearClienteServidor();
  const { error } = await supabase.rpc("guardar_credencial_conector", {
    p_conector: String(formData.get("conector") ?? ""),
    p_valor: valor,
  });
  if (error) return falla(error.message || "No se pudo guardar.");
  return listo("Credencial guardada y cifrada. Ya no se puede ver; si cambia, pega la nueva.");
}

/** Base de datos, valores fijos y el mapeo de campos (nombres de propiedades en Notion). */
export async function guardarConfiguracion(_previo: EstadoConector, formData: FormData): Promise<EstadoConector> {
  await exigirRol("admin_org");
  const conector = String(formData.get("conector") ?? "");
  const configuracion: Record<string, string> = {};
  const mapeo: Record<string, string> = {};
  for (const [clave, valor] of formData.entries()) {
    const v = String(valor).trim();
    if (clave.startsWith("config.")) configuracion[clave.slice(7)] = v;
    if (clave.startsWith("mapeo.")) mapeo[clave.slice(6)] = v;
  }
  const base = (configuracion.base_de_datos ?? "").replace(/-/g, "");
  if (!/^[0-9a-f]{32}$/i.test(base)) return falla("La base de datos es el id de 32 caracteres de la base en Notion.");
  if (!mapeo.titulo || !mapeo.etapa) return falla("El título y la etapa son obligatorios.");

  const supabase = await crearClienteServidor();
  const { error, count } = await supabase
    .from("conectores")
    .update({ configuracion, mapeo_campos: mapeo }, { count: "exact" })
    .eq("id", conector);
  if (error || count !== 1) return falla("No se pudo guardar. Inténtalo otra vez.");
  return listo("Configuración guardada. Prueba la conexión para confirmar que las propiedades existen.");
}

/** Etapa en el sistema externo → estatus que ve el comisionista. */
export async function guardarMapeoEstatus(_previo: EstadoConector, formData: FormData): Promise<EstadoConector> {
  await exigirRol("admin_org");
  const conector = String(formData.get("conector") ?? "");
  const externos = formData.getAll("valor_externo").map((v) => String(v).trim());
  const estatus = formData.getAll("estatus_publico").map(String);
  const filas = externos
    .map((valor_externo, i) => ({ conector_id: conector, valor_externo, estatus_publico: estatus[i] }))
    .filter((f) => f.valor_externo && f.estatus_publico);

  const supabase = await crearClienteServidor();
  const borrar = await supabase.from("mapeo_estatus").delete().eq("conector_id", conector);
  if (borrar.error) return falla("No se pudo guardar el mapeo.");
  if (filas.length > 0) {
    const { error } = await supabase.from("mapeo_estatus").insert(filas);
    if (error) return falla(error.code === "23505" ? "Una etapa está repetida." : "No se pudo guardar el mapeo.");
  }
  return listo("Mapeo de estatus guardado.");
}

/**
 * "Probar conexión" y "Sincronizar ahora": se le pide a /api/cron, que
 * es el único que puede descifrar la credencial. El secreto viaja de
 * servidor a servidor; el navegador nunca lo ve.
 */
export async function llamarCron(_previo: EstadoConector, formData: FormData): Promise<EstadoConector> {
  await exigirRol("admin_org");
  const secreto = process.env.CRON_SECRET;
  if (!secreto) return falla("Esto solo funciona en tasa.xgplataform.com (aquí no está el secreto del cron).");
  const probar = formData.get("accion") === "probar";
  const h = await headers();
  const origen = `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host")}`;

  const r = await fetch(`${origen}/api/cron`, {
    method: "POST",
    headers: { Authorization: `Bearer ${secreto}`, "Content-Type": "application/json" },
    body: JSON.stringify({ conector: String(formData.get("conector") ?? ""), probar }),
    cache: "no-store",
  });
  const json = (await r.json().catch(() => ({}))) as {
    resultados?: { creados: number; leidos: number; actualizados: number; error: string | null }[];
    error?: string;
  };
  revalidatePath("/ajustes");
  const res = json.resultados?.[0];
  if (!r.ok || !res) {
    return falla(json.error ?? "El conector no corrió: revisa que tenga credencial guardada y que esté activo.");
  }
  if (res.error) return falla(res.error);
  return listo(
    probar
      ? "Conexión correcta: la credencial sirve, la base se ve y las propiedades existen."
      : `Sincronizado: ${res.creados} creados en Notion, ${res.leidos} leídos, ${res.actualizados} con cambios.`
  );
}
