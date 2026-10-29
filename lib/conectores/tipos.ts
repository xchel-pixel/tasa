/**
 * La interfaz que cumple todo conector externo (Notion hoy; Sheets y
 * webhook después). El cron no sabe de Notion: le pide a cada conector
 * que cree los trámites nuevos y que diga qué cambió, y lo registra en
 * la base, donde viven las reglas.
 */

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
  /** Lo que cambió afuera desde `desde` (solo registros que vienen de Tasa). */
  leerCambios(desde: Date): Promise<Lectura[]>;
  /** Escribe la etapa de cancelado en el registro externo. Falso si el registro ya no existe. */
  marcarCancelado(externoId: string, etapa: string): Promise<boolean>;
  /** ¿Sigue existiendo el registro (ni borrado ni archivado)? */
  existe(externoId: string): Promise<boolean>;
}
