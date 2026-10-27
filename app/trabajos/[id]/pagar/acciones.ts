"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { exigirRol } from "@/lib/sesion";
import { crearClienteServidor } from "@/lib/supabase/server";

export type EstadoReporte = { error: string | null };

/**
 * Entra como "reportado"; Administración lo confirma o lo rechaza con
 * motivo. Dos vías para el comisionista:
 *   · comprobante: ya se subió al bucket desde el teléfono, aquí llega la ruta;
 *   · aviso: sin archivo, con una nota de cómo y cuándo pagó el cliente.
 */
export async function reportarPago(_previo: EstadoReporte, formData: FormData): Promise<EstadoReporte> {
  const persona = await exigirRol("comisionista");

  const solicitudId = String(formData.get("solicitud_id") ?? "");
  const via = String(formData.get("via") ?? "");
  const monto = Number(String(formData.get("monto") ?? "").replace(/[$,\s]/g, ""));
  const fecha = String(formData.get("fecha_pago") ?? "");
  const nota = String(formData.get("nota") ?? "").trim() || null;
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

  if (via !== "comprobante" && via !== "aviso") return { error: "Elige cómo reportas el pago." };
  if (!Number.isFinite(monto) || monto <= 0) return { error: "Escribe el monto que pagó el cliente." };
  if (monto > falta + 0.001) return { error: "El monto es mayor que lo que falta por pagar." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || fecha > hoy) return { error: "La fecha del pago no puede ser futura." };
  if (via === "comprobante" && !ruta) return { error: "Sube el comprobante, o elige \"Solo aviso\"." };
  // La ruta la puso el teléfono: se comprueba que esté en la carpeta de
  // quien reporta. La política del bucket ya no le dejó subir a otra.
  if (ruta && !ruta.startsWith(`${persona.id}/`)) return { error: "El comprobante no es válido. Súbelo otra vez." };
  if (via === "aviso" && !nota) return { error: "Cuéntanos cómo pagó el cliente (banco, referencia, a nombre de quién)." };

  const { error } = await supabase.from("pagos").insert({
    solicitud_id: solicitudId,
    via,
    monto: Math.round(monto * 100) / 100,
    fecha_pago: fecha,
    nota,
    comprobante_ruta: via === "comprobante" ? ruta : null,
    reportado_por: persona.id,
  });

  if (error) {
    console.error(`[tasa] No se pudo reportar el pago: ${error.message}`);
    return { error: "No se pudo reportar el pago. Inténtalo otra vez." };
  }

  revalidatePath("/");
  revalidatePath(`/trabajos/${solicitudId}`);
  redirect(`/trabajos/${solicitudId}`);
}
