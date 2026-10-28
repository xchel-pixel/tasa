import { crearClienteServidor, oExplota } from "@/lib/supabase/server";
import type { EstadoPago, EstatusPublico, ViaPago } from "@/lib/estatus";
import { mesActual, mesSiguiente } from "@/lib/formato";

/**
 * Lecturas del comisionista. No filtran por persona: el RLS ya solo le
 * deja ver lo suyo. Si una consulta falla, `oExplota` lo dice en vez de
 * pintar una lista vacía.
 */

export type TrabajoEnLista = {
  id: string;
  folio: string | null;
  estatus_publico: EstatusPublico;
  cliente_nombre: string;
  inmueble_direccion: string;
  monto_total: number;
  creado_en: string;
  servicio: string;
  /** Suma de pagos confirmados. */
  confirmado: number;
  /** Suma de pagos reportados que esperan confirmación. */
  por_confirmar: number;
};

type FilaTrabajo = Omit<TrabajoEnLista, "servicio" | "confirmado" | "por_confirmar" | "monto_total"> & {
  monto_total: string | number;
  servicios: { nombre: string } | null;
  pagos: { monto: string | number; estado: EstadoPago }[];
};

const sumar = (pagos: FilaTrabajo["pagos"], estado: EstadoPago) =>
  pagos.filter((p) => p.estado === estado).reduce((total, p) => total + Number(p.monto), 0);

export async function misTrabajos(): Promise<TrabajoEnLista[]> {
  const supabase = await crearClienteServidor();
  const filas = oExplota(
    await supabase
      .from("solicitudes")
      .select(
        "id, folio, estatus_publico, cliente_nombre, inmueble_direccion, monto_total, creado_en, servicios(nombre), pagos(monto, estado)"
      )
      .order("creado_en", { ascending: false })
      .returns<FilaTrabajo[]>(),
    "tus trabajos"
  );

  return (filas ?? []).map((f) => ({
    id: f.id,
    folio: f.folio,
    estatus_publico: f.estatus_publico,
    cliente_nombre: f.cliente_nombre,
    inmueble_direccion: f.inmueble_direccion,
    monto_total: Number(f.monto_total),
    creado_en: f.creado_en,
    servicio: f.servicios?.nombre ?? "",
    confirmado: sumar(f.pagos, "confirmado"),
    por_confirmar: sumar(f.pagos, "reportado"),
  }));
}

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
  cliente_nombre: string;
  cliente_telefono: string | null;
  cliente_correo: string | null;
  requiere_factura: boolean;
  monto_honorarios: number | null;
  monto_iva: number;
  monto_terceros: number;
  monto_total: number;
  cuenta: { titular: string; banco: string | null; clabe: string } | null;
  pagado_en: string | null;
  /** Mes al que cayó la comisión al quedar pagado (para saber si ya cerró). */
  mes_cierre: string | null;
  motivo_cancelacion: string | null;
  creado_en: string;
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
  } | null;
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
  }[];
};

export async function obtenerTrabajo(id: string): Promise<Trabajo | null> {
  const supabase = await crearClienteServidor();
  const f = oExplota(
    await supabase
      .from("solicitudes")
      .select(
        `id, folio, tipo, estado, estatus_publico, inmueble_direccion, inmueble_municipio,
         inmueble_clave_catastral, inmueble_descripcion, cliente_nombre, cliente_telefono,
         cliente_correo, requiere_factura, monto_honorarios, monto_iva, monto_terceros,
         monto_total, pagado_en, mes_cierre, motivo_cancelacion, creado_en,
         servicios(nombre), marcas(nombre), cuentas_receptoras(titular, banco, clabe),
         pagos(id, via, monto, fecha_pago, referencia, nota, recibido_por, estado, motivo_rechazo, motivo_retiro, reportado_por),
         historial_estatus(estatus_publico, desde),
         cotizaciones(id, estado, monto_honorarios, monto_iva, monto_terceros, monto_total,
                      requiere_factura, vigente_hasta, pdf_ruta, cuentas_receptoras(titular, banco, clabe))`
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
    cuenta: f.cuentas_receptoras,
    monto_honorarios: f.monto_honorarios === null ? null : Number(f.monto_honorarios),
    monto_iva: Number(f.monto_iva),
    monto_terceros: Number(f.monto_terceros),
    monto_total: Number(f.monto_total),
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
        }
      : null,
  };
}

export type MiNivel = {
  nivel: string;
  porcentaje: number;
  /** El del mes en curso todavía no existe (falta aprobar el cierre anterior). */
  provisional: boolean;
  /** Proyección para el mes siguiente con lo cobrado hasta hoy. */
  promedio: number;
  meses: number;
  siguiente: { nombre: string; umbral: number; porcentaje: number } | null;
  /** Honorarios pagados que faltan ESTE mes para llegar al siguiente nivel. */
  faltante: number;
  /** 0 a 1, para la barra de progreso. */
  avance: number;
  comision_mes: number;
  comision_mes_provisional: boolean;
  /** Tasa de bienvenida, arranque, Élite con vencimiento o bajada escalonada, en una frase. */
  trato: string | null;
};

type FilaNivel = { nombre: string; orden: number; umbral_minimo: string | null; porcentaje: string | null; es_forzado: boolean };

/**
 * El nivel del mes y cuánto le falta para subir. La proyección usa
 * `calcular_nivel` de la base con el mes siguiente: es exactamente lo
 * que hará el cierre si el mes terminara hoy.
 */
export async function miNivel(personaId: string, orgId: string): Promise<MiNivel> {
  const supabase = await crearClienteServidor();
  const mes = mesActual();

  const [pct, prov, proy, niveles, comisiones, trato] = await Promise.all([
    supabase.rpc("porcentaje_vigente", { p_org: orgId, p_comisionista: personaId, p_mes: mes }),
    supabase.rpc("porcentaje_es_provisional", { p_org: orgId, p_comisionista: personaId, p_mes: mes }),
    supabase.rpc("calcular_nivel", { p_org: orgId, p_comisionista: personaId, p_mes: mesSiguiente(mes) }),
    supabase.from("niveles").select("nombre, orden, umbral_minimo, porcentaje, es_forzado").order("orden").returns<FilaNivel[]>(),
    supabase.from("comisiones").select("monto, provisional").eq("comisionista_id", personaId).eq("mes", mes).returns<{ monto: string | number; provisional: boolean }[]>(),
    supabase.rpc("mi_trato"),
  ]);

  const porcentaje = Number(oExplota(pct, "tu porcentaje"));
  const provisional = Boolean(oExplota(prov, "tu nivel"));
  const proyeccion = (oExplota(proy, "tu avance") as { promedio: string | number; meses_considerados: number }[] | null)?.[0];
  const tabla = (oExplota(niveles, "los niveles") ?? []).filter((n) => !n.es_forzado);
  const lineas = oExplota(comisiones, "tus comisiones") ?? [];

  const actual =
    tabla.filter((n) => Number(n.porcentaje) === porcentaje).at(-1)?.nombre ??
    (oExplota(niveles, "los niveles") ?? []).find((n) => n.es_forzado)?.nombre ??
    "";

  const promedio = Number(proyeccion?.promedio ?? 0);
  const meses = Math.max(1, Number(proyeccion?.meses_considerados ?? 1));
  const siguienteFila = tabla.find((n) => Number(n.umbral_minimo) > promedio) ?? null;
  const anterior = [...tabla].reverse().find((n) => Number(n.umbral_minimo) <= promedio);

  const siguiente = siguienteFila
    ? { nombre: siguienteFila.nombre, umbral: Number(siguienteFila.umbral_minimo), porcentaje: Number(siguienteFila.porcentaje) }
    : null;
  const piso = Number(anterior?.umbral_minimo ?? 0);

  return {
    nivel: actual,
    porcentaje,
    provisional,
    promedio,
    meses,
    siguiente,
    // Subir el promedio en X pide X × meses de honorarios en este mes.
    faltante: siguiente ? Math.ceil((siguiente.umbral - promedio) * meses) : 0,
    avance: siguiente ? Math.min(1, Math.max(0, (promedio - piso) / (siguiente.umbral - piso))) : 1,
    comision_mes: lineas.reduce((t, l) => t + Number(l.monto), 0),
    comision_mes_provisional: lineas.some((l) => l.provisional),
    trato: fraseDelTrato(trato.data as MiTrato | null, porcentaje),
  };
}

type MiTrato = {
  trato: "bienvenida" | "arranque" | null;
  hasta: string | null;
  vigente: boolean;
  porcentaje: number | null;
  elite_vence: string | null;
  motivo_mes: string | null;
} | null;

/** "Tasa de bienvenida 15% hasta el 31/01/2027", o nada. */
function fraseDelTrato(t: MiTrato, porcentaje: number): string | null {
  if (!t) return null;
  const dma = (iso: string) => iso.slice(0, 10).split("-").reverse().join("/");
  if (t.elite_vence) return `Élite ${porcentaje}% hasta el ${dma(t.elite_vence)}`;
  if (t.vigente && t.hasta && t.trato) {
    return `${t.trato === "bienvenida" ? "Tasa de bienvenida" : "Tasa de arranque"} ${Number(t.porcentaje)}% hasta el ${dma(t.hasta)}`;
  }
  if (t.motivo_mes === "escalon") {
    return "Terminó tu bienvenida: tu nivel baja uno por cierre hasta el que da tu promedio. Si tu promedio sube, subes de inmediato.";
  }
  return null;
}
