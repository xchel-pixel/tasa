"use server";

import { revalidatePath } from "next/cache";
import { errorDeClabe, limpiarClabe } from "@/lib/clabe";
import { errorDeRfc, limpiarRfc } from "@/lib/limpiar";
import { exigirRol } from "@/lib/sesion";
import { crearClienteServidor } from "@/lib/supabase/server";

export type EstadoCatalogo = { error: string | null; mensaje: string | null };

const falla = (error: string): EstadoCatalogo => ({ error, mensaje: null });
const campo = (f: FormData, n: string) => String(f.get(n) ?? "").trim();

/** Los errores de la base que sí sabemos explicar. */
function traducir(error: { code?: string; message: string }, que: string): EstadoCatalogo {
  if (error.code === "23505") return falla(`Ya existe ${que} con ese nombre o clave.`);
  if (error.code === "23503") return falla("Ya tiene movimientos: no se borra. Desactívala para que no aparezca en lo nuevo.");
  return falla(error.message || "No se pudo guardar. Inténtalo otra vez.");
}

function listo(mensaje: string): EstadoCatalogo {
  revalidatePath("/admin/catalogos");
  return { error: null, mensaje };
}

export async function guardarMarca(_previo: EstadoCatalogo, f: FormData): Promise<EstadoCatalogo> {
  await exigirRol("admin_org");
  const id = campo(f, "id");
  const clave = campo(f, "clave").toUpperCase();
  const nombre = campo(f, "nombre");
  const color = campo(f, "color");
  const acento = campo(f, "color_acento");
  const claro = campo(f, "color_claro");
  if (!/^[A-Z0-9]{2,10}$/.test(clave)) return falla("La clave va de 2 a 10 letras o números (p. ej. MGP).");
  if (!nombre) return falla("Falta el nombre.");
  if ([color, acento, claro].some((c) => c && !/^#[0-9a-fA-F]{6}$/.test(c))) return falla("Un color no es válido: va como #04386C.");

  const datos = {
    clave,
    nombre,
    color: color || null,
    cuenta_sugerida_id: campo(f, "cuenta_sugerida_id") || null,
    activa: id ? f.get("activa") === "on" : true,
    // Lo que imprime el PDF de la cotización.
    nombre_legal: campo(f, "nombre_legal") || null,
    direccion: campo(f, "direccion") || null,
    correo: campo(f, "correo") || null,
    telefonos: campo(f, "telefonos") || null,
    firmante: campo(f, "firmante") || null,
    firmante_cargo: campo(f, "firmante_cargo") || null,
    formas_pago: campo(f, "formas_pago") || null,
    color_acento: acento || null,
    color_claro: claro || null,
    tipografia: campo(f, "tipografia") === "manrope" ? "manrope" : "adventor",
    hoja: campo(f, "hoja") === "oficio" ? "oficio" : "carta",
  };
  const supabase = await crearClienteServidor();
  const { error } = id
    ? await supabase.from("marcas").update(datos).eq("id", id)
    : await supabase.from("marcas").insert(datos);
  if (error) return traducir(error, "una marca");
  return listo(id ? "Marca guardada." : "Marca agregada.");
}

/**
 * El logo del PDF, al bucket privado `marcas`. Cada subida es un archivo
 * nuevo (las cotizaciones ya emitidas no cambian: su PDF ya está hecho).
 */
export async function subirLogo(_previo: EstadoCatalogo, f: FormData): Promise<EstadoCatalogo> {
  const persona = await exigirRol("admin_org");
  const id = campo(f, "id");
  const archivo = f.get("logo");
  if (!(archivo instanceof File) || archivo.size === 0) return falla("Elige la imagen del logo.");
  const tipo = archivo.type === "image/png" ? "png" : archivo.type === "image/jpeg" ? "jpg" : null;
  if (archivo.type === "image/svg+xml") return falla("El SVG todavía no se puede imprimir en la cotización. Expórtalo como PNG y súbelo.");
  if (!tipo) return falla("El logo va en PNG o JPG.");
  if (archivo.size > 900_000) return falla("El logo pesa más de 900 KB: redúcelo (el PDF lo imprime a unos 5 cm).");

  const supabase = await crearClienteServidor();
  const ruta = `${persona.organizacion.id}/${id}-${Date.now()}.${tipo}`;
  const subida = await supabase.storage.from("marcas").upload(ruta, archivo, { contentType: archivo.type });
  if (subida.error) return falla("No se pudo subir el logo. Inténtalo otra vez.");
  const { error, count } = await supabase.from("marcas").update({ logo_ruta: ruta }, { count: "exact" }).eq("id", id);
  if (error || count !== 1) return falla("Se subió el logo pero no se pudo asignar a la marca.");
  return listo("Logo actualizado. Sale en las cotizaciones que emitas desde ahora.");
}

export async function guardarCuenta(_previo: EstadoCatalogo, f: FormData): Promise<EstadoCatalogo> {
  await exigirRol("admin_org");
  const id = campo(f, "id");
  const clabe = limpiarClabe(campo(f, "clabe"));
  const rfc = limpiarRfc(campo(f, "rfc"));
  const alias = campo(f, "alias");
  if (!alias || alias.length > 30) return falla("El alias va de 1 a 30 caracteres (es la etiqueta corta: \"Scotiabank XG\").");
  if (!campo(f, "titular")) return falla("Falta el titular.");
  const errorDato = errorDeClabe(clabe) ?? errorDeRfc(rfc);
  if (errorDato) return falla(errorDato);
  if (!campo(f, "marca_id")) return falla("Elige la marca.");

  const datos = {
    alias,
    titular: campo(f, "titular"),
    banco: campo(f, "banco") || null,
    clabe,
    rfc: rfc || null,
    marca_id: campo(f, "marca_id"),
    activa: id ? f.get("activa") === "on" : true,
  };
  const supabase = await crearClienteServidor();
  const { error } = id
    ? await supabase.from("cuentas_receptoras").update(datos).eq("id", id)
    : await supabase.from("cuentas_receptoras").insert(datos);
  if (error) return traducir(error, "una cuenta");
  return listo(id ? "Cuenta guardada." : "Cuenta agregada.");
}

export async function guardarServicio(_previo: EstadoCatalogo, f: FormData): Promise<EstadoCatalogo> {
  await exigirRol("admin_org");
  const id = campo(f, "id");
  const nombre = campo(f, "nombre");
  if (!nombre) return falla("Falta el nombre.");
  // Lo que imprime el PDF de la cotización para este servicio.
  const textos = {
    alcance: campo(f, "alcance") || null,
    tiempo_entrega: campo(f, "tiempo_entrega") || null,
    documentos: campo(f, "documentos") || null,
    aviso: campo(f, "aviso") || null,
    // El "Tipo de Trámite" que se escribe en Notion. Vacío: no se manda.
    nombre_notion: campo(f, "nombre_notion") || null,
  };
  const supabase = await crearClienteServidor();
  const { error } = id
    ? await supabase.from("servicios").update({ nombre, activo: f.get("activo") === "on", ...textos }).eq("id", id)
    : await supabase.from("servicios").insert({ nombre, orden: 99, ...textos });
  if (error) return traducir(error, "un servicio");
  return listo(id ? "Servicio guardado." : "Servicio agregado.");
}

/**
 * Una cuenta para pagar comisiones: se elige al registrar el pago. "Cuenta en Notion" es el nombre
 * exacto en Cuentas MGP; sin él, el movimiento en Cobros y Gastos queda con Cuenta vacía y sale alerta.
 * No se borran: se apagan.
 */
/** Un paquete de crédito (0077): precio IVA incluido, crédito, vigencia y beneficios. Queda en la bitácora. */
export async function guardarPaquete(_previo: EstadoCatalogo, f: FormData): Promise<EstadoCatalogo> {
  await exigirRol("admin_org");
  const id = campo(f, "id");
  const numero = (n: string) => Number(campo(f, n).split(",").join(""));
  const datos = {
    nombre: campo(f, "nombre"), precio: numero("precio"), credito: numero("credito"), meses: numero("meses"),
    cupos: campo(f, "cupos") === "socio" ? "socio" : "sin_limite", dxf_extra: numero("dxf_extra") || 0,
    entrega_prioritaria: f.get("entrega_prioritaria") === "on", insignia: campo(f, "insignia") || null,
    beneficios: campo(f, "beneficios"), activo: f.get("activo") === "on",
  };
  if (datos.nombre.length < 3 || datos.nombre.length > 40) return falla("El nombre va de 3 a 40 caracteres.");
  if (!(datos.precio > 0) || !(datos.credito > 0)) return falla("Precio y crédito tienen que ser mayores que cero.");
  if (!Number.isInteger(datos.meses) || datos.meses < 1 || datos.meses > 24) return falla("La vigencia va de 1 a 24 meses.");
  if (!Number.isInteger(datos.dxf_extra) || datos.dxf_extra < 0 || datos.dxf_extra > 500) return falla("Los DXF extra van de 0 a 500.");
  if (datos.beneficios.length < 3 || datos.beneficios.length > 300) return falla("Describe los beneficios (hasta 300 caracteres).");
  const supabase = await crearClienteServidor();
  const { error } = await supabase.from("paquetes").update(datos).eq("id", id);
  if (error) return traducir(error, "un paquete");
  return listo("Paquete guardado. Aplica a las compras nuevas; las ya hechas conservan su precio y su crédito.");
}

/** La cuenta a la que se transfiere la compra de un paquete (0077). */
export async function guardarCuentaPaquetes(_previo: EstadoCatalogo, f: FormData): Promise<EstadoCatalogo> {
  const persona = await exigirRol("admin_org");
  const cuenta = campo(f, "cuenta") || null;
  const supabase = await crearClienteServidor();
  const { error } = await supabase.from("ajustes").update({ cuenta_paquetes: cuenta }).eq("organizacion_id", persona.organizacion.id);
  if (error) return traducir(error, "una cuenta");
  return listo("Cuenta para paquetes guardada.");
}

export async function guardarCuentaPago(_previo: EstadoCatalogo, f: FormData): Promise<EstadoCatalogo> {
  await exigirRol("admin_org");
  const id = campo(f, "id");
  const nombre = campo(f, "nombre");
  const notion = campo(f, "notion_cuenta").replace(/\s+/g, " ") || null;
  if (nombre.length < 1 || nombre.length > 40) return falla("El nombre va de 1 a 40 caracteres.");
  if (notion && notion.length > 120) return falla("La cuenta de Notion va de 1 a 120 caracteres.");
  const supabase = await crearClienteServidor();
  const { error } = id
    ? await supabase.from("origenes_pago").update({ nombre, notion_cuenta: notion, activo: f.get("activo") === "on" }).eq("id", id)
    : await supabase.from("origenes_pago").insert({ nombre, notion_cuenta: notion, orden: 99 });
  if (error) return traducir(error, "una cuenta");
  return listo(id ? "Cuenta guardada." : "Cuenta agregada.");
}

const ROLES_HERRAMIENTA = ["admin_org", "finanzas", "admin_marca", "equipo", "comisionista"];

/**
 * Una herramienta del catálogo (0053): activa, quién la ve (roles y, para comisionistas, niveles) y si va en
 * el menú. "Todos los niveles" guarda nulo; marcar niveles deja solo esos.
 */
export async function guardarHerramienta(_previo: EstadoCatalogo, f: FormData): Promise<EstadoCatalogo> {
  await exigirRol("admin_org");
  const nombre = campo(f, "nombre").replace(/\s+/g, " ");
  if (nombre.length < 2 || nombre.length > 40) return falla("El nombre va de 2 a 40 caracteres.");
  const roles = f.getAll("roles").map(String).filter((r) => ROLES_HERRAMIENTA.includes(r));
  const niveles = f.get("todos_niveles") === "on" ? null : f.getAll("niveles").map(String);
  const supabase = await crearClienteServidor();
  const { error } = await supabase
    .from("herramientas")
    .update({ nombre, roles, niveles, activa: f.get("activa") === "on", en_menu: f.get("en_menu") === "on", actualizada_en: new Date().toISOString() })
    .eq("id", campo(f, "id"));
  if (error) return traducir(error, "una herramienta");
  revalidatePath("/", "layout");
  return listo("Herramienta guardada.");
}

/**
 * Cupo mensual por nivel de una herramienta que consume (0057). Vacío = sin límite. Equipo y administración
 * nunca tienen límite. Cuenta desde el día 1 del mes (hora de México).
 */
export async function guardarCupos(_previo: EstadoCatalogo, f: FormData): Promise<EstadoCatalogo> {
  await exigirRol("admin_org");
  const herramienta = campo(f, "herramienta");
  const filas: { herramienta: string; nivel_id: string; cantidad: number | null }[] = [];
  for (const [k, v] of f.entries()) {
    if (!k.startsWith("cupo_")) continue;
    const t = String(v).trim();
    if (t !== "" && !/^\d{1,5}$/.test(t)) return falla("Cada cupo es un número entero; vacío es sin límite.");
    filas.push({ herramienta, nivel_id: k.slice(5), cantidad: t === "" ? null : Number(t) });
  }
  const supabase = await crearClienteServidor();
  const { error } = await supabase.from("cupos_herramienta").upsert(filas, { onConflict: "organizacion_id,herramienta,nivel_id" });
  if (error) return traducir(error, "un cupo");
  return listo("Cupos guardados.");
}

/** Un perfil del catálogo (lo eligen los comisionistas y sale en su tarjeta). */
export async function guardarPerfil(_previo: EstadoCatalogo, f: FormData): Promise<EstadoCatalogo> {
  await exigirRol("admin_org");
  const id = campo(f, "id");
  const nombre = campo(f, "nombre").replace(/\s+/g, " ");
  if (nombre.length < 2 || nombre.length > 60) return falla("El perfil va de 2 a 60 caracteres.");
  const supabase = await crearClienteServidor();
  const { error } = id
    ? await supabase.from("perfiles").update({ nombre, activo: f.get("activo") === "on" }).eq("id", id)
    : await supabase.from("perfiles").insert({ nombre });
  if (error) return /no puede decir/.test(error.message) ? falla(error.message) : traducir(error, "un perfil");
  return listo(id ? "Perfil guardado." : "Perfil agregado.");
}

/**
 * Borrar solo lo que nunca se usó. Si ya tiene trabajos o movimientos,
 * la base lo impide (llaves) y se pide desactivarlo.
 */
export async function eliminar(_previo: EstadoCatalogo, f: FormData): Promise<EstadoCatalogo> {
  await exigirRol("admin_org");
  const tabla = campo(f, "tabla");
  if (!["marcas", "cuentas_receptoras", "servicios", "perfiles"].includes(tabla)) return falla("No válido.");
  const supabase = await crearClienteServidor();
  const { error, count } = await supabase.from(tabla).delete({ count: "exact" }).eq("id", campo(f, "id"));
  if (error) return traducir(error, "un registro");
  if (count !== 1) return falla("No se pudo borrar.");
  return listo("Borrado.");
}

/**
 * Guardar un convenio desde su pantalla: datos, precios y comisión juntos. La base lo hace en una
 * transacción (`guardar_convenio`) y regresa un mensaje en español si algo no cuadra. Nunca truena:
 * cualquier falla inesperada también vuelve como mensaje, no como página de error.
 */
export async function guardarConvenioCompleto(_previo: EstadoCatalogo, f: FormData): Promise<EstadoCatalogo> {
  try {
    await exigirRol("admin_org");
    let precios: unknown;
    try {
      precios = JSON.parse(campo(f, "precios") || "[]");
    } catch {
      return falla("Los precios no llegaron bien. Recarga la página e inténtalo otra vez.");
    }
    const id = campo(f, "id");
    const supabase = await crearClienteServidor();
    const { error } = await supabase.rpc("guardar_convenio", {
      p_id: id || null,
      p_datos: {
        nombre: campo(f, "nombre"),
        contacto: campo(f, "contacto"),
        notas: campo(f, "notas"),
        vigente_desde: campo(f, "vigente_desde"),
        vigente_hasta: campo(f, "vigente_hasta"),
        comision_regla: campo(f, "comision_regla") || "normal",
        comision_pct: campo(f, "comision_pct"),
        activo: id ? f.get("activo") === "on" : true,
      },
      p_precios: precios,
    });
    if (error) return traducir(error, "un convenio");
    return listo(id ? "Convenio guardado." : "Convenio agregado.");
  } catch (e) {
    console.error(`[tasa] guardarConvenioCompleto: ${e instanceof Error ? e.message : String(e)}`);
    return falla("No se pudo guardar el convenio. Inténtalo otra vez; si se repite, avísame.");
  }
}
