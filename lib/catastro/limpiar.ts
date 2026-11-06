/**
 * Lista blanca del mapa catastral: de lo que regresa IDECATQ solo pasa lo que está aquí, con nombre propio.
 * Lo personal del propietario (CURP, RFC, teléfono, domicilio, sexo, defunción, número de persona) se descarta
 * aquí y nunca llega a la base; la base, además, rechaza cualquier llave fuera del catálogo (0059).
 *
 * `datos` va a catastro_predios (compartido). `privados` (nombre y porcentaje del propietario y la operación)
 * va a catastro_propietarios, de la organización y solo para admin_org, finanzas y equipo.
 */

/** Los campos configurables, en el mismo orden que catastro_campos() de la base (0061; una prueba lo vigila). */
export const CAMPOS = [
  "colonia", "codigo_postal", "ubicacion", "sup_terreno", "sup_construccion",
  "calle", "num_ext", "num_int", "localidad", "manzana", "tipo_predio", "estatus", "clasificacion", "uso",
  "clave_anterior", "clave_estandar", "clave_original", "folio_real", "fecha_alta", "fecha_mantenimiento",
  "movimientos", "superficie", "tipos_construccion", "series_valor",
  "codigo_valor", "fecha_validez", "valor_terreno", "valor_construccion", "valor_catastral_total",
  "valor_terreno_anterior", "valor_construccion_anterior",
  "regimen", "tipo_condominio", "nombre_condominio", "indiviso",
  "sup_terreno_privativa", "sup_terreno_comun", "sup_construccion_privativa", "sup_construccion_comun",
  "valor_terreno_privativo", "valor_terreno_comun", "valor_construccion_privativa", "valor_construccion_comun",
  "cacoct", "vacopt", "vatrct", "vatrpt",
  "rppc_folio_real", "rppc_tipo", "rppc_estatus", "rppc_area_terreno", "rppc_ubicacion", "rppc_lote",
  "rppc_nom_col_bar_otro", "rppc_medidas", "rppc_medid_colind",
  "capa_folio", "capa_no_oficial", "capa_localidad", "capa_curt", "capa_area", "capa_perimetro", "capa_coor_x", "capa_coor_y",
] as const;
export type Campo = (typeof CAMPOS)[number];

/** Lo mismo que catastro_llave_prohibida() en la base. */
export function llaveProhibida(llave: string): boolean {
  return /(curp|rfc|telefono|domicilio|direccion|sexo|defuncion|persona|paterno|materno|correo|email|propietario)/.test(
    llave.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
  );
}

/** ¿Alguna llave, a cualquier profundidad, es prohibida? */
export function tieneLlaveProhibida(x: unknown): boolean {
  if (Array.isArray(x)) return x.some(tieneLlaveProhibida);
  if (x && typeof x === "object") return Object.entries(x).some(([k, v]) => llaveProhibida(k) || tieneLlaveProhibida(v));
  return false;
}

export type Datos = Partial<Record<Campo, string | number | Record<string, string | number>[]>>;
export type Propietario = { nombre: string; porcentaje: number | null; origen: "catastro" | "rppc"; tipo_adquisicion?: string };
export type Privados = {
  propietarios: Propietario[];
  valor_operacion: number | null;
  escritura: string | null;
  notario: string | null;
  numero_contrato: string | null;
};

type Obj = Record<string, unknown>;
const obj = (x: unknown): Obj => (x && typeof x === "object" && !Array.isArray(x) ? (x as Obj) : {});
const lista = (x: unknown): unknown[] => (Array.isArray(x) ? x : []);

/** Texto limpio, o nulo si viene vacío (los objetos y listas no son texto). */
function txt(x: unknown): string | null {
  if (typeof x === "number" && Number.isFinite(x)) return String(x);
  if (typeof x !== "string") return null;
  const t = x.replace(/\s+/g, " ").trim();
  return t && t !== "null" ? t.slice(0, 500) : null;
}

/** Número (acepta "1,234.50"), o nulo. */
function num(x: unknown): number | null {
  if (typeof x === "number") return Number.isFinite(x) ? x : null;
  if (typeof x !== "string" || !x.trim()) return null;
  const n = Number(x.replace(/[,\s$]/g, ""));
  return Number.isFinite(n) ? n : null;
}

/** Una lista de cosas sueltas, como texto ("a, b"): de los objetos, solo sus valores sueltos. */
function textoDeLista(x: unknown): string | null {
  const partes = lista(x).flatMap((e) => (e && typeof e === "object" ? Object.values(e as Obj).map(txt) : [txt(e)])).filter(Boolean);
  return partes.length ? [...new Set(partes)].join(", ").slice(0, 500) : txt(x);
}

/** Solo las llaves pedidas de cada objeto de una lista. */
function tabla(x: unknown, llaves: string[]): Record<string, string | number>[] | null {
  const filas = lista(x).slice(0, 50).map((e) => {
    const o = obj(e), fila: Record<string, string | number> = {};
    for (const k of llaves) {
      const v = typeof o[k] === "number" ? (o[k] as number) : txt(o[k]);
      if (v !== null) fila[k] = v;
    }
    return fila;
  }).filter((f) => Object.keys(f).length);
  return filas.length ? filas : null;
}

function ubicacionTexto(u: Obj): string | null {
  const calle = [txt(u.tipoCalle), txt(u.calle), txt(u.exterior), txt(u.interior) ? `int. ${txt(u.interior)}` : null, txt(u.letra)].filter(Boolean).join(" ");
  const partes = [calle, [txt(u.tipoColonia), txt(u.colonia)].filter(Boolean).join(" "), txt(u.codigoPostal) ? `CP ${txt(u.codigoPostal)}` : null,
    txt(u.localidad), txt(u.municipio)].filter(Boolean);
  return partes.length ? partes.join(", ") : null;
}

/** Quita nulos. */
function compacto(d: Record<string, unknown>): Datos {
  return Object.fromEntries(Object.entries(d).filter(([, v]) => v !== null && v !== undefined && v !== "")) as Datos;
}

/** Lo que viene de la capa del mapa (GetFeatureInfo `M__PA`): solo los campos de la lista. */
export function datosDeCapa(propiedades: unknown): Datos {
  const p = obj(propiedades);
  const curt = [txt(p.CURT_1), txt(p.CURT_2)].filter(Boolean).join(" / ");
  return compacto({
    capa_folio: txt(p.FOLIOINMB),
    capa_no_oficial: txt(p.NO_OFICIAL),
    capa_localidad: txt(p.CVE_LOC),
    capa_curt: curt || null,
    capa_area: num(p.SHAPE_AREA),
    capa_perimetro: num(p.SHAPE_LEN),
    capa_coor_x: num(p.COOR_X),
    capa_coor_y: num(p.COOR_Y),
  });
}

/** El expediente (BuscaDatos) → datos del predio y lo privado. Todo lo que no se nombra aquí se descarta. */
export function limpiarExpediente(respuesta: unknown): { datos: Datos; privados: Privados } | null {
  const predio = obj(obj(respuesta).predio);
  if (!txt(predio.claveCatastral)) return null;
  const u = obj(predio.ubicacion), r = obj(predio.datosRPPC);

  const datos = compacto({
    colonia: txt(u.colonia),
    codigo_postal: txt(u.codigoPostal),
    ubicacion: ubicacionTexto(u),
    sup_terreno: num(predio.areaTotalTerreno),
    sup_construccion: num(predio.areaTotalConstruccion),
    calle: [txt(u.tipoCalle), txt(u.calle)].filter(Boolean).join(" ") || null,
    num_ext: txt(u.exterior),
    num_int: txt(u.interior),
    localidad: txt(u.localidad),
    manzana: txt(predio.manzana) ?? txt(u.manzana),
    tipo_predio: txt(predio.tipoPredio),
    estatus: txt(predio.estatus),
    clasificacion: txt(predio.desClasificacion) ?? txt(predio.claveClasificacion),
    uso: txt(obj(predio.usosPredio).des) ?? txt(obj(predio.usosPredio).clave),
    clave_anterior: txt(predio.claveAnterior),
    clave_estandar: txt(predio.claveEstandar),
    clave_original: txt(predio.claveOriginal),
    folio_real: textoDeLista(predio.folioReal),
    fecha_alta: txt(predio.fechaAlta),
    fecha_mantenimiento: txt(predio.fechaMantenimiento),
    movimientos: tabla(predio.movimientos, ["clave", "descripcion"]),
    superficie: num(predio.superficie),
    tipos_construccion: textoDeLista(predio.tiposConstruccion),
    series_valor: tabla(predio.seriesValor, ["nivel", "tipo", "serie", "area", "areaCons", "areaT", "factor"]),
    codigo_valor: txt(predio.codigoValor),
    fecha_validez: txt(predio.fechaValidez),
    valor_terreno: num(predio.valorActTer),
    valor_construccion: num(predio.valorActCon),
    valor_catastral_total: num(predio.valorActTer) !== null || num(predio.valorActCon) !== null
      ? Math.round(((num(predio.valorActTer) ?? 0) + (num(predio.valorActCon) ?? 0)) * 100) / 100 : null,
    valor_terreno_anterior: num(predio.valorAntTer),
    valor_construccion_anterior: num(predio.valorAntCon),
    regimen: txt(predio.claCondominio),
    tipo_condominio: txt(predio.tipoCondominio),
    nombre_condominio: txt(predio.nombreCondominio),
    indiviso: num(predio.indiviso),
    sup_terreno_privativa: num(predio.areaTerrPri),
    sup_terreno_comun: num(predio.areaTerrCom),
    sup_construccion_privativa: num(predio.areaConsPri),
    sup_construccion_comun: num(predio.areaConsCom),
    valor_terreno_privativo: num(predio.valorTerPri),
    valor_terreno_comun: num(predio.valorTerCom),
    valor_construccion_privativa: num(predio.valorConsPri),
    valor_construccion_comun: num(predio.valorConsCom),
    cacoct: num(predio.cacoct) ?? txt(predio.cacoct),
    vacopt: num(predio.vacopt) ?? txt(predio.vacopt),
    vatrct: num(predio.vatrct) ?? txt(predio.vatrct),
    vatrpt: num(predio.vatrpt) ?? txt(predio.vatrpt),
    rppc_folio_real: txt(r.folio_real),
    rppc_tipo: txt(r.tipo) ?? txt(r.tip_pre),
    rppc_estatus: txt(r.estatus),
    rppc_area_terreno: num(r.area_terreno) ?? txt(r.area_terreno),
    rppc_ubicacion: txt(r.ubicacion_especifica),
    rppc_lote: txt(r.lote),
    rppc_nom_col_bar_otro: txt(r.nom_col_bar_otro),
    rppc_medidas: txt(r.medidas),
    rppc_medid_colind: txt(r.medid_colind),
  });

  const propietarios: Propietario[] = [
    ...lista(predio.propietarios).map((e) => {
      const p = obj(e);
      const nombre = txt(p.razonSocial) ?? ([txt(p.nombre), txt(p.paterno), txt(p.materno)].filter(Boolean).join(" ") || null);
      return nombre ? { nombre: nombre.slice(0, 200), porcentaje: num(p.porcentaje), origen: "catastro" as const } : null;
    }),
    ...lista(r.propietariosR).map((e) => {
      const p = obj(e);
      const nombre = txt(p.nombre_completo);
      const tipo = txt(p.tipo_adquisicion);
      return nombre
        ? { nombre: nombre.slice(0, 200), porcentaje: num(p.porcentaje_copropiedad), origen: "rppc" as const, ...(tipo ? { tipo_adquisicion: tipo } : {}) }
        : null;
    }),
  ].filter((p): p is Propietario => p !== null).slice(0, 30);

  const privados: Privados = {
    propietarios,
    valor_operacion: num(r.valor_oper),
    escritura: txt(predio.numeroEscritura),
    notario: txt(predio.fedatario),
    numero_contrato: txt(predio.numeroContrato),
  };
  return { datos, privados };
}

/** Centroide del expediente en UTM (para buscar el polígono en el mapa cuando se busca por clave). */
export function centroideDelExpediente(respuesta: unknown): [number, number] | null {
  const c = obj(obj(obj(respuesta).predio).centroide);
  const x = num(c.x), y = num(c.y);
  return x && y && x > 100000 && x < 900000 && y > 2000000 && y < 2600000 ? [x, y] : null;
}
