import { crearClienteServidor, oExplota } from "@/lib/supabase/server";
import { normalizarAvance } from "@/lib/nivel";
import type { EstadoPago, EstatusPublico, ViaPago } from "@/lib/estatus";

/**
 * Lecturas del comisionista. No filtran por persona: el RLS ya solo le
 * deja ver lo suyo. Si una consulta falla, `oExplota` lo dice en vez de
 * pintar una lista vacía.
 */

export type Pago = {
  id: string;
  via: ViaPago;
  monto: number;
  recibido_por: string | null;
  fecha_pago: string;
  referencia: string | null;
  nota: string | null;
  estado: EstadoPago;
  motivo_rechazo: string | null;
  motivo_retiro: string | null;
  reportado_por: string | null;
  /** "Lo recibí yo": el cliente le pagó al comisionista y debe entregarlo a la cuenta. */
  recibio_asesor: boolean;
  entregar_antes: string | null;
  entregado_en: string | null;
};

export type Trabajo = {
  id: string;
  folio: string | null;
  tipo: "cotizacion" | "tramite_directo";
  estado: "solicitada" | "cotizada" | "vencida" | "tramite" | "cancelada";
  estatus_publico: EstatusPublico;
  servicio: string;
  marca: string | null;
  inmueble_direccion: string;
  inmueble_municipio: string | null;
  inmueble_clave_catastral: string | null;
  inmueble_descripcion: string | null;
  /** Si se encargó desde la calculadora de traslado (0056): su cálculo, mientras exista (90 días). */
  calculo_traslado_id: string | null;
  cliente_nombre: string;
  cliente_telefono: string | null;
  cliente_correo: string | null;
  requiere_factura: boolean;
  monto_honorarios: number | null;
  monto_iva: number;
  monto_terceros: number;
  monto_total: number;
  /** Tipo de honorario; en un estimado, `monto_honorarios` es el estimado hasta que se fija el final. */
  honorario: Honorario;
  cuenta: { titular: string; banco: string | null; clabe: string } | null;
  pagado_en: string | null;
  /** Monedero (0077): honorarios pagados con crédito y si nació con entrega prioritaria. */
  credito_honorarios: number;
  entrega_prioritaria: boolean;
  /** Mes al que cayó la comisión al quedar pagado (para saber si ya cerró). */
  mes_cierre: string | null;
  motivo_cancelacion: string | null;
  creado_en: string;
  origen: string;
  comisionista_id: string | null;
  comisionista: string | null;
  /** 'ninguna': no genera comisión (convenio o marcado a mano, con `sin_comision_motivo`). */
  comision_regla: "normal" | "ninguna" | "fija";
  sin_comision_motivo: string | null;
  pagos: Pago[];
  historial: { estatus_publico: EstatusPublico; desde: string }[];
  cotizacion: {
    id: string;
    monto_honorarios: number;
    monto_iva: number;
    monto_terceros: number;
    monto_total: number;
    requiere_factura: boolean;
    vigente_hasta: string;
    pdf_ruta: string | null;
    cuenta: { titular: string; banco: string | null; clabe: string } | null;
    honorario_tipo: TipoHonorario;
    honorario_minimo: number | null;
  } | null;
};

export type TipoHonorario = "fijo" | "sin_costo" | "estimado";

export type Honorario = {
  tipo: TipoHonorario;
  minimo: number | null;
  /** El estimado con que se aceptó (estimado). */
  estimado: number | null;
  /** Cuándo se fijó el final; nulo mientras está "por definir". */
  final_en: string | null;
  /** El trabajo que sí cobra (sin costo), si quien mira lo puede ver. */
  ligada: { id: string; folio: string | null; cliente_nombre: string } | null;
};

type Cuenta = { titular: string; banco: string | null; clabe: string } | null;

type FilaFicha = {
  [k: string]: unknown;
  monto_honorarios: string | number | null;
  monto_iva: string | number;
  monto_terceros: string | number;
  monto_total: string | number;
  servicios: { nombre: string } | null;
  marcas: { nombre: string } | null;
  cuentas_receptoras: Cuenta;
  honorario_tipo: TipoHonorario;
  honorario_minimo: string | number | null;
  honorario_estimado: string | number | null;
  honorario_final_en: string | null;
  ligada: { id: string; folio: string | null; cliente_nombre: string } | null;
  comisionistas: { personas: { nombre: string } | null } | null;
  pagos: (Omit<Pago, "monto"> & { monto: string | number })[];
  historial_estatus: { estatus_publico: EstatusPublico; desde: string }[];
  cotizaciones: {
    id: string;
    estado: string;
    monto_honorarios: string | number;
    monto_iva: string | number;
    monto_terceros: string | number;
    monto_total: string | number;
    requiere_factura: boolean;
    vigente_hasta: string;
    pdf_ruta: string | null;
    cuentas_receptoras: Cuenta;
    honorario_tipo: TipoHonorario;
    honorario_minimo: string | number | null;
  }[];
};

export async function obtenerTrabajo(id: string): Promise<Trabajo | null> {
  const supabase = await crearClienteServidor();
  const f = oExplota(
    await supabase
      .from("solicitudes")
      .select(
        `id, folio, tipo, estado, estatus_publico, inmueble_direccion, inmueble_municipio,
         inmueble_clave_catastral, inmueble_descripcion, calculo_traslado_id, cliente_nombre, cliente_telefono,
         cliente_correo, requiere_factura, monto_honorarios, monto_iva, monto_terceros,
         monto_total, pagado_en, mes_cierre, motivo_cancelacion, creado_en,
         origen, comisionista_id, comision_regla, sin_comision_motivo, credito_honorarios, entrega_prioritaria,
         comisionistas(personas!comisionistas_persona_id_fkey(nombre:nombre_visible)),
         honorario_tipo, honorario_minimo, honorario_estimado, honorario_final_en,
         ligada:ligada_a(id, folio, cliente_nombre),
         servicios(nombre), marcas(nombre), cuentas_receptoras(titular, banco, clabe),
         pagos(id, via, monto, fecha_pago, referencia, nota, recibido_por, estado, motivo_rechazo, motivo_retiro, reportado_por,
               recibio_asesor, entregar_antes, entregado_en),
         historial_estatus(estatus_publico, desde),
         cotizaciones!cotizaciones_organizacion_id_solicitud_id_fkey(id, estado, monto_honorarios, monto_iva, monto_terceros, monto_total,
                      requiere_factura, vigente_hasta, pdf_ruta, honorario_tipo, honorario_minimo,
                      cuentas_receptoras(titular, banco, clabe))`
      )
      .eq("id", id)
      .maybeSingle()
      .returns<FilaFicha | null>(),
    "el trabajo"
  );
  if (!f) return null;

  const viva = f.cotizaciones.find((c) => c.estado === "emitida") ?? null;

  return {
    ...(f as unknown as Trabajo),
    servicio: f.servicios?.nombre ?? "",
    marca: f.marcas?.nombre ?? null,
    comisionista: f.comisionistas?.personas?.nombre ?? null,
    cuenta: f.cuentas_receptoras,
    monto_honorarios: f.monto_honorarios === null ? null : Number(f.monto_honorarios),
    monto_iva: Number(f.monto_iva),
    monto_terceros: Number(f.monto_terceros),
    monto_total: Number(f.monto_total),
    credito_honorarios: Number((f as unknown as { credito_honorarios: string | number }).credito_honorarios ?? 0),
    honorario: {
      tipo: f.honorario_tipo,
      minimo: f.honorario_minimo === null ? null : Number(f.honorario_minimo),
      estimado: f.honorario_estimado === null ? null : Number(f.honorario_estimado),
      final_en: f.honorario_final_en,
      ligada: f.ligada,
    },
    pagos: f.pagos
      .map((p) => ({ ...p, monto: Number(p.monto) }))
      .sort((a, b) => b.fecha_pago.localeCompare(a.fecha_pago)),
    historial: [...f.historial_estatus].sort((a, b) => a.desde.localeCompare(b.desde)),
    cotizacion: viva
      ? {
          id: viva.id,
          monto_honorarios: Number(viva.monto_honorarios),
          monto_iva: Number(viva.monto_iva),
          monto_terceros: Number(viva.monto_terceros),
          monto_total: Number(viva.monto_total),
          requiere_factura: viva.requiere_factura,
          vigente_hasta: viva.vigente_hasta,
          pdf_ruta: viva.pdf_ruta,
          cuenta: viva.cuentas_receptoras,
          honorario_tipo: viva.honorario_tipo,
          honorario_minimo: viva.honorario_minimo === null ? null : Number(viva.honorario_minimo),
        }
      : null,
  };
}

export type { MiNivel } from "@/lib/nivel";

/**
 * El nivel del mes, lo que daría su promedio el mes que entra y lo que falta este mes (0081, avance_nivel). La
 * misma función para el comisionista (lo suyo) y para administración (su ficha): todas las pantallas dicen lo mismo.
 */
export async function miNivel(personaId: string, _orgId?: string): Promise<import("@/lib/nivel").MiNivel> {
  void _orgId;
  const supabase = await crearClienteServidor();
  const datos = oExplota(await supabase.rpc("avance_nivel", { p_persona: personaId }), "tu nivel");
  return normalizarAvance(datos);
}
