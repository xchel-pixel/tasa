"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { fuentesDe } from "@/lib/fuentes-pdf";
import { generarPdfCotizacion, type LogoPdf, type MarcaPdf } from "@/lib/pdf-cotizacion";
import { exigirRol, ROLES_OPERACION } from "@/lib/sesion";
import { crearClienteServidor } from "@/lib/supabase/server";

type CotizacionEmitida = {
  id: string;
  numero: string;
  monto_honorarios: string | number;
  monto_iva: string | number;
  monto_terceros: string | number;
  monto_total: string | number;
  requiere_factura: boolean;
  vigente_hasta: string;
  cuentas_receptoras: { titular: string; banco: string | null; clabe: string } | null;
  solicitudes: {
    cliente_nombre: string;
    inmueble_direccion: string;
    inmueble_municipio: string | null;
    inmueble_clave_catastral: string | null;
    inmueble_descripcion: string | null;
    comisionistas: { personas: { nombre: string } | null } | null;
    servicios: { nombre: string; alcance: string | null; tiempo_entrega: string | null; documentos: string | null; aviso: string | null } | null;
    marcas: (MarcaPdf & { tipografia: "adventor" | "manrope"; logo_ruta: string | null }) | null;
  } | null;
};

/** El logo de la marca desde el bucket privado `marcas`; sin logo, el PDF imprime la clave. */
async function logoDe(supabase: Awaited<ReturnType<typeof crearClienteServidor>>, ruta: string | null): Promise<LogoPdf> {
  if (!ruta) return null;
  const { data, error } = await supabase.storage.from("marcas").download(ruta);
  if (error || !data) {
    console.error(`[tasa] No se pudo leer el logo ${ruta}: ${error?.message}`);
    return null;
  }
  return { bytes: new Uint8Array(await data.arrayBuffer()), tipo: /.png$/i.test(ruta) ? "png" : "jpg" };
}

export type EstadoPrecio = { error: string | null; mensaje: string | null };

const numero = (v: FormDataEntryValue | null) => {
  const n = Number(String(v ?? "").replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN;
};

/**
 * Dos caminos según el tipo:
 *   · cotización: se emite (la base reemplaza la anterior y deja la
 *     solicitud en "cotizada") y se genera el PDF;
 *   · trámite directo: el precio se pone en la solicitud y arranca como
 *     trámite. Con conector manual Tasa le pone folio; con uno externo,
 *     "Aceptada – folio en asignación" hasta que el sistema externo lo dé.
 */
export async function ponerPrecio(_previo: EstadoPrecio, formData: FormData): Promise<EstadoPrecio> {
  const persona = await exigirRol(...ROLES_OPERACION);
  const solicitud = String(formData.get("solicitud") ?? "");
  const tipo = String(formData.get("tipo") ?? "");
  const marca = String(formData.get("marca") ?? "");
  const cuenta = String(formData.get("cuenta") ?? "");
  const factura = formData.get("factura") === "on";
  const honorarios = numero(formData.get("honorarios"));
  const terceros = formData.get("terceros") ? numero(formData.get("terceros")) : 0;
  const vigencia = String(formData.get("vigencia") ?? "");
  const hoy = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City" }).format(new Date());

  const falla = (error: string): EstadoPrecio => ({ error, mensaje: null });
  if (!marca) return falla("Elige la marca ejecutora.");
  if (!cuenta) return falla("Elige la cuenta receptora.");
  if (!(honorarios > 0)) return falla("Los honorarios deben ser mayores a cero.");
  if (!(terceros >= 0)) return falla("Los derechos y terceros no pueden ser negativos.");
  if (tipo === "cotizacion" && (!/^\d{4}-\d{2}-\d{2}$/.test(vigencia) || vigencia < hoy)) {
    return falla("La vigencia no puede ser anterior a hoy.");
  }

  const supabase = await crearClienteServidor();

  if (tipo === "tramite_directo") {
    const { error, count } = await supabase
      .from("solicitudes")
      .update(
        {
          marca_id: marca,
          cuenta_receptora_id: cuenta,
          requiere_factura: factura,
          monto_honorarios: honorarios,
          monto_terceros: terceros,
          estado: "tramite",
          estatus_publico: "aceptada",
          aceptada_en: new Date().toISOString(),
        },
        { count: "exact" }
      )
      .eq("id", solicitud)
      .eq("estado", "solicitada");
    if (error || count !== 1) return falla("No se pudo guardar el precio. Inténtalo otra vez.");
    revalidatePath("/admin/solicitudes");
    redirect(`/trabajos/${solicitud}`);
  }

  const { error: errorMarca } = await supabase.from("solicitudes").update({ marca_id: marca }).eq("id", solicitud);
  if (errorMarca) return falla("No se pudo guardar la marca. Inténtalo otra vez.");

  const { data: cot, error } = await supabase
    .from("cotizaciones")
    .insert({
      solicitud_id: solicitud,
      requiere_factura: factura,
      monto_honorarios: honorarios,
      monto_terceros: terceros,
      cuenta_receptora_id: cuenta,
      vigente_hasta: vigencia,
      emitida_por: persona.id,
    })
    .select(
      `id, numero, monto_honorarios, monto_iva, monto_terceros, monto_total, requiere_factura, vigente_hasta,
       cuentas_receptoras(titular, banco, clabe),
       solicitudes!cotizaciones_organizacion_id_solicitud_id_fkey(cliente_nombre, inmueble_direccion, inmueble_municipio, inmueble_clave_catastral, inmueble_descripcion,
         comisionistas(personas!comisionistas_persona_id_fkey(nombre)),
         servicios(nombre, alcance, tiempo_entrega, documentos, aviso),
         marcas(clave, nombre_legal, direccion, correo, telefonos, firmante, firmante_cargo, formas_pago,
                color, color_acento, color_claro, tipografia, hoja, logo_ruta))`
    )
    .single()
    .returns<CotizacionEmitida>();

  if (error || !cot) {
    console.error(`[tasa] No se pudo emitir la cotización: ${error?.message}`);
    return falla("No se pudo emitir la cotización. Inténtalo otra vez.");
  }

  // La cotización ya existe. Si el PDF falla, se avisa, pero no se pierde lo emitido.
  try {
    const s = cot.solicitudes!;
    const m = s.marcas!;
    const pdf = await generarPdfCotizacion(
      {
        numero: cot.numero,
        fecha: hoy,
        vigente_hasta: cot.vigente_hasta,
        cliente: s.cliente_nombre,
        inmueble: {
          ubicacion: [s.inmueble_direccion, s.inmueble_municipio].filter(Boolean).join(", "),
          clave_catastral: s.inmueble_clave_catastral,
          descripcion: s.inmueble_descripcion,
        },
        servicio: s.servicios ?? { nombre: "", alcance: null, tiempo_entrega: null, documentos: null, aviso: null },
        honorarios: Number(cot.monto_honorarios),
        terceros: Number(cot.monto_terceros),
        requiere_factura: cot.requiere_factura,
        iva: cot.requiere_factura ? Number(cot.monto_iva) : 0,
        total: Number(cot.monto_total),
        cuenta: cot.cuentas_receptoras!,
        comisionista: s.comisionistas?.personas?.nombre ?? "",
        marca: m,
      },
      await fuentesDe(m.tipografia),
      await logoDe(supabase, m.logo_ruta)
    );
    const ruta = `${persona.organizacion.id}/${solicitud}/${cot.id}.pdf`;
    const subida = await supabase.storage.from("cotizaciones").upload(ruta, pdf, { contentType: "application/pdf" });
    if (subida.error) throw subida.error;
    const { error: errorRuta } = await supabase.from("cotizaciones").update({ pdf_ruta: ruta }).eq("id", cot.id);
    if (errorRuta) throw errorRuta;
  } catch (e) {
    console.error(`[tasa] Cotización ${cot.id} emitida sin PDF: ${e instanceof Error ? e.message : String(e)}`);
    revalidatePath("/admin/solicitudes");
    return { error: null, mensaje: "Cotización emitida, pero el PDF no se pudo generar. Avísame para revisarlo." };
  }

  revalidatePath("/admin/solicitudes");
  redirect(`/trabajos/${solicitud}`);
}
