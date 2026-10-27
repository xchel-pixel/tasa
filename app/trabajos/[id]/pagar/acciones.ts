"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { carpetaDe, exigirRol, ROLES_OPERACION } from "@/lib/sesion";
import { crearClienteServidor } from "@/lib/supabase/server";

export type EstadoReporte = { error: string | null };

/**
 * Todo pago entra como "reportado"; Administración lo confirma o lo
 * rechaza con motivo. Vías:
 *   · comisionista: comprobante (archivo obligatorio), aviso (nota
 *     obligatoria) o efectivo (quién lo recibió; recibo opcional);
 *   · staff: directo (referencia; comprobante opcional) o efectivo.
 * El archivo ya se subió al bucket desde el teléfono; aquí llega la ruta.
 */
export async function reportarPago(_previo: EstadoReporte, formData: FormData): Promise<EstadoReporte> {
  const persona = await exigirRol("comisionista", ...ROLES_OPERACION);
  // admin_org, finanzas y admin_marca registran; el comisionista reporta.
  const staff = persona.rol !== "comisionista";

  const solicitudId = String(formData.get("solicitud_id") ?? "");
  const via = String(formData.get("via") ?? "");
  const monto = Number(String(formData.get("monto") ?? "").replace(/[$,\s]/g, ""));
  const fecha = String(formData.get("fecha_pago") ?? "");
  const nota = String(formData.get("nota") ?? "").trim() || null;
  const referencia = String(formData.get("referencia") ?? "").trim() || null;
  const recibidoPor = String(formData.get("recibido_por") ?? "").trim() || null;
  const ruta = String(formData.get("comprobante_ruta") ?? "") || null;

  const hoy = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City" }).format(new Date());
  const supabase = await crearClienteServidor();

  // Lo que falta se calcula aquí, no se toma del formulario.
  const { data: trabajo } = await supabase
    .from("solicitudes")
    .select("monto_total, pagos(monto, estado)")
    .eq("id", solicitudId)
    .maybeSingle()
    .returns<{ monto_total: string | number; pagos: { monto: string | number; estado: string }[] } | null>();
  if (!trabajo) return { error: "No encontramos el trabajo." };
  const falta =
    Number(trabajo.monto_total) -
    trabajo.pagos.filter((p) => p.estado === "confirmado").reduce((s, p) => s + Number(p.monto), 0);

  const permitidas = staff ? ["directo", "efectivo"] : ["comprobante", "aviso", "efectivo"];
  if (!permitidas.includes(via)) return { error: "Elige cómo pagó el cliente." };
  if (!Number.isFinite(monto) || monto <= 0) return { error: "Escribe el monto que pagó el cliente." };
  if (monto > falta + 0.001) return { error: "El monto es mayor que lo que falta por pagar." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || fecha > hoy) return { error: "La fecha del pago no puede ser futura." };
  if (via === "comprobante" && !ruta) return { error: "Sube el comprobante, o elige \"Solo aviso, sin archivo\"." };
  // La ruta la puso el teléfono: se comprueba que esté en la carpeta de
  // quien reporta. La política del bucket ya no le dejó subir a otra.
  if (ruta && !ruta.startsWith(`${carpetaDe(persona)}/`)) return { error: "El archivo no es válido. Súbelo otra vez." };
  if (via === "aviso" && !nota) return { error: "Cuéntanos cómo pagó el cliente (banco, referencia, a nombre de quién)." };
  if (via === "efectivo" && !recibidoPor) return { error: "Escribe quién recibió el efectivo." };
  if (via === "directo" && !referencia) return { error: "Escribe la referencia del banco." };

  const { error } = await supabase.from("pagos").insert({
    solicitud_id: solicitudId,
    via,
    monto: Math.round(monto * 100) / 100,
    fecha_pago: fecha,
    nota,
    referencia: via === "directo" ? referencia : null,
    recibido_por: via === "efectivo" ? recibidoPor : null,
    comprobante_ruta: via === "aviso" ? null : ruta,
    reportado_por: persona.id,
  });

  if (error) {
    console.error(`[tasa] No se pudo reportar el pago: ${error.message}`);
    return { error: "No se pudo guardar el pago. Inténtalo otra vez." };
  }

  revalidatePath("/");
  revalidatePath("/admin/pagos");
  revalidatePath(`/trabajos/${solicitudId}`);
  redirect(`/trabajos/${solicitudId}`);
}
