"use server";

import { revalidatePath } from "next/cache";
import { exigirRol } from "@/lib/sesion";
import { crearClienteServidor } from "@/lib/supabase/server";

export type EstadoTarjeta = { error: string | null; mensaje: string | null };

const ok = (mensaje: string): EstadoTarjeta => {
  revalidatePath("/tarjeta");
  revalidatePath("/");
  return { error: null, mensaje };
};

/** Guarda el contenido. La base valida teléfono, servicios y que el texto no diga perito, valuador ni marcas. */
export async function guardarTarjeta(_previo: EstadoTarjeta, formData: FormData): Promise<EstadoTarjeta> {
  await exigirRol("comisionista");
  const supabase = await crearClienteServidor();
  const texto = (n: string) => String(formData.get(n) ?? "");
  const { error } = await supabase.rpc("guardar_mi_tarjeta", {
    p_frase: texto("frase"),
    p_telefono: texto("telefono"),
    p_correo: texto("correo"),
    p_mostrar_correo: formData.get("mostrar_correo") === "on",
    p_zona: texto("zona"),
    p_color: texto("color"),
    p_servicios: formData.getAll("servicios").map(String),
  });
  if (error) return { error: error.message || "No se pudo guardar.", mensaje: null };
  return ok("Tarjeta guardada.");
}

/** Publicar o pausar la suya (una despublicada por Administración no se puede volver a publicar aquí). */
export async function publicarTarjeta(_previo: EstadoTarjeta, formData: FormData): Promise<EstadoTarjeta> {
  await exigirRol("comisionista");
  const publicar = formData.get("publicar") === "si";
  const supabase = await crearClienteServidor();
  const { error } = await supabase.rpc("publicar_mi_tarjeta", { p_publicar: publicar });
  if (error) return { error: error.message || "No se pudo.", mensaje: null };
  return ok(publicar ? "Tu tarjeta está publicada." : "Tu tarjeta está en pausa: nadie la ve hasta que la vuelvas a publicar.");
}

/** Anota la foto o el logo ya subidos y borra la imagen anterior del bucket. */
export async function ponerImagen(tipo: "foto" | "logo", ruta: string | null): Promise<EstadoTarjeta> {
  await exigirRol("comisionista");
  const supabase = await crearClienteServidor();
  const { data: anterior, error } = await supabase.rpc("poner_imagen_tarjeta", { p_tipo: tipo, p_ruta: ruta });
  if (error) return { error: error.message || "No se pudo guardar la imagen.", mensaje: null };
  if (typeof anterior === "string" && anterior && anterior !== ruta) {
    await supabase.storage.from("tarjetas").remove([anterior]);
  }
  return ok(ruta ? (tipo === "foto" ? "Foto guardada." : "Logo guardado.") : "Imagen quitada.");
}

/** Un testimonio de un cliente; se publica cuando Administración lo aprueba. */
export async function agregarTestimonio(_previo: EstadoTarjeta, formData: FormData): Promise<EstadoTarjeta> {
  const persona = await exigirRol("comisionista");
  const cliente = String(formData.get("cliente") ?? "").trim();
  const texto = String(formData.get("texto") ?? "").trim();
  if (cliente.length < 2 || texto.length < 5) return { error: "Escribe el nombre o las iniciales del cliente y su comentario.", mensaje: null };
  const supabase = await crearClienteServidor();
  const { data: prohibida } = await supabase.rpc("palabra_prohibida", { p_texto: `${cliente} ${texto}` });
  if (prohibida) return { error: `El testimonio no puede decir "${prohibida}".`, mensaje: null };
  const { error } = await supabase.from("testimonios").insert({ comisionista_id: persona.id, cliente, texto });
  if (error) return { error: "No se pudo guardar el testimonio.", mensaje: null };
  return ok("Testimonio enviado: se publica cuando Administración lo apruebe.");
}

/** Redes sociales y si el bloque del despacho va arriba o abajo de "Mis servicios". La base valida cada liga. */
export async function guardarRedes(_previo: EstadoTarjeta, formData: FormData): Promise<EstadoTarjeta> {
  await exigirRol("comisionista");
  const texto = (n: string) => String(formData.get(n) ?? "").trim() || null;
  const supabase = await crearClienteServidor();
  const { error } = await supabase.rpc("guardar_mis_redes", {
    p_facebook: texto("facebook"),
    p_instagram: texto("instagram"),
    p_tiktok: texto("tiktok"),
    p_linkedin: texto("linkedin"),
    p_sitio: texto("sitio"),
    p_despacho_arriba: formData.get("despacho") !== "abajo",
  });
  if (error) return { error: error.message || "No se pudo guardar.", mensaje: null };
  return ok("Redes guardadas.");
}

/** Nuevo o cambio de un servicio propio (la base revisa límite del nivel, enlace y palabras prohibidas). */
export async function guardarServicio(_previo: EstadoTarjeta, formData: FormData): Promise<EstadoTarjeta> {
  await exigirRol("comisionista");
  const texto = (n: string) => String(formData.get(n) ?? "").trim();
  if (texto("titulo").length < 2) return { error: "Escribe el título del servicio.", mensaje: null };
  if (texto("descripcion").length > 160) return { error: "La descripción va hasta 160 caracteres.", mensaje: null };
  const supabase = await crearClienteServidor();
  const { error } = await supabase.rpc("guardar_mi_servicio", {
    p_id: texto("id") || null,
    p_titulo: texto("titulo"),
    p_descripcion: texto("descripcion") || null,
    p_icono: texto("icono") || "casa",
    p_enlace: texto("enlace") || null,
  });
  if (error) return { error: error.message || "No se pudo guardar.", mensaje: null };
  return ok(texto("id") ? "Servicio guardado." : "Servicio agregado.");
}

/** Nuevo o cambio de un inmueble; la foto ya se subió al bucket. Borra la foto anterior si cambió. */
export async function guardarInmueble(datos: {
  id: string | null;
  titulo: string;
  operacion: "venta" | "renta";
  precio: number | null;
  zona: string;
  foto: string | null;
  enlace: string | null;
}): Promise<EstadoTarjeta> {
  await exigirRol("comisionista");
  if (datos.titulo.trim().length < 2 || datos.zona.trim().length < 2) return { error: "Escribe el título y la zona.", mensaje: null };
  if (datos.precio !== null && (!Number.isFinite(datos.precio) || datos.precio <= 0)) return { error: "Revisa el precio.", mensaje: null };
  const supabase = await crearClienteServidor();
  const { data: anterior, error } = await supabase.rpc("guardar_mi_inmueble", {
    p_id: datos.id,
    p_titulo: datos.titulo,
    p_operacion: datos.operacion,
    p_precio: datos.precio,
    p_zona: datos.zona,
    p_foto: datos.foto,
    p_enlace: datos.enlace,
  });
  if (error) return { error: error.message || "No se pudo guardar.", mensaje: null };
  if (typeof anterior === "string" && anterior) await supabase.storage.from("tarjetas").remove([anterior]);
  return ok(datos.id ? "Inmueble guardado." : "Inmueble agregado.");
}

/** Borra un servicio o inmueble suyo (y la foto del inmueble del bucket). */
export async function borrarDeMiTarjeta(tipo: "servicio" | "inmueble", id: string): Promise<EstadoTarjeta> {
  await exigirRol("comisionista");
  const supabase = await crearClienteServidor();
  const { data: foto, error } = await supabase.rpc("borrar_de_mi_tarjeta", { p_tipo: tipo, p_id: id });
  if (error) return { error: error.message || "No se pudo borrar.", mensaje: null };
  if (typeof foto === "string" && foto) await supabase.storage.from("tarjetas").remove([foto]);
  return ok(tipo === "servicio" ? "Servicio borrado." : "Inmueble borrado.");
}

/** El orden nuevo (lista completa de ids, de arriba a abajo). */
export async function ordenarMiTarjeta(tipo: "servicio" | "inmueble", ids: string[]): Promise<EstadoTarjeta> {
  await exigirRol("comisionista");
  const supabase = await crearClienteServidor();
  const { error } = await supabase.rpc("ordenar_mi_tarjeta", { p_tipo: tipo, p_ids: ids });
  if (error) return { error: error.message || "No se pudo guardar el orden.", mensaje: null };
  return ok("Orden guardado.");
}
