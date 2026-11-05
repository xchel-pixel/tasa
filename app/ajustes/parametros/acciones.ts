"use server";

import { revalidatePath } from "next/cache";
import { exigirRol } from "@/lib/sesion";
import { crearClienteServidor } from "@/lib/supabase/server";

export type EstadoParametro = { error: string | null; mensaje: string | null };

const falla = (error: string): EstadoParametro => ({ error, mensaje: null });
const FECHA = /^\d{4}-\d{2}-\d{2}$/;

async function guardar(clave: string, valor: unknown, vigente: string): Promise<EstadoParametro> {
  if (!FECHA.test(vigente)) return falla("Escribe la fecha desde la que rige.");
  const supabase = await crearClienteServidor();
  const { error } = await supabase.rpc("guardar_parametro_fiscal", { p_clave: clave, p_valor: valor, p_vigente_desde: vigente });
  if (error) return falla(error.message || "No se pudo guardar.");
  revalidatePath("/ajustes/parametros");
  return { error: null, mensaje: `Guardado; rige desde el ${vigente.split("-").reverse().join("/")}.` };
}

/** Un valor suelto (UMA, UMA anual, salario mínimo, UDI, tope de UDIS). */
export async function guardarValor(_p: EstadoParametro, f: FormData): Promise<EstadoParametro> {
  await exigirRol("admin_org");
  const valor = Number(String(f.get("valor") ?? "").replace(/[$,\s]/g, ""));
  if (!(valor > 0)) return falla("El valor debe ser un número mayor que cero.");
  return guardar(String(f.get("clave")), valor, String(f.get("vigente") ?? ""));
}

/** Una tabla por renglones (art. 126, arancel notarial, cancelación de hipoteca, Consejo, recargos). */
export async function guardarTabla(_p: EstadoParametro, f: FormData): Promise<EstadoParametro> {
  await exigirRol("admin_org");
  const clave = String(f.get("clave"));
  let filas: (number | null)[][];
  try {
    filas = JSON.parse(String(f.get("filas") ?? "[]"));
  } catch {
    return falla("La tabla no se pudo leer.");
  }
  if (!filas.length) return falla("La tabla necesita al menos un renglón.");
  if (filas.some((r) => r.some((x) => x !== null && !Number.isFinite(x)))) return falla("Hay una celda que no es número.");
  if (clave === "recargos") {
    const porAnio = Object.fromEntries(filas.map(([anio, ...meses]) => [String(anio), meses]));
    if (filas.some(([anio, ...meses]) => !anio || meses.length !== 12 || meses.some((x) => x === null))) return falla("Cada año lleva sus 12 tasas mensuales.");
    return guardar(clave, porAnio, String(f.get("vigente") ?? ""));
  }
  return guardar(clave, filas, String(f.get("vigente") ?? ""));
}

export async function agregarInpc(_p: EstadoParametro, f: FormData): Promise<EstadoParametro> {
  await exigirRol("admin_org");
  const mes = String(f.get("mes") ?? "").trim(), valor = Number(String(f.get("valor") ?? "").replace(",", "."));
  const supabase = await crearClienteServidor();
  const { error } = await supabase.rpc("agregar_inpc", { p_mes: mes, p_valor: valor });
  if (error) return falla(error.message || "No se pudo guardar.");
  revalidatePath("/ajustes/parametros");
  return { error: null, mensaje: `INPC ${mes} guardado.` };
}

/** La tarifa de ISTD de un municipio (se guarda la tabla de los 18 con este cambio, con su vigencia). */
export async function guardarIstd(_p: EstadoParametro, f: FormData): Promise<EstadoParametro> {
  await exigirRol("admin_org");
  const municipio = String(f.get("municipio") ?? "");
  const supabase = await crearClienteServidor();
  const { data } = await supabase.from("parametros_fiscales").select("valor").eq("clave", "istd").order("vigente_desde", { ascending: false }).limit(1).maybeSingle<{ valor: Record<string, Record<string, unknown>> }>();
  const todo = data?.valor ?? {};
  if (!todo[municipio]) return falla("No existe ese municipio.");
  const tipo = String(f.get("tipo")) === "tasa" ? "tasa" : "tarifa";
  let tabla: (number | null)[][] = [];
  try {
    tabla = JSON.parse(String(f.get("filas") ?? "[]"));
  } catch {
    return falla("La tabla no se pudo leer.");
  }
  const tasa = Number(String(f.get("tasa") ?? "").replace(",", ".")) / 100;
  if (tipo === "tasa" && !(tasa > 0 && tasa < 0.2)) return falla("La tasa va en porcentaje, por ejemplo 2.");
  if (tipo === "tarifa" && !tabla.length) return falla("La tarifa necesita sus rangos.");
  const donacion = String(f.get("donacion_familiar") ?? "").trim();
  const nuevo = {
    ...todo[municipio],
    tipo,
    tasa: tipo === "tasa" ? tasa : undefined,
    tabla: tipo === "tarifa" ? tabla : undefined,
    base: String(f.get("base") || "op_com"),
    deduccion: String(f.get("deduccion") || "") || null,
    donacion_familiar: donacion ? Number(donacion) / 100 : undefined,
    estado: String(f.get("estado") || "verificado"),
    ley: String(f.get("ley") ?? "").trim(),
    url: String(f.get("url") ?? "").trim(),
    art: String(f.get("art") ?? "").trim(),
    notas: String(f.get("notas") ?? "").split("\n").map((x) => x.trim()).filter(Boolean),
  };
  return guardar("istd", { ...todo, [municipio]: JSON.parse(JSON.stringify(nuevo)) }, String(f.get("vigente") ?? ""));
}
