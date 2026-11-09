"use server";

import { revalidatePath } from "next/cache";
import { exigirPersona, exigirRol } from "@/lib/sesion";
import { crearClienteServidor } from "@/lib/supabase/server";

/** DXF del mapa catastral (0065): admin_org autoriza, agrega y quita; quien se queda sin saldo pide más. */

export type EstadoDxfForm = { error: string | null; mensaje: string | null };

function refrescar(persona: string) {
  revalidatePath(`/admin/comisionistas/${persona}`);
  revalidatePath("/admin/equipo");
  revalidatePath("/admin/alertas");
}

export async function autorizarDxf(_p: EstadoDxfForm, f: FormData): Promise<EstadoDxfForm> {
  await exigirRol("admin_org");
  const persona = String(f.get("persona") ?? "");
  const sinLimite = f.get("sin_limite") === "on";
  const saldo = Number(String(f.get("saldo") ?? "").trim());
  if (!sinLimite && (!Number.isInteger(saldo) || saldo < 0)) return { error: "Escribe cuántas descargas o marca Sin límite.", mensaje: null };
  const supabase = await crearClienteServidor();
  const { error } = await supabase.rpc("dxf_autorizar", { p_persona: persona, p_saldo: sinLimite ? null : saldo, p_motivo: String(f.get("motivo") ?? "") });
  if (error) return { error: error.message || "No se pudo autorizar.", mensaje: null };
  refrescar(persona);
  return { error: null, mensaje: sinLimite ? "Autorizada: DXF sin límite." : `Autorizada con ${saldo} DXF.` };
}

export async function agregarDxf(_p: EstadoDxfForm, f: FormData): Promise<EstadoDxfForm> {
  await exigirRol("admin_org");
  const persona = String(f.get("persona") ?? "");
  const cantidad = Number(String(f.get("cantidad") ?? "").trim());
  const supabase = await crearClienteServidor();
  const { error } = await supabase.rpc("dxf_agregar", {
    p_persona: persona, p_cantidad: Number.isInteger(cantidad) ? cantidad : 0, p_motivo: String(f.get("motivo") ?? ""),
  });
  if (error) return { error: error.message || "No se pudo agregar.", mensaje: null };
  refrescar(persona);
  return { error: null, mensaje: `Se agregaron ${cantidad} DXF.` };
}

export async function quitarDxf(_p: EstadoDxfForm, f: FormData): Promise<EstadoDxfForm> {
  await exigirRol("admin_org");
  const persona = String(f.get("persona") ?? "");
  const supabase = await crearClienteServidor();
  const { error } = await supabase.rpc("dxf_quitar", { p_persona: persona, p_motivo: String(f.get("motivo") ?? "") });
  if (error) return { error: error.message || "No se pudo quitar.", mensaje: null };
  refrescar(persona);
  return { error: null, mensaje: "Se quitó la autorización." };
}

/** "Pedir más": alerta para admin_org dentro de Tasa (sin correo). */
export async function pedirMasDxf(_p: EstadoDxfForm): Promise<EstadoDxfForm> {
  await exigirPersona();
  const supabase = await crearClienteServidor();
  const { error } = await supabase.rpc("pedir_mas_dxf");
  if (error) return { error: error.message || "No se pudo enviar.", mensaje: null };
  return { error: null, mensaje: "Listo: Administración ya sabe que necesitas más DXF." };
}
