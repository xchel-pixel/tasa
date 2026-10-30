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
