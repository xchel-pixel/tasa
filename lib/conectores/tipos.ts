/**
 * La interfaz que cumple todo conector externo (Notion hoy; Sheets y
 * webhook después). El cron no sabe de Notion: le pide a cada conector
 * que cree los trámites nuevos y que diga qué cambió, y lo registra en
 * la base, donde viven las reglas.
 */

/** Lo que el sync manda para el par de compensación (0083). */
export type Compensacion = {
  accion: "crear" | "borrar"; externo_id: string; monto: number; fecha: string; folio: string | null; comisionista: string;
  pagina: string | null; ids: string[] | null;
};

export type CodigoFalla = "propiedad_no_encontrada" | "credencial_invalida" | "inaccesible" | "limite" | "otro";

/** Una falla que el conector sabe explicar; acaba en una alerta para admin_org. */
export class FallaConector extends Error {
  constructor(public codigo: CodigoFalla, mensaje: string) {
    super(mensaje);
  }
}

export type ConfigConector = {
  id: string;
  organizacion_id: string;
  tipo: string;
  configuracion: Record<string, string>;
  mapeo_campos: Record<string, string>;
  ultimo_sync: string | null;
  prefijo_folio: string;
};

/** Lo que hace falta para crear el registro externo de un trámite aceptado. */
export type TramitePorCrear = {
  solicitud_id: string;
  cliente_nombre: string;
  cliente_telefono: string | null;
  cliente_correo: string | null;
  /** El nombre en Notion del servicio; nulo si no tiene (no se manda tipo). */
  servicio: string | null;
  inmueble_direccion: string;
  inmueble_municipio: string | null;
  inmueble_clave_catastral: string | null;
  inmueble_descripcion: string | null;
  requiere_factura: boolean;
  monto_honorarios: number;
  monto_terceros: number;
  aceptada_en: string;
  comisionista: string;
  marca: string | null;
};

/** Un trámite que ya existe afuera, leído completo para traerlo a Tasa (vista previa). */
export type TramiteExterno = {
  externo_id: string;
  titulo: string;
  etapa: string | null;
  tipo: string | null;
  cotizacion: number | null;
  fecha_aceptacion: string | null;
  cliente_nombre: string | null;
  cliente_telefono: string | null;
  cliente_correo: string | null;
  clave_catastral: string | null;
  descripcion: string | null;
  requiere_factura: boolean;
};

/** Lo que se leyó de un registro externo. */
export type Lectura = {
  externo_id: string;
  titulo: string;
  etapa: string | null;
  fecha_visita: string | null;
};

export interface Conector {
  /** Valida credencial, base y que existan las propiedades del mapeo. */
  probar(): Promise<void>;
  /** Crea el registro externo y regresa su id. */
  crearRegistro(t: TramitePorCrear): Promise<string>;
  /**
   * Lo que cambió afuera desde `desde`: los registros que vienen de Tasa y, con `importados`, también
   * los que se trajeron a Tasa desde afuera (su "medio" no es el de Tasa; los demás los ignora la base).
   */
  leerCambios(desde: Date, importados?: boolean): Promise<Lectura[]>;
  /** Reescribe SOLO "Solicitado por" al asignar o cambiar comisionista. Falso si el registro ya no existe. */
  actualizarSolicitadoPor(externoId: string, nombre: string): Promise<boolean>;
  /** El registro cuyo título trae ese folio (nulo si no hay); para "Traer trámite". */
  buscarPorFolio(folio: string): Promise<TramiteExterno | null>;
  /** Escribe la etapa de cancelado en el registro externo. Falso si el registro ya no existe. */
  marcarCancelado(externoId: string, etapa: string): Promise<boolean>;
  /** ¿Sigue existiendo el registro (ni borrado ni archivado)? */
  existe(externoId: string): Promise<boolean>;
  /** Reescribe el honorario ("Cotización") al fijarse el final de un estimado. Falso si el registro ya no existe. */
  actualizarMonto(externoId: string, monto: number): Promise<boolean>;
  /** "Ext Comisionista" + "Ext Comisión" del trámite (relación vacía si no hay página). Falso si el registro ya no existe. */
  actualizarComision(externoId: string, monto: number, pagina: string | null): Promise<boolean>;
  /** "Ref Comisionista" + "Ref Bono" del trámite, al aprobar el cierre. Falso si el registro ya no existe. */
  actualizarReferido(externoId: string, monto: number, pagina: string | null): Promise<boolean>;
  /** Par de compensación de una comisión retenida (acción B, 0083): crea ingreso + gasto y devuelve sus ids, o los manda a la papelera. */
  compensarComision(c: Compensacion): Promise<string[]>;
  /** "Honorarios estatus" (Pagado / No Pagado 🔥) cuando Tasa causó el pago al 100% (0082). Falso si el registro ya no existe. */
  actualizarHonorariosEstatus(externoId: string, estatus: string): Promise<boolean>;
  /** "Honorario" del trámite (comisión descontada al cliente, 0079). Falso si el registro ya no existe. */
  actualizarHonorario(externoId: string, monto: number): Promise<boolean>;
  /** "Crédito Tasa" (con IVA si lleva factura) y "Costo crédito" (bonificación sin IVA) del trámite. Falso si el registro ya no existe. */
  actualizarCredito(externoId: string, credito: number, costo: number): Promise<boolean>;
  /** Movimientos del pago (o su anulación) en Cobros y Gastos: ids creados y, si quedó incompleto, qué faltó. */
  registrarPago(pago: PagoPorRegistrar): Promise<{ ids: string[]; avisos: string | null }>;
  /** Páginas de la base de comisionistas cuyo nombre contiene el texto. */
  buscarComisionistas(nombre: string): Promise<PaginaComisionista[]>;
  /** Crea la página del comisionista en la base de comisionistas. */
  crearComisionista(nombre: string): Promise<PaginaComisionista>;
}

export type PaginaComisionista = { id: string; nombre: string };

/** Un pago de comisión (o su anulación) para Cobros y Gastos. */
export type PagoPorRegistrar = {
  pago_id: string;
  anular: boolean;
  fecha: string;
  monto: number;
  /** Parte del pago que es bono de referido: va en un movimiento aparte, sin relación al comisionista. */
  bono: number;
  comisionista: string;
  pagina: string | null;
  /** Nombre exacto de la cuenta en Notion (Catálogos → Cuentas para pagar comisiones). */
  cuenta: string | null;
  origen: string | null;
  referencia: string | null;
  folios: string | null;
  registro: string | null;
};
